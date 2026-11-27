// Consolidação das vendas para o painel (por produto/SKU, totais e meses).
import type { MonthPoint } from '@/modules/invoices/MonthlyChart'

export type SaleFact = {
  order_id: string
  pack_id: string | null
  sold_at: string
  status_group: 'ativa' | 'cancelada' | 'devolvida'
  sku: string | null
  product_id: string | null
  title: string | null
  units: number
  gross_revenue: number
  sale_fees: number
  shipping_net: number
  net_total: number
}

export type ProductLine = {
  key: string
  productId: string | null
  sku: string | null
  title: string | null
  units: number
  returned: number
  gross: number
  net: number
  fees: number
  shipping: number
  unitCost: number | null
  cost: number | null
  tax: number
  packaging: number
  margin: number | null
  orders: number
}

/** Simulação: imposto sobre o faturamento bruto (%) e embalagem por unidade vendida (R$). */
export type Simulation = { taxPct: number; packaging: number }

export type Totals = {
  units: number; returned: number; cancelled: number; orders: number
  gross: number; net: number; fees: number; shipping: number
  cost: number; tax: number; packaging: number; costCoveredGross: number; margin: number | null; unitsWithoutCost: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const keyOf = (s: SaleFact) => (s.product_id ? `p:${s.product_id}` : s.sku ? `s:${s.sku.toUpperCase()}` : `t:${s.title ?? s.order_id}`)

/**
 * Regras: canceladas não contam. Vendidas = unidades das vendas ativas.
 * Devolvidas contam à parte (unidades), e o valor que sobrou delas (normalmente zero
 * ou negativo, por tarifas) entra no líquido. Custo = unidades vendidas × custo médio atual.
 * Imposto = % sobre o faturamento bruto das vendidas; embalagem = R$ por unidade vendida.
 * Margem (o que sobrou) = líquido − custo − imposto − embalagem; só existe com custo conhecido.
 */
export function summarize(sales: SaleFact[], unitCost: Map<string, number>, sim: Simulation = { taxPct: 0, packaging: 0 }) {
  const lines = new Map<string, ProductLine & { orderSet: Set<string> }>()
  const orderSet = new Set<string>()
  let cancelled = 0
  for (const s of sales) {
    if (s.status_group === 'cancelada') { cancelled += s.units; continue }
    const k = keyOf(s)
    let l = lines.get(k)
    if (!l) {
      l = { key: k, productId: s.product_id, sku: s.sku, title: s.title, units: 0, returned: 0, gross: 0, net: 0, fees: 0, shipping: 0,
        unitCost: s.product_id ? unitCost.get(s.product_id) ?? null : null, cost: null, tax: 0, packaging: 0, margin: null, orders: 0, orderSet: new Set() }
      lines.set(k, l)
    }
    l.net += s.net_total
    l.fees += s.sale_fees
    l.shipping += s.shipping_net
    if (s.status_group === 'devolvida') { l.returned += s.units; continue }
    l.units += s.units
    l.gross += s.gross_revenue
    l.orderSet.add(s.pack_id ?? s.order_id)
    orderSet.add(s.pack_id ?? s.order_id)
  }
  const out: ProductLine[] = []
  const t: Totals = { units: 0, returned: 0, cancelled, orders: orderSet.size, gross: 0, net: 0, fees: 0, shipping: 0, cost: 0, tax: 0, packaging: 0, costCoveredGross: 0, margin: null, unitsWithoutCost: 0 }
  let marginSum = 0
  for (const { orderSet: os, ...l } of lines.values()) {
    l.orders = os.size
    l.gross = r2(l.gross); l.net = r2(l.net); l.fees = r2(l.fees); l.shipping = r2(l.shipping)
    l.tax = r2((l.gross * sim.taxPct) / 100)
    l.packaging = r2(l.units * sim.packaging)
    t.tax += l.tax; t.packaging += l.packaging
    if (l.unitCost !== null) {
      l.cost = r2(l.unitCost * l.units)
      l.margin = r2(l.net - l.cost - l.tax - l.packaging)
      t.cost += l.cost; marginSum += l.margin; t.costCoveredGross += l.gross
    } else if (l.units > 0) t.unitsWithoutCost += l.units
    t.units += l.units; t.returned += l.returned; t.gross += l.gross; t.net += l.net; t.fees += l.fees; t.shipping += l.shipping
    out.push(l)
  }
  t.gross = r2(t.gross); t.net = r2(t.net); t.fees = r2(t.fees); t.shipping = r2(t.shipping); t.cost = r2(t.cost); t.tax = r2(t.tax); t.packaging = r2(t.packaging); t.costCoveredGross = r2(t.costCoveredGross)
  t.margin = t.costCoveredGross > 0 ? r2(marginSum) : null
  return { lines: out, totals: t }
}

const MONTH = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** Faturamento bruto e unidades por mês (horário de Brasília), meses vazios incluídos. */
export function monthlyGross(sales: SaleFact[]): MonthPoint[] {
  const by = new Map<string, { total: number; count: number }>()
  for (const s of sales) {
    if (s.status_group !== 'ativa') continue
    const k = new Date(new Date(s.sold_at).getTime() - 3 * 3600_000).toISOString().slice(0, 7)
    const m = by.get(k) ?? { total: 0, count: 0 }
    m.total += s.gross_revenue; m.count += s.units
    by.set(k, m)
  }
  const keys = [...by.keys()].sort()
  if (!keys.length) return []
  const out: MonthPoint[] = []
  let [y, mo] = keys[0].split('-').map(Number)
  const [ly, lm] = keys[keys.length - 1].split('-').map(Number)
  while (y < ly || (y === ly && mo <= lm)) {
    const k = `${y}-${String(mo).padStart(2, '0')}`
    const v = by.get(k) ?? { total: 0, count: 0 }
    out.push({ key: k, label: `${MONTH[mo - 1]}/${String(y).slice(2)}`, total: r2(v.total), count: v.count })
    mo++; if (mo > 12) { mo = 1; y++ }
  }
  return out
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Busca por descrição: todas as palavras precisam aparecer (sem diferenciar acento/maiúscula);
 * palavra com "-" na frente exclui (ex.: "mochila -rodas").
 */
export function textMatcher(query: string): ((text: string) => boolean) | null {
  const words = norm(query).split(/\s+/).filter(Boolean)
  const inc = words.filter((w) => !w.startsWith('-'))
  const exc = words.filter((w) => w.startsWith('-') && w.length > 1).map((w) => w.slice(1))
  if (!inc.length && !exc.length) return null
  return (text) => { const t = norm(text); return inc.every((w) => t.includes(w)) && !exc.some((w) => t.includes(w)) }
}
