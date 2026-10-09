import { describe, expect, it } from 'vitest'
import { cmToMm, mmToCmInput, parseBrDecimal, toDbDecimal } from './numbers'
import { isValidCest, isValidCnpj, isValidGtin, isValidNcm, normalizeGtin } from './validators'
import { emptyProductForm, formToProduct, missingFields, productFormSchema, productToForm } from './product'
import type { Product } from '@/lib/database.types'

describe('parseBrDecimal', () => {
  it('aceita formatos brasileiros e internacionais', () => {
    expect(parseBrDecimal('1.234,56')!.toString()).toBe('1234.56')
    expect(parseBrDecimal('1234,5')!.toString()).toBe('1234.5')
    expect(parseBrDecimal('12.5')!.toString()).toBe('12.5')
    expect(parseBrDecimal('  ')).toBeNull()
  })
  it('recusa texto inválido', () => {
    expect(() => parseBrDecimal('12,3,4')).toThrow()
    expect(() => parseBrDecimal('abc')).toThrow()
    expect(() => parseBrDecimal('1.23,4')).toThrow()
  })
  it('não perde precisão com valores de ponto flutuante problemáticos', () => {
    expect(toDbDecimal('0,1')).toBe('0.1')
    expect(parseBrDecimal('0,1')!.plus(parseBrDecimal('0,2')!).toString()).toBe('0.3')
  })
})

describe('conversão de medidas', () => {
  it('cm → mm e volta', () => {
    expect(cmToMm('42,5')).toBe('425')
    expect(cmToMm('30')).toBe('300')
    expect(cmToMm('')).toBeNull()
    expect(mmToCmInput(425)).toBe('42,5')
    expect(mmToCmInput(null)).toBe('')
  })
})

describe('validadores', () => {
  it('GTIN com dígito verificador', () => {
    expect(isValidGtin('7891234567895')).toBe(true)
    expect(isValidGtin('7891234567890')).toBe(false)
    expect(isValidGtin('96385074')).toBe(true) // GTIN-8
    expect(isValidGtin('123')).toBe(false)
  })
  it('SEM GTIN vira nulo', () => {
    expect(normalizeGtin('SEM GTIN')).toBeNull()
    expect(normalizeGtin(' 7891234567895 ')).toBe('7891234567895')
  })
  it('CNPJ', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11222333000180')).toBe(false)
    expect(isValidCnpj('00000000000000')).toBe(false)
  })
  it('NCM e CEST', () => {
    expect(isValidNcm('42029200')).toBe(true)
    expect(isValidNcm('4202.92.00')).toBe(true)
    expect(isValidNcm('4202920')).toBe(false)
    expect(isValidNcm('4202920A')).toBe(false)
    expect(isValidCest('2804800')).toBe(true)
    expect(isValidCest('28.048.00')).toBe(true)
  })
})

describe('formulário de produto', () => {
  const base = { ...emptyProductForm, commercial_name: 'Mochila Infantil 16"' }

  it('exige nome comercial ou descrição da nota', () => {
    const r = productFormSchema.safeParse(emptyProductForm)
    expect(r.success).toBe(false)
  })

  it('converte medidas e dados fiscais para o banco', () => {
    const p = formToProduct({ ...base, height_cm: '42,5', weight_g: '850', ncm: '4202.92.00', fiscal_origin: '1' })
    expect(p.height_mm).toBe('425')
    expect(p.weight_g).toBe('850')
    expect(p.ncm).toBe('42029200')
    expect(p.fiscal_origin).toBe(1)
    expect(p.fiscal_source).toBe('manual')
    expect(p.internal_sku).toBeNull()
  })

  it('preserva a origem fiscal quando NCM/CEST/origem não mudaram', () => {
    const prev = { ncm: '42029200', cest: null, fiscal_origin: 1, fiscal_source: 'nfe' as const }
    const p = formToProduct({ ...base, ncm: '42029200', fiscal_origin: '1' }, prev)
    expect(p.fiscal_source).toBe('nfe')
    const changed = formToProduct({ ...base, ncm: '42021220', fiscal_origin: '1' }, prev)
    expect(changed.fiscal_source).toBe('manual')
  })

  it('sem dados fiscais não registra origem fiscal', () => {
    expect(formToProduct(base).fiscal_source).toBeNull()
  })

  it('recusa EAN inválido e capacidade sem unidade', () => {
    expect(productFormSchema.safeParse({ ...base, ean: '7891234567890' }).success).toBe(false)
    expect(productFormSchema.safeParse({ ...base, capacity_value: '20' }).success).toBe(false)
  })

  it('exige fornecedor quando há código do fornecedor', () => {
    expect(productFormSchema.safeParse({ ...base, supplier_sku: 'MC1601' }).success).toBe(false)
  })

  it('ida e volta banco → formulário → banco mantém os valores', () => {
    const row = {
      ...formToProduct({ ...base, height_cm: '42,5', width_cm: '30', depth_cm: '15', weight_g: '850,5' }),
      id: 'x', created_at: '', updated_at: '', created_by: null, archived_at: null,
      height_mm: 425, width_mm: 300, depth_mm: 150, weight_g: 850.5,
    } as unknown as Product
    const again = formToProduct(productToForm(row))
    expect(again.height_mm).toBe('425')
    expect(again.width_mm).toBe('300')
    expect(again.weight_g).toBe('850.5')
  })
})

describe('completude', () => {
  it('lista o que falta', () => {
    const missing = missingFields({
      commercial_name: 'X', brand: null, ean: null, supplier_sku: 'A1', ncm: null,
      height_mm: 10, width_mm: null, depth_mm: 10, weight_g: null,
    })
    expect(missing.map((m) => m.key)).toEqual(['brand', 'ncm', 'dimensions', 'weight'])
  })
})
