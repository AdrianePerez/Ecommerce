// Recebe XMLs de NF-e enviados por integrações (ex.: script do Gmail) e coloca
// na caixa de entrada (nfe_inbox) para conferência. Não grava a nota nem custos:
// a importação continua sendo feita na tela, com conferência.
// Autenticação: cabeçalho x-dualshop-token com uma chave gerada em Configurações
// (guardamos só o hash). Sem JWT, por isso a verificação é feita aqui.
// Só aceita notas cujo emitente (CNPJ) está cadastrado em Fornecedores.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const MAX_BYTES = 3 * 1024 * 1024
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Conteúdo de uma tag (sem namespace), opcionalmente dentro de um bloco. */
function tag(xml: string, name: string, within?: string): string | null {
  let scope = xml
  if (within) {
    const m = xml.match(new RegExp(`<(?:\\w+:)?${within}[\\s>][\\s\\S]*?</(?:\\w+:)?${within}>`))
    if (!m) return null
    scope = m[0]
  }
  const m = scope.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`))
  return m ? m[1].trim() : null
}

function validKey(k: string) {
  if (!/^\d{44}$/.test(k)) return false
  let sum = 0, w = 2
  for (let i = 42; i >= 0; i--) { sum += Number(k[i]) * w; w = w === 9 ? 2 : w + 1 }
  const r = sum % 11
  return (r < 2 ? 0 : 11 - r) === Number(k[43])
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' })
  const token = req.headers.get('x-dualshop-token') ?? ''
  if (!/^dsi_[0-9a-f]{48}$/.test(token)) return json(401, { error: 'Chave de integração ausente ou inválida.' })

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const hash = await sha256Hex(token)
  const { data: tok } = await sb.from('integration_tokens').select('id, revoked_at').eq('token_hash', hash).maybeSingle()
  if (!tok || tok.revoked_at) return json(401, { error: 'Chave de integração inválida ou revogada.' })
  await sb.from('integration_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id)

  const buf = new Uint8Array(await req.arrayBuffer())
  if (buf.length === 0 || buf.length > MAX_BYTES) return json(413, { error: 'Arquivo vazio ou grande demais.' })
  const xml = new TextDecoder('utf-8').decode(buf)
  // Cabeçalhos chegam codificados (encodeURIComponent) por causa de acentos
  const hdr = (n: string, max: number) => {
    const v = req.headers.get(n)
    if (!v) return null
    try { return decodeURIComponent(v).slice(0, max) } catch { return v.slice(0, max) }
  }
  const meta = { email_from: hdr('x-email-from', 300), email_subject: hdr('x-email-subject', 300), file_name: hdr('x-file-name', 200) }

  // Evento de cancelamento: marca a nota da caixa como cancelada
  if (/<(?:\w+:)?procEventoNFe[\s>]/.test(xml) || /<(?:\w+:)?evento[\s>]/.test(xml)) {
    const tp = tag(xml, 'tpEvento')
    const ch = tag(xml, 'chNFe')
    if (tp === '110111' && ch && validKey(ch)) {
      await sb.from('nfe_inbox').update({ status: 'cancelada' }).eq('access_key', ch).in('status', ['nova', 'ignorada'])
      return json(200, { result: 'cancelamento', access_key: ch })
    }
    return json(200, { result: 'ignorado', reason: 'evento sem efeito na caixa' })
  }

  const idMatch = xml.match(/<(?:\w+:)?infNFe[^>]*\bId="NFe(\d{44})"/)
  if (!idMatch) return json(200, { result: 'ignorado', reason: 'não é XML de NF-e' })
  const key = idMatch[1]
  if (!validKey(key)) return json(422, { error: 'Chave de acesso com dígito verificador inválido.' })
  if (tag(xml, 'mod', 'ide') !== '55') return json(200, { result: 'ignorado', reason: 'não é NF-e modelo 55' })

  // Só notas de fornecedores cadastrados (e não arquivados). As demais são descartadas sem guardar nada.
  const issuer = (tag(xml, 'CNPJ', 'emit') ?? '').replace(/\D/g, '')
  const { data: supplier } = await sb.from('suppliers').select('id').eq('cnpj', issuer).is('archived_at', null).maybeSingle()
  if (!issuer || !supplier) return json(200, { result: 'ignorado', reason: 'fornecedor não cadastrado' })

  const { data: existing } = await sb.from('nfe_inbox').select('id, status').eq('access_key', key).maybeSingle()
  if (existing) return json(200, { result: 'duplicada', status: existing.status })

  const path = `${key}.xml`
  const up = await sb.storage.from('nfe-xml').upload(path, new Blob([buf], { type: 'application/xml' }), { contentType: 'application/xml', upsert: false })
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return json(500, { error: 'Falha ao guardar o XML.' })

  const { data: inv } = await sb.from('invoices').select('id').eq('access_key', key).maybeSingle()
  const vNF = tag(xml, 'vNF', 'ICMSTot')
  const dh = tag(xml, 'dhEmi', 'ide') ?? (tag(xml, 'dEmi', 'ide') ? `${tag(xml, 'dEmi', 'ide')}T12:00:00-03:00` : null)
  const { error } = await sb.from('nfe_inbox').insert({
    access_key: key, source: 'email', status: inv ? 'importada' : 'nova', invoice_id: inv?.id ?? null,
    has_full_xml: true, xml_path: path,
    number: tag(xml, 'nNF', 'ide'), series: tag(xml, 'serie', 'ide'), issued_at: dh,
    issuer_cnpj: issuer, issuer_name: tag(xml, 'xNome', 'emit'),
    recipient_doc: tag(xml, 'CNPJ', 'dest') ?? tag(xml, 'CPF', 'dest'),
    total_invoice: vNF ? Number(vNF) : null, ...meta,
  })
  if (error) {
    if (error.code === '23505') return json(200, { result: 'duplicada' })
    console.error('insert nfe_inbox', error.code, error.message)
    return json(500, { error: 'Falha ao registrar a nota.' })
  }
  return json(201, { result: inv ? 'ja_importada' : 'nova', access_key: key })
})
