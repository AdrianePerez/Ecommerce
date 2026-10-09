import Decimal from 'decimal.js'

/**
 * Converte texto digitado no padrão brasileiro em Decimal.
 * Aceita "1.234,56", "1234,56", "1234.56" e "12". Retorna null para vazio.
 * Lança erro para texto inválido.
 */
export function parseBrDecimal(input: string | number | null | undefined): Decimal | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Número inválido')
    return new Decimal(input)
  }
  const s = input.trim().replace(/\s/g, '')
  if (s === '') return null

  let normalized: string
  if (s.includes(',')) {
    // vírgula é o separador decimal; pontos são separadores de milhar
    if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) throw new Error(`Número inválido: ${input}`)
    normalized = s.replace(/\./g, '').replace(',', '.')
  } else {
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Número inválido: ${input}`)
    normalized = s
  }
  return new Decimal(normalized)
}

/** Converte centímetros digitados para milímetros (string decimal exata para o banco). */
export function cmToMm(cm: string | number | null | undefined): string | null {
  const d = parseBrDecimal(cm)
  return d === null ? null : d.times(10).toDecimalPlaces(1).toString()
}

/** Converte milímetros do banco para o texto em centímetros usado nos formulários. */
export function mmToCmInput(mm: string | number | null | undefined): string {
  if (mm === null || mm === undefined || mm === '') return ''
  return new Decimal(mm).dividedBy(10).toDecimalPlaces(2).toString().replace('.', ',')
}

/** Converte número do banco para o texto exibido em um campo de formulário. */
export function toInputText(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  return new Decimal(v).toString().replace('.', ',')
}

/** Converte texto do formulário em string decimal para o banco. */
export function toDbDecimal(v: string | number | null | undefined): string | null {
  const d = parseBrDecimal(v)
  return d === null ? null : d.toString()
}
