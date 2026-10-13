// Baixa uma imagem de um link público e devolve os bytes para o navegador,
// que então envia para a galeria com as mesmas regras do upload manual.
// Proteções: só usuários ativos da equipe; só http(s); bloqueia endereços
// internos; segue no máximo 3 redirecionamentos (checando cada um);
// limite de 15 MB e 20 s; só aceita JPG, PNG ou WebP (pelo conteúdo).
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const MAX_BYTES = 15 * 1024 * 1024
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-final-url, x-image-type',
}

const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true
  if (h.includes(':')) return true // IPv6 literal: não aceito
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

async function resolvesToPrivate(host: string): Promise<boolean> {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateHost(host)
  try {
    const ips = await Deno.resolveDns(host, 'A')
    return ips.some(isPrivateHost)
  } catch {
    return false // sem resolução aqui; o fetch falhará se o nome não existir
  }
}

async function checkUrl(raw: string): Promise<URL | string> {
  let u: URL
  try { u = new URL(raw) } catch { return 'Link inválido.' }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Use um link http:// ou https://.'
  if (u.username || u.password) return 'Links com usuário e senha não são aceitos.'
  if (u.port && u.port !== '80' && u.port !== '443') return 'Porta não permitida.'
  if (isPrivateHost(u.hostname) || await resolvesToPrivate(u.hostname)) return 'Endereços internos não são aceitos.'
  return u
}

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail(405, 'Método não permitido.')

  const auth = req.headers.get('Authorization')
  if (!auth) return fail(401, 'Não autenticado.')
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  })
  const { data: staff, error: staffErr } = await sb.rpc('is_staff')
  if (staffErr || staff !== true) return fail(403, 'Acesso negado.')

  let body: { url?: unknown }
  try { body = await req.json() } catch { return fail(400, 'Requisição inválida.') }
  if (typeof body.url !== 'string' || body.url.length > 2048) return fail(400, 'Informe o link da imagem.')

  let current = body.url.trim()
  let res: Response | null = null
  for (let hop = 0; hop <= 3; hop++) {
    const checked = await checkUrl(current)
    if (typeof checked === 'string') return fail(400, checked)
    try {
      res = await fetch(checked, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: { 'User-Agent': 'DualshopIntelligence/1.0 (importacao de imagem)', Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' },
      })
    } catch (e) {
      return fail(502, e instanceof DOMException && e.name === 'TimeoutError'
        ? 'O site demorou demais para responder.' : 'Não foi possível acessar o link (site fora do ar ou bloqueado).')
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, checked).toString()
      await res.body?.cancel()
      res = null
      continue
    }
    break
  }
  if (!res) return fail(400, 'Redirecionamentos demais.')
  if (res.status === 401 || res.status === 403) return fail(502, `O site bloqueou o acesso à imagem (erro ${res.status}).`)
  if (!res.ok) return fail(502, `O site respondeu com erro ${res.status}.`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) return fail(413, 'Imagem maior que 15 MB.')

  const reader = res.body?.getReader()
  if (!reader) return fail(502, 'Resposta vazia.')
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_BYTES) { await reader.cancel(); return fail(413, 'Imagem maior que 15 MB.') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { bytes.set(c, off); off += c.length }
  const mime = sniff(bytes)
  if (!mime) return fail(415, 'O link não aponta para uma imagem JPG, PNG ou WebP. Abra a imagem em nova aba e copie o endereço dela.')

  return new Response(bytes, {
    headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'x-image-type': mime, 'x-final-url': current, 'Cache-Control': 'no-store' },
  })
})
