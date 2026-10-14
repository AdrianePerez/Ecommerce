import { describe, expect, it } from 'vitest'
import { buildMonths, monthKey } from './monthly'
import { niceMax } from './MonthlyChart'

describe('entradas por mês', () => {
  it('usa o mês de Brasília (nota às 23h do dia 31 continua no mês)', () => {
    expect(monthKey('2026-11-01T01:30:00Z')).toBe('2026-10')
  })
  it('soma por mês e preenche meses vazios com zero', () => {
    const m = buildMonths([
      { date: '2026-08-10T12:00:00-03:00', total: 1000 },
      { date: '2026-08-20T12:00:00-03:00', total: 500.5 },
      { date: '2026-10-02T12:00:00-03:00', total: 300 },
    ], { from: '2026-08-01', to: '2026-10-31' })
    expect(m.map((x) => [x.label, x.total, x.count])).toEqual([['ago/26', 1500.5, 2], ['set/26', 0, 0], ['out/26', 300, 1]])
  })
  it('sem período: 12 meses até o mês atual', () => {
    const m = buildMonths([], { today: new Date('2026-10-13T12:00:00-03:00') })
    expect(m).toHaveLength(12)
    expect(m[0].key).toBe('2025-11')
    expect(m[11].key).toBe('2026-10')
  })
  it('escala redonda do eixo', () => {
    expect(niceMax(37200)).toBe(50000)
    expect(niceMax(180)).toBe(200)
    expect(niceMax(0)).toBe(1)
  })
})
