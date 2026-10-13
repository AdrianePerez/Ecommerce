import { supabase } from '@/lib/supabase'
import { breakdown, priceForMargin, type Breakdown, type PriceTier, type PricingParams } from '@/lib/domain/pricing'

export interface PricingRule {
  id: string
  marketplace_id: string
  name: string
  version: number
  is_active: boolean
  tiers: PriceTier[]
  shipping_fee: number
  shipping_min_price: number | null
  extra_pct: number
  tax_pct: number
  packaging_cost: number
  other_fixed: number
  other_pct: number
  target_margin_pct: number
  notes: string | null
  checked_on: string | null
  created_at: string
  marketplace: { name: string; code: string }
}

export type RuleInput = Omit<PricingRule, 'id' | 'version' | 'is_active' | 'created_at' | 'marketplace'>

const n = (v: unknown) => (v == null ? 0 : Number(v))

/** Converte a regra do banco nos parâmetros do cálculo (frete do anúncio substitui o da regra). */
export function toParams(r: PricingRule, shippingOverride?: number | null): PricingParams {
  return {
    tiers: r.tiers.map((t) => ({ min_price: n(t.min_price), commission_pct: n(t.commission_pct), fixed_fee: n(t.fixed_fee) })),
    shipping_fee: shippingOverride ?? n(r.shipping_fee),
    shipping_min_price: r.shipping_min_price == null ? null : n(r.shipping_min_price),
    extra_pct: n(r.extra_pct), tax_pct: n(r.tax_pct), packaging_cost: n(r.packaging_cost),
    other_fixed: n(r.other_fixed), other_pct: n(r.other_pct), target_margin_pct: n(r.target_margin_pct),
  }
}

/** Avisos de regra incompleta (valores que a empresa precisa informar). */
export function ruleWarnings(r: PricingRule) {
  const w: string[] = []
  if (n(r.tax_pct) === 0) w.push('impostos não informados')
  if (n(r.packaging_cost) === 0) w.push('embalagem não informada')
  return w
}

/** O vendedor paga frete neste canal (o valor real é informado por anúncio/simulação). */
export const chargesShipping = (r: PricingRule) => r.shipping_min_price != null || n(r.shipping_fee) > 0

/** Falta informar o frete para este preço (canal cobra frete e não há valor nem padrão). */
export function shippingMissing(r: PricingRule, shipping: number | null | undefined, price: number | null) {
  if (shipping != null || n(r.shipping_fee) > 0) return false
  if (r.shipping_min_price == null) return false
  return price == null || price >= n(r.shipping_min_price)
}

export const ruleLabel = (r: Pick<PricingRule, 'name' | 'marketplace'>) => `${r.marketplace.name} · ${r.name}`

export async function listPricingRules(opts: { activeOnly?: boolean } = {}) {
  let q = supabase.from('pricing_rules').select('*, marketplace:marketplace_configs(name, code)')
  if (opts.activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q.order('marketplace_id').order('name').order('version', { ascending: false })
  if (error) throw error
  return (data ?? []) as PricingRule[]
}

/** Grava uma nova versão (a anterior fica no histórico) e já ativa. */
export async function createRuleVersion(input: RuleInput) {
  const { data: last, error: e1 } = await supabase.from('pricing_rules').select('version')
    .eq('marketplace_id', input.marketplace_id).ilike('name', input.name.trim()).order('version', { ascending: false }).limit(1).maybeSingle()
  if (e1) throw e1
  const { data, error } = await supabase.from('pricing_rules')
    .insert({ ...input, name: input.name.trim(), version: ((last as { version: number } | null)?.version ?? 0) + 1, is_active: false })
    .select('id').single()
  if (error) throw error
  await activateRule((data as { id: string }).id)
}

export async function activateRule(id: string) {
  const { error } = await supabase.rpc('activate_pricing_rule', { p_rule_id: id })
  if (error) throw error
}

// ---------------------------------------------------------------------
// Simulações
// ---------------------------------------------------------------------
export interface Simulation {
  id: string
  product_id: string
  listing_id: string | null
  pricing_rule_id: string
  unit_cost: number
  cost_source: 'custo_medio' | 'manual'
  price: number
  shipping_fee: number
  target_margin_pct: number | null
  min_price_for_target: number | null
  profit: number
  margin_pct: number | null
  results: Breakdown
  applied: boolean
  note: string | null
  created_at: string
  rule?: { name: string; version: number; marketplace: { name: string } }
}

export function simulate(rule: PricingRule, cost: number, price: number, opts: { shipping?: number | null; target?: number } = {}) {
  const params = toParams(rule, opts.shipping)
  const target = opts.target ?? params.target_margin_pct
  return { params, target, result: breakdown(price, cost, params), min: priceForMargin(cost, params, target) }
}

export async function saveSimulation(s: {
  productId: string; listingId?: string | null; rule: PricingRule; cost: number; costSource: 'custo_medio' | 'manual'
  price: number; shipping?: number | null; target?: number; applied?: boolean; note?: string | null
}) {
  const { params, target, result, min } = simulate(s.rule, s.cost, s.price, { shipping: s.shipping, target: s.target })
  const { error } = await supabase.from('pricing_simulations').insert({
    product_id: s.productId, listing_id: s.listingId ?? null, pricing_rule_id: s.rule.id, unit_cost: s.cost, cost_source: s.costSource,
    price: s.price, shipping_fee: params.shipping_fee, target_margin_pct: target, min_price_for_target: min.price,
    profit: result.profit, margin_pct: result.marginPct, results: { ...result, rule_version: s.rule.version }, applied: !!s.applied, note: s.note ?? null,
  })
  if (error) throw error
}

export async function listSimulations(productId: string) {
  const { data, error } = await supabase.from('pricing_simulations')
    .select('*, rule:pricing_rules(name, version, marketplace:marketplace_configs(name))')
    .eq('product_id', productId).order('created_at', { ascending: false }).limit(30)
  if (error) throw error
  return (data ?? []) as Simulation[]
}

export async function lastAppliedSimulation(listingId: string) {
  const { data, error } = await supabase.from('pricing_simulations').select('*')
    .eq('listing_id', listingId).eq('applied', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data as Simulation | null
}

/** Aplica o preço no anúncio (não altera nada no canal) e registra a simulação. */
export async function applyPriceToListing(a: {
  listingId: string; productId: string; rule: PricingRule; cost: number; price: number; shipping?: number | null; target?: number
}) {
  const { error } = await supabase.from('product_listings')
    .update({ suggested_price: a.price, pricing_rule_id: a.rule.id, ...(a.shipping !== undefined ? { shipping_cost: a.shipping } : {}) })
    .eq('id', a.listingId)
  if (error) throw error
  await saveSimulation({ productId: a.productId, listingId: a.listingId, rule: a.rule, cost: a.cost, costSource: 'custo_medio',
    price: a.price, shipping: a.shipping, target: a.target, applied: true })
}
