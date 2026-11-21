import { describe, expect, it } from 'vitest'
import { checkDigit, ean13Modules, normalizeEan13 } from './ean13'

describe('EAN-13', () => {
  it('calcula o dígito verificador', () => {
    expect(checkDigit('789965015068')).toBe(4)
    expect(checkDigit('400638133393')).toBe(1)
  })
  it('valida e normaliza', () => {
    expect(normalizeEan13('7899650150684')).toBe('7899650150684')
    expect(normalizeEan13('7899650150685')).toBeNull()
    expect(normalizeEan13('036000291452')).toBe('0036000291452') // UPC-A
    expect(normalizeEan13('SEM GTIN')).toBeNull()
    expect(normalizeEan13(null)).toBeNull()
  })
  it('gera os 95 módulos com as guardas', () => {
    const m = ean13Modules('4006381333931')
    expect(m).toHaveLength(95)
    expect(m.startsWith('101')).toBe(true)
    expect(m.slice(45, 50)).toBe('01010')
    expect(m.endsWith('101')).toBe(true)
    // referência conhecida do primeiro dígito à esquerda (0 com paridade L para "4": LGLLGG)
    expect(m.slice(3, 10)).toBe('0001101')
  })
})
