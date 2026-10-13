// Custo gerencial de aquisição — PRÉVIA na tela de conferência.
// A gravação usa public.compute_item_cost() no banco (fonte oficial).
// Os testes (cost.test.ts e invoices_costs.test.sql) usam os mesmos casos
// para garantir que as duas implementações dão o mesmo resultado.
import Decimal from 'decimal.js'

export type CostRule = {
  id: string
  version: number
  name: string
  include_ipi: boolean
  include_freight: boolean
  include_insurance: boolean
  include_other: boolean
  include_st: boolean
  subtract_discount: boolean
  is_active: boolean
  notes: string | null
  created_at: string
}

export type CostComponents = {
  total_products: Decimal.Value
  ipi_value?: Decimal.Value
  freight?: Decimal.Value
  insurance?: Decimal.Value
  other?: Decimal.Value
  st_value?: Decimal.Value
  discount?: Decimal.Value
}

type RuleFlags = Pick<CostRule, 'include_ipi' | 'include_freight' | 'include_insurance' | 'include_other' | 'include_st' | 'subtract_discount'>

export function itemCostTotal(c: CostComponents, rule: RuleFlags): Decimal {
  const d = (v: Decimal.Value | undefined) => new Decimal(v ?? 0)
  let total = d(c.total_products)
  if (rule.include_ipi) total = total.plus(d(c.ipi_value))
  if (rule.include_freight) total = total.plus(d(c.freight))
  if (rule.include_insurance) total = total.plus(d(c.insurance))
  if (rule.include_other) total = total.plus(d(c.other))
  if (rule.include_st) total = total.plus(d(c.st_value))
  if (rule.subtract_discount) total = total.minus(d(c.discount))
  return total
}

/** Custo por unidade do produto (quantidade da nota × fator de conversão). */
export function unitCost(c: CostComponents, qtyCom: Decimal.Value, factor: Decimal.Value, rule: RuleFlags): Decimal {
  const baseQty = new Decimal(qtyCom).times(factor)
  if (baseQty.lte(0)) throw new Error('Quantidade deve ser maior que zero')
  return itemCostTotal(c, rule).dividedBy(baseQty).toDecimalPlaces(6)
}

/** Custo médio ponderado = soma dos custos ÷ soma das quantidades. */
export function weightedAverage(entries: { quantity: Decimal.Value; cost_total: Decimal.Value }[]): Decimal | null {
  const qty = entries.reduce((a, e) => a.plus(e.quantity), new Decimal(0))
  if (qty.lte(0)) return null
  const cost = entries.reduce((a, e) => a.plus(e.cost_total), new Decimal(0))
  return cost.dividedBy(qty).toDecimalPlaces(6)
}

export function describeRule(r: RuleFlags): string {
  const parts = ['produtos']
  if (r.include_ipi) parts.push('IPI')
  if (r.include_freight) parts.push('frete')
  if (r.include_insurance) parts.push('seguro')
  if (r.include_other) parts.push('outras despesas')
  if (r.include_st) parts.push('ICMS-ST')
  return `(${parts.join(' + ')}${r.subtract_discount ? ' − descontos' : ''}) ÷ quantidade`
}
