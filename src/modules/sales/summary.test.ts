import { describe, expect, it } from 'vitest'
import { monthlyGross, summarize, type SaleFact } from './summary'

const sale = (o: Partial<SaleFact>): SaleFact => ({ order_id: Math.random().toString(), pack_id: null, sold_at: '2026-11-20T10:00:00-03:00',
  status_group: 'ativa', sku: 'A', product_id: 'p1', title: 'Mochila', units: 1, gross_revenue: 100, sale_fees: -15, shipping_net: -20, net_total: 65, ...o })

describe('painel de vendas', () => {
  it('agrupa por produto, conta pacote como um pedido e calcula margem com custo médio', () => {
    const { lines, totals } = summarize([
      sale({ pack_id: 'P1' }), sale({ pack_id: 'P1', sku: 'B', product_id: 'p2', gross_revenue: 50, net_total: 30 }),
      sale({ units: 2, gross_revenue: 200, net_total: 130 }),
    ], new Map([['p1', 40]]))
    const a = lines.find((l) => l.productId === 'p1')!
    expect(a).toMatchObject({ units: 3, gross: 300, net: 195, cost: 120, margin: 75, orders: 2 })
    const b = lines.find((l) => l.productId === 'p2')!
    expect(b.cost).toBeNull()
    expect(totals).toMatchObject({ units: 4, orders: 2, gross: 350, net: 225, cost: 120, margin: 75, unitsWithoutCost: 1 })
  })

  it('canceladas ficam fora; devolvidas contam à parte e o valor que sobrou entra no líquido', () => {
    const { lines, totals } = summarize([
      sale({}), sale({ status_group: 'cancelada', units: 5, gross_revenue: 500, net_total: 0 }),
      sale({ status_group: 'devolvida', gross_revenue: 100, net_total: -10 }),
    ], new Map())
    expect(lines[0]).toMatchObject({ units: 1, returned: 1, gross: 100, net: 55 })
    expect(totals).toMatchObject({ units: 1, returned: 1, cancelled: 5, margin: null })
  })

  it('SKU sem produto agrupa pelo SKU (sem diferenciar maiúsculas)', () => {
    const { lines } = summarize([sale({ product_id: null, sku: 'xyz' }), sale({ product_id: null, sku: 'XYZ' })], new Map())
    expect(lines).toHaveLength(1)
    expect(lines[0].units).toBe(2)
  })

  it('meses no horário de Brasília, com meses vazios', () => {
    const m = monthlyGross([sale({ sold_at: '2026-09-01T01:00:00Z' }), sale({ sold_at: '2026-11-03T12:00:00-03:00', units: 2, gross_revenue: 300 })])
    expect(m.map((x) => [x.label, x.total, x.count])).toEqual([['ago/26', 100, 1], ['set/26', 0, 0], ['out/26', 0, 0], ['nov/26', 300, 2]])
  })
})

import { textMatcher } from './summary'
describe('busca por descrição', () => {
  it('todas as palavras, sem acento/maiúscula, com exclusão', () => {
    const m = textMatcher('mochila  sônic -rodas')!
    expect(m('MOCHILA JUVENIL SONIC AZUL')).toBe(true)
    expect(m('MOCHILA COM RODAS JUVENIL SONIC AZUL')).toBe(false)
    expect(m('LANCHEIRA SONIC')).toBe(false)
    expect(textMatcher('   ')).toBeNull()
  })
})

describe('simulação de imposto e embalagem', () => {
  it('desconta % do bruto e R$ por unidade do que sobrou', () => {
    const { lines, totals } = summarize([sale({ units: 2, gross_revenue: 200, net_total: 130 }), sale({ product_id: null, sku: 'X', gross_revenue: 100, net_total: 60 })],
      new Map([['p1', 40]]), { taxPct: 7.68, packaging: 2 })
    const a = lines.find((l) => l.productId === 'p1')!
    expect(a).toMatchObject({ tax: 15.36, packaging: 4, cost: 80, margin: 30.64 })
    expect(totals).toMatchObject({ tax: 23.04, packaging: 6, margin: 30.64, costCoveredGross: 200 })
  })
})
