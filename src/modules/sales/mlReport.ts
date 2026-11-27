// Leitura do relatório "Vendas" do Mercado Livre (Minhas vendas → Baixar relatório).
// Só extrai o necessário para análise: dados pessoais do comprador (nome, CPF,
// endereço) são ignorados aqui e nunca saem do navegador — guardamos só a UF.
import type { Cell } from '@/lib/xlsx'

export type SaleRow = {
  order_id: string
  pack_id: string | null
  sold_at: string
  status_text: string
  status_group: 'ativa' | 'cancelada' | 'devolvida'
  sku: string | null
  listing_ext_id: string | null
  kit_ext_id: string | null
  title: string | null
  variation: string | null
  listing_type: string | null
  units: number
  unit_price: number | null
  gross_revenue: number
  sale_fees: number
  shipping_net: number
  discounts: number
  refunds: number
  net_total: number
  shipping_mode: string | null
  buyer_state: string | null
  from_ads: boolean
}
export type ParseResult = { rows: SaleRow[]; skipped: number; warnings: string[] }

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}
const UF: Record<string, string> = {
  'acre': 'AC', 'alagoas': 'AL', 'amapá': 'AP', 'amazonas': 'AM', 'bahia': 'BA', 'ceará': 'CE', 'distrito federal': 'DF',
  'espírito santo': 'ES', 'goiás': 'GO', 'maranhão': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  'pará': 'PA', 'paraíba': 'PB', 'paraná': 'PR', 'pernambuco': 'PE', 'piauí': 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', 'rondônia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
  'são paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
}

/** "26 de novembro de 2026 21:24 hs." → ISO com fuso de Brasília. */
export function parseMlDate(v: Cell): string | null {
  const m = String(v ?? '').toLowerCase().match(/(\d{1,2}) de ([a-zçã]+) de (\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m || !MONTHS[m[2]]) return null
  const p = (n: number | string) => String(n).padStart(2, '0')
  return `${m[3]}-${p(MONTHS[m[2]])}-${p(m[1])}T${p(m[4] ?? 12)}:${m[5] ?? '00'}:00-03:00`
}

const str = (v: Cell) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
function num(v: Cell): number | null {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : null
}
const round2 = (n: number) => Math.round(n * 100) / 100

export function statusGroup(text: string, refunds: number): SaleRow['status_group'] {
  const t = text.toLowerCase()
  if (/cancelad/.test(t)) return 'cancelada'
  if (/devolu|reembols/.test(t) || refunds < 0) return 'devolvida'
  return 'ativa'
}

// Colunas usadas: [grupo, início do título]. O grupo desfaz ambiguidades ("Estado", "Unidades" aparecem várias vezes).
const COLS = {
  order: ['vendas', 'n.º de venda'], date: ['vendas', 'data de venda'], status: ['vendas', 'estado'],
  statusDesc: ['vendas', 'descrição do status'], kit: ['vendas', 'pertence a um kit'], units: ['vendas', 'unidades'],
  gross: ['vendas', 'receita por produtos'], surcharge: ['vendas', 'receita por acréscimo'], installment: ['vendas', 'taxa de parcelamento'],
  fees: ['vendas', 'tarifa de venda'], shipIn: ['vendas', 'receita por envio'], shipFee: ['vendas', 'tarifas de envio'],
  shipDeclared: ['vendas', 'custo de envio com base'], shipDiff: ['vendas', 'custo por diferenças'],
  discounts: ['vendas', 'descontos e bônus'], refunds: ['vendas', 'cancelamentos e reembolsos'], total: ['vendas', 'total'],
  ads: ['publicidade', 'venda por publicidade'], sku: ['anúncios', 'sku'], listing: ['anúncios', '# de anúncio'],
  title: ['anúncios', 'título do anúncio'], variation: ['anúncios', 'variação'], unitPrice: ['anúncios', 'preço unitário'],
  listingType: ['anúncios', 'tipo de anúncio'], buyerState: ['compradores', 'estado'], shipMode: ['envios', 'forma de entrega'],
} as const
type ColKey = keyof typeof COLS

function mapColumns(groupRow: Cell[], headerRow: Cell[]) {
  const idx = {} as Record<ColKey, number>
  let group = ''
  const cols = Math.max(groupRow.length, headerRow.length)
  const found: { g: string; h: string; i: number }[] = []
  for (let i = 0; i < cols; i++) {
    const g = str(groupRow[i]); if (g) group = g.toLowerCase()
    found.push({ g: group, h: (str(headerRow[i]) ?? '').toLowerCase(), i })
  }
  for (const [k, [g, h]] of Object.entries(COLS) as [ColKey, readonly [string, string]][]) {
    const hit = found.find((f) => f.g === g && (h === 'total' ? f.h.startsWith('total') : h === 'estado' ? f.h === 'estado' : f.h.startsWith(h)))
    idx[k] = hit ? hit.i : -1
  }
  return idx
}

/** Converte as linhas da planilha em vendas por item, rateando pacotes e kits. */
export function parseMlSales(sheet: Cell[][]): ParseResult {
  const h = sheet.findIndex((r) => (str(r[0]) ?? '').toLowerCase().startsWith('n.º de venda'))
  if (h < 1) throw new Error('Este arquivo não parece ser o relatório de Vendas do Mercado Livre (não achei a coluna "N.º de venda").')
  const c = mapColumns(sheet[h - 1], sheet[h])
  const missing = (['order', 'date', 'status', 'units', 'gross', 'total', 'sku'] as ColKey[]).filter((k) => c[k] < 0)
  if (missing.length) throw new Error('O relatório mudou de formato: faltam colunas obrigatórias. Baixe de novo em Vendas → Baixar relatório.')
  const g = (r: Cell[], k: ColKey) => (c[k] >= 0 ? r[c[k]] ?? null : null)
  const money = (r: Cell[]) => ({
    gross: (num(g(r, 'gross')) ?? 0) + (num(g(r, 'surcharge')) ?? 0) + (num(g(r, 'installment')) ?? 0),
    fees: num(g(r, 'fees')) ?? 0,
    ship: (num(g(r, 'shipIn')) ?? 0) + (num(g(r, 'shipFee')) ?? 0) + (num(g(r, 'shipDeclared')) ?? 0) + (num(g(r, 'shipDiff')) ?? 0),
    discounts: num(g(r, 'discounts')) ?? 0,
    refunds: num(g(r, 'refunds')) ?? 0,
    total: num(g(r, 'total')) ?? 0,
  })
  const hasMoney = (r: Cell[]) => (['gross', 'fees', 'shipIn', 'shipFee', 'refunds', 'total'] as ColKey[]).some((k) => num(g(r, k)) !== null)
  const isItem = (r: Cell[]) => !!str(g(r, 'sku')) || !!str(g(r, 'listing'))

  const rows: SaleRow[] = []
  const warnings: string[] = []
  let skipped = 0
  const base = (r: Cell[], ctx: { ship?: string | null; uf?: string | null; pack?: string | null }) => {
    const statusText = [str(g(r, 'status')), str(g(r, 'statusDesc'))].filter(Boolean).join(' — ')
    const uf = str(g(r, 'buyerState'))
    const kit = str(g(r, 'kit'))
    return {
      order_id: String(str(g(r, 'order'))),
      pack_id: ctx.pack ?? null,
      sold_at: parseMlDate(g(r, 'date')) as string,
      status_text: statusText,
      sku: str(g(r, 'sku')),
      listing_ext_id: str(g(r, 'listing')),
      kit_ext_id: kit && /^MLB/i.test(kit) ? kit : null,
      title: str(g(r, 'title')),
      variation: str(g(r, 'variation')),
      listing_type: str(g(r, 'listingType')),
      units: num(g(r, 'units')) ?? 0,
      unit_price: num(g(r, 'unitPrice')),
      shipping_mode: str(g(r, 'shipMode')) ?? ctx.ship ?? null,
      buyer_state: (uf ? UF[uf.toLowerCase()] : undefined) ?? ctx.uf ?? null,
      from_ads: (str(g(r, 'ads')) ?? '').toLowerCase() === 'sim',
    }
  }

  for (let i = h + 1; i < sheet.length; i++) {
    const r = sheet[i]
    if (!str(g(r, 'order'))) continue
    if (!parseMlDate(g(r, 'date'))) { skipped++; continue }

    if (!isItem(r)) {
      // cabeçalho de pacote/kit: os itens vêm nas linhas seguintes, sem valores
      const children: Cell[][] = []
      while (i + 1 < sheet.length && isItem(sheet[i + 1]) && !hasMoney(sheet[i + 1])) children.push(sheet[++i])
      if (!children.length) { skipped++; continue }
      const m = money(r)
      const ufName = str(g(r, 'buyerState'))
      const ctx = { pack: String(str(g(r, 'order'))), ship: str(g(r, 'shipMode')), uf: ufName ? UF[ufName.toLowerCase()] ?? null : null }
      const weights = children.map((ch) => (num(g(ch, 'unitPrice')) ?? 0) * (num(g(ch, 'units')) ?? 1))
      const wsum = weights.reduce((a, b) => a + b, 0)
      const share = (k: number) => (wsum > 0 ? weights[k] / wsum : 1 / children.length)
      const alloc = (total: number) => {
        const parts = children.map((_, k) => round2(total * share(k)))
        parts[parts.length - 1] = round2(total - parts.slice(0, -1).reduce((a, b) => a + b, 0))
        return parts
      }
      const A = { gross: alloc(m.gross), fees: alloc(m.fees), ship: alloc(m.ship), discounts: alloc(m.discounts), refunds: alloc(m.refunds), total: alloc(m.total) }
      children.forEach((ch, k) => {
        const b = base(ch, ctx)
        rows.push({ ...b, gross_revenue: A.gross[k], sale_fees: A.fees[k], shipping_net: A.ship[k], discounts: A.discounts[k],
          refunds: A.refunds[k], net_total: A.total[k], status_group: statusGroup(b.status_text, A.refunds[k]) })
      })
      continue
    }

    const m = money(r)
    const b = base(r, {})
    rows.push({ ...b, gross_revenue: round2(m.gross), sale_fees: round2(m.fees), shipping_net: round2(m.ship), discounts: round2(m.discounts),
      refunds: round2(m.refunds), net_total: round2(m.total), status_group: statusGroup(b.status_text, m.refunds) })
  }
  const noSku = rows.filter((r) => !r.sku).length
  if (noSku) warnings.push(`${noSku} ${noSku === 1 ? 'venda sem SKU no anúncio' : 'vendas sem SKU no anúncio'} — aparecem pelo título, sem ligação com o produto.`)
  if (skipped) warnings.push(`${skipped} ${skipped === 1 ? 'linha ignorada' : 'linhas ignoradas'} (sem data ou sem itens).`)
  return { rows, skipped, warnings }
}
