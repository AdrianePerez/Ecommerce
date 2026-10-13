import { describe, expect, it } from 'vitest'
import { breakdown, priceForMargin, roundUpTo90, tierFor, validateParams, type PricingParams } from './pricing'

// Regra parecida com Mercado Livre Clássico (valores ilustrativos)
const ml: PricingParams = {
  tiers: [
    { min_price: 0, commission_pct: 14, fixed_fee: 6 },
    { min_price: 79, commission_pct: 14, fixed_fee: 0 },
  ],
  shipping_fee: 20, shipping_min_price: 79, extra_pct: 0, tax_pct: 6, packaging_cost: 1.5, other_fixed: 0, other_pct: 0, target_margin_pct: 20,
}
// Regra parecida com TikTok Shop (comissão diferente por faixa)
const tt: PricingParams = {
  tiers: [
    { min_price: 0, commission_pct: 10, fixed_fee: 4 },
    { min_price: 50, commission_pct: 6, fixed_fee: 6 },
  ],
  shipping_fee: 0, shipping_min_price: null, extra_pct: 6, tax_pct: 6, packaging_cost: 1.5, other_fixed: 0, other_pct: 0, target_margin_pct: 20,
}

describe('detalhamento', () => {
  it('soma percentuais sobre o preço e fixos por faixa', () => {
    const b = breakdown(100, 50, ml)
    expect(b.commission).toBe(14)
    expect(b.tax).toBe(6)
    expect(b.fixedFee).toBe(0)
    expect(b.shipping).toBe(20) // ≥ 79: frete por conta do vendedor
    expect(b.totalCosts).toBe(91.5)
    expect(b.profit).toBe(8.5)
    expect(b.marginPct).toBe(8.5)
    expect(b.markup).toBe(2)
  })
  it('abaixo de 79 entra a tarifa fixa e sai o frete', () => {
    const b = breakdown(70, 30, ml)
    expect(b.fixedFee).toBe(6)
    expect(b.shipping).toBe(0)
    expect(b.profit).toBe(70 - 30 - 9.8 - 4.2 - 6 - 1.5)
  })
  it('margem é sobre a venda; markup é sobre o custo', () => {
    const b = breakdown(200, 100, { ...ml, tiers: [{ min_price: 0, commission_pct: 0, fixed_fee: 0 }], tax_pct: 0, shipping_fee: 0, packaging_cost: 0 })
    expect(b.marginPct).toBe(50)
    expect(b.markup).toBe(2)
  })
})

describe('preço para a margem desejada', () => {
  it('resolve com percentuais no denominador (não é custo × margem)', () => {
    const s = priceForMargin(30, ml, 20)
    // trecho < 79: (30 + 6 + 1,5) / (1 − 0,14 − 0,06 − 0,20) = 62,50
    expect(s.price).toBe(62.5)
    expect(breakdown(s.price!, 30, ml).marginPct).toBeGreaterThanOrEqual(20)
  })
  it('pula para a faixa seguinte quando o preço calculado não cabe na faixa', () => {
    const s = priceForMargin(50, ml, 20)
    // < 79: (50+7,5)/0,6 = 95,84 → fora do trecho; ≥ 79: (50+20+1,5)/0,6 = 119,17
    expect(s.price).toBe(119.17)
    expect(breakdown(119.17, 50, ml).marginPct).toBeGreaterThanOrEqual(20)
  })
  it('comissão diferente por faixa (TikTok)', () => {
    const s = priceForMargin(20, tt, 20)
    // < 50: (20+4+1,5)/(1−0,10−0,06−0,06−0,20) = 25,5/0,58 = 43,97
    expect(s.price).toBe(43.97)
    const s2 = priceForMargin(40, tt, 20)
    // < 50: 45,5/0,58 = 78,45 → fora; ≥ 50: (40+6+1,5)/(1−0,06−0,06−0,06−0,20) = 47,5/0,62 = 76,62
    expect(s2.price).toBe(76.62)
  })
  it('margem impossível e sem custo', () => {
    expect(priceForMargin(30, ml, 85).price).toBeNull()
    expect(priceForMargin(0, ml, 20).reason).toMatch(/custo/)
  })
  it('a faixa escolhida segue o preço', () => {
    expect(tierFor(tt.tiers, 49.99).commission_pct).toBe(10)
    expect(tierFor(tt.tiers, 50).commission_pct).toBe(6)
  })
})

describe('utilidades', () => {
  it('arredonda para ,90', () => {
    expect(roundUpTo90(152.13)).toBe(152.9)
    expect(roundUpTo90(152.9)).toBe(152.9)
    expect(roundUpTo90(152.95)).toBe(153.9)
  })
  it('valida a regra', () => {
    expect(validateParams(ml)).toEqual([])
    expect(validateParams({ ...ml, tiers: [{ min_price: 10, commission_pct: 14, fixed_fee: 0 }] })).toContain('A primeira faixa precisa começar em R$ 0,00.')
    expect(validateParams({ ...ml, tax_pct: 120 }).length).toBe(1)
  })
})
