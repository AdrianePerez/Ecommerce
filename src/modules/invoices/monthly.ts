import type { MonthPoint } from './MonthlyChart'

const TZ = 'America/Sao_Paulo'
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "2026-10" no horário de Brasília. */
export const monthKey = (iso: string | Date) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ }).slice(0, 7)
export const monthLabel = (key: string) => `${MESES[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`

function addMonths(key: string, n: number) {
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7)) - 1 + n
  const yy = y + Math.floor(m / 12)
  const mm = ((m % 12) + 12) % 12
  return `${yy}-${String(mm + 1).padStart(2, '0')}`
}

/**
 * Soma por mês, incluindo meses sem entrada (zero).
 * Sem período informado: os 12 meses até o mês atual (ou até a última nota, se for mais recente).
 */
export function buildMonths(
  rows: { date: string; total: number }[], opts: { from?: string; to?: string; today?: Date } = {},
): MonthPoint[] {
  const nowKey = monthKey(opts.today ?? new Date())
  const lastData = rows.reduce((mx, r) => (monthKey(r.date) > mx ? monthKey(r.date) : mx), '')
  const end = opts.to ? opts.to.slice(0, 7) : (lastData > nowKey ? lastData : nowKey)
  let start = opts.from ? opts.from.slice(0, 7) : addMonths(end, -11)
  if (start > end) start = end
  // limite de 36 barras para continuar legível
  if (addMonths(start, 36) <= end) start = addMonths(end, -35)

  const sums = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    const k = monthKey(r.date)
    const s = sums.get(k) ?? { total: 0, count: 0 }
    s.total += Number(r.total)
    s.count += 1
    sums.set(k, s)
  }
  const out: MonthPoint[] = []
  for (let k = start; k <= end; k = addMonths(k, 1)) {
    const s = sums.get(k)
    out.push({ key: k, label: monthLabel(k), total: Math.round((s?.total ?? 0) * 100) / 100, count: s?.count ?? 0 })
  }
  return out
}
