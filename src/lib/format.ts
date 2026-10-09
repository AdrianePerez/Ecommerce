// Formatação no padrão brasileiro. Toda exibição de números, moeda e datas passa por aqui.

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

type Numeric = number | string | null | undefined

function toNumber(v: Numeric): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function formatBRL(v: Numeric): string {
  const n = toNumber(v)
  return n === null ? '—' : brlFmt.format(n)
}

export function formatNumber(v: Numeric, decimals = 2): string {
  const n = toNumber(v)
  if (n === null) return '—'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d)
}

/** Medida armazenada em milímetros exibida em centímetros. */
export function formatMmAsCm(mm: Numeric): string {
  const n = toNumber(mm)
  return n === null ? '—' : `${formatNumber(n / 10, 1)} cm`
}

/** Peso armazenado em gramas: exibe em g até 1 kg e em kg acima disso. */
export function formatGrams(g: Numeric): string {
  const n = toNumber(g)
  if (n === null) return '—'
  return n >= 1000 ? `${formatNumber(n / 1000, 3)} kg` : `${formatNumber(n, 1)} g`
}

export function formatCnpj(cnpj: string | null | undefined): string {
  if (!cnpj) return '—'
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14) return cnpj
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}
