// Validações de identificadores brasileiros e de produto.

export const onlyDigits = (s: string) => s.replace(/\D/g, '')

/** EAN/GTIN (8, 12, 13 ou 14 dígitos) com dígito verificador módulo 10. */
export function isValidGtin(value: string): boolean {
  const d = value.trim()
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(d)) return false
  const digits = d.split('').map(Number)
  const check = digits.pop()!
  // pesos 3 e 1 alternados, a partir do dígito mais à direita (sem o verificador)
  const sum = digits
    .reverse()
    .reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

/** Notas fiscais usam "SEM GTIN" quando o produto não tem código de barras. */
export function normalizeGtin(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim()
  if (v === '' || /SEM\s*GTIN/i.test(v)) return null
  return v
}

export function isValidCnpj(value: string): boolean {
  const c = onlyDigits(value)
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((acc, w, i) => acc + Number(c[i]) * w, 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13])
}

export const isValidNcm = (v: string) => /^\d{8}$/.test(onlyDigits(v)) && onlyDigits(v).length === v.replace(/[.\s]/g, '').length
export const isValidCest = (v: string) => /^\d{7}$/.test(onlyDigits(v)) && onlyDigits(v).length === v.replace(/[.\s]/g, '').length

/** Origem da mercadoria (tabela A do ICMS), 0 a 8. */
export const FISCAL_ORIGINS: Record<number, string> = {
  0: '0 · Nacional',
  1: '1 · Estrangeira — importação direta',
  2: '2 · Estrangeira — adquirida no mercado interno',
  3: '3 · Nacional, conteúdo de importação > 40% e ≤ 70%',
  4: '4 · Nacional, produção conforme processos produtivos básicos',
  5: '5 · Nacional, conteúdo de importação ≤ 40%',
  6: '6 · Estrangeira — importação direta, sem similar nacional (CAMEX)',
  7: '7 · Estrangeira — mercado interno, sem similar nacional (CAMEX)',
  8: '8 · Nacional, conteúdo de importação > 70%',
}
