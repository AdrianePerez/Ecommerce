// Código de barras EAN-13 (GTIN-13) sem dependências: gera a sequência de barras
// (1 = barra preta, 0 = espaço) para desenhar em SVG.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

export function checkDigit(first12: string) {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

/** Normaliza para EAN-13 válido (UPC-A de 12 dígitos ganha o 0 na frente). Inválido → null. */
export function normalizeEan13(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  const code = d.length === 12 ? `0${d}` : d
  if (!/^\d{13}$/.test(code)) return null
  return checkDigit(code.slice(0, 12)) === Number(code[12]) ? code : null
}

/** Módulos do código (95 posições) para um EAN-13 já validado. */
export function ean13Modules(code: string): string {
  const parity = PARITY[Number(code[0])]
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[Number(code[i])]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += R[Number(code[i])]
  return bits + '101'
}
