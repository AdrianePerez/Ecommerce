// Cálculo de preço de venda e margem por canal.
// Nenhuma tarifa fica no código: tudo vem da regra (tabela pricing_rules).
//
// Definições (estimativas, não resultado contábil):
//   receita = preço de venda
//   custos  = custo de aquisição + tarifa fixa da faixa + frete por conta do vendedor + embalagem + outros fixos
//             + preço × (comissão da faixa + outras taxas do canal + impostos + outros %)
//   lucro   = preço − custos
//   margem  = lucro ÷ preço            (sobre a venda)
//   markup  = preço ÷ custo de aquisição (multiplicador sobre o custo)
import Decimal from 'decimal.js'

export interface PriceTier {
  /** a faixa vale a partir deste preço (inclusive) */
  min_price: number
  commission_pct: number
  fixed_fee: number
}

export interface PricingParams {
  tiers: PriceTier[]
  /** frete pago pelo vendedor, em R$ por venda, quando o preço ≥ shipping_min_price */
  shipping_fee: number
  shipping_min_price: number | null
  /** outras taxas do canal sobre o preço (ex.: programa de frete grátis) */
  extra_pct: number
  tax_pct: number
  packaging_cost: number
  other_fixed: number
  other_pct: number
  target_margin_pct: number
}

export interface Breakdown {
  price: number
  cost: number
  commissionPct: number
  commission: number
  fixedFee: number
  shipping: number
  extra: number
  tax: number
  packaging: number
  otherFixed: number
  otherPct: number
  /** tudo menos o custo de aquisição */
  channelAndSaleCosts: number
  totalCosts: number
  profit: number
  /** lucro ÷ preço, em % */
  marginPct: number | null
  /** preço ÷ custo */
  markup: number | null
}

const D = (n: number | null | undefined) => new Decimal(n ?? 0)
const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()

export function sortedTiers(tiers: PriceTier[]) {
  return [...tiers].sort((a, b) => a.min_price - b.min_price)
}

export function tierFor(tiers: PriceTier[], price: number): PriceTier {
  const t = sortedTiers(tiers)
  let cur = t[0] ?? { min_price: 0, commission_pct: 0, fixed_fee: 0 }
  for (const x of t) if (price >= x.min_price) cur = x
  return cur
}

function shippingAt(p: PricingParams, price: number) {
  return p.shipping_min_price == null || price >= p.shipping_min_price ? p.shipping_fee : 0
}

/** Detalhamento para um preço informado. */
export function breakdown(price: number, cost: number, p: PricingParams): Breakdown {
  const P = D(price)
  const tier = tierFor(p.tiers, price)
  const commission = P.times(tier.commission_pct).div(100)
  const extra = P.times(p.extra_pct).div(100)
  const tax = P.times(p.tax_pct).div(100)
  const otherPct = P.times(p.other_pct).div(100)
  const fixedFee = D(tier.fixed_fee)
  const shipping = D(shippingAt(p, price))
  const packaging = D(p.packaging_cost)
  const otherFixed = D(p.other_fixed)
  const channel = commission.plus(extra).plus(tax).plus(otherPct).plus(fixedFee).plus(shipping).plus(packaging).plus(otherFixed)
  const total = channel.plus(cost)
  const profit = P.minus(total)
  return {
    price: money(P), cost: money(D(cost)), commissionPct: tier.commission_pct,
    commission: money(commission), fixedFee: money(fixedFee), shipping: money(shipping), extra: money(extra), tax: money(tax),
    packaging: money(packaging), otherFixed: money(otherFixed), otherPct: money(otherPct),
    channelAndSaleCosts: money(channel), totalCosts: money(total), profit: money(profit),
    marginPct: P.gt(0) ? profit.div(P).times(100).toDecimalPlaces(2).toNumber() : null,
    markup: D(cost).gt(0) ? P.div(cost).toDecimalPlaces(2).toNumber() : null,
  }
}

export interface PriceSolution {
  price: number | null
  /** motivo quando não há preço possível */
  reason?: string
}

/**
 * Menor preço que atinge a margem desejada.
 * Comissão, tarifa fixa e frete mudam por faixa de preço, então a conta é feita
 * em cada trecho entre os pontos de corte: P = (custo + fixos) ÷ (1 − %variáveis − margem).
 */
export function priceForMargin(cost: number, p: PricingParams, marginPct: number): PriceSolution {
  if (!(cost > 0)) return { price: null, reason: 'Sem custo de aquisição para calcular.' }
  const cuts = new Set<number>([0, ...p.tiers.map((t) => t.min_price)])
  if (p.shipping_min_price != null) cuts.add(p.shipping_min_price)
  const points = [...cuts].filter((x) => x >= 0).sort((a, b) => a - b)
  const m = D(marginPct).div(100)
  let best: Decimal | null = null
  for (let i = 0; i < points.length; i++) {
    const lo = points[i]
    const hi = i + 1 < points.length ? points[i + 1] : Infinity
    const tier = tierFor(p.tiers, lo)
    const pct = D(tier.commission_pct).plus(p.extra_pct).plus(p.tax_pct).plus(p.other_pct).div(100)
    const denom = new Decimal(1).minus(pct).minus(m)
    if (denom.lte(0)) continue
    const fixed = D(tier.fixed_fee).plus(shippingAt(p, lo)).plus(p.packaging_cost).plus(p.other_fixed)
    let P = D(cost).plus(fixed).div(denom).toDecimalPlaces(2, Decimal.ROUND_UP)
    if (P.lt(lo)) P = new Decimal(lo) // abaixo do trecho: o início do trecho já atinge a margem
    if (P.lt(hi)) {
      // confere com o detalhamento (arredondamento) e escolhe o menor
      const b = breakdown(P.toNumber(), cost, p)
      if (b.marginPct != null && b.marginPct + 1e-9 >= marginPct && (!best || P.lt(best))) best = P
    }
  }
  if (!best) return { price: null, reason: 'A margem desejada não é possível com estas taxas (percentuais somados passam de 100%).' }
  return { price: best.toNumber() }
}

/** Arredonda para cima até o próximo final ,90 (ex.: 152,13 → 152,90; 152,95 → 153,90). */
export function roundUpTo90(price: number) {
  const base = Math.floor(price)
  const c = base + 0.9
  return Number((price <= c + 1e-9 ? c : c + 1).toFixed(2))
}

/** Valida a regra antes de gravar. Devolve a lista de problemas. */
export function validateParams(p: PricingParams): string[] {
  const errs: string[] = []
  if (!p.tiers.length) errs.push('Informe pelo menos uma faixa de preço.')
  const mins = p.tiers.map((t) => t.min_price)
  if (new Set(mins).size !== mins.length) errs.push('Duas faixas começam no mesmo preço.')
  if (!mins.includes(0)) errs.push('A primeira faixa precisa começar em R$ 0,00.')
  for (const t of p.tiers) {
    if (t.commission_pct < 0 || t.commission_pct >= 100) errs.push('Comissão deve ficar entre 0% e 99,99%.')
    if (t.fixed_fee < 0 || t.min_price < 0) errs.push('Valores de faixa não podem ser negativos.')
  }
  for (const [k, v] of [['Impostos', p.tax_pct], ['Outras taxas do canal', p.extra_pct], ['Outros %', p.other_pct], ['Margem desejada', p.target_margin_pct]] as const)
    if (v < 0 || v >= 100) errs.push(`${k} deve ficar entre 0% e 99,99%.`)
  for (const [k, v] of [['Frete', p.shipping_fee], ['Embalagem', p.packaging_cost], ['Outros custos fixos', p.other_fixed]] as const)
    if (v < 0) errs.push(`${k} não pode ser negativo.`)
  return [...new Set(errs)]
}
