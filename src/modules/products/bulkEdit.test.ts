import { describe, expect, it } from 'vitest'
import { buildBulkChanges, describeChanges } from './bulkEdit'

describe('alteração em massa — montagem dos dados', () => {
  it('só envia os campos marcados e converte medidas', () => {
    const r = buildBulkChanges(
      { material: ' POLIESTER ', height_mm: '42,5', weight_g: '850,5', color: 'ignorado', ncm: '4202.92.00' },
      new Set(['material', 'height_mm', 'weight_g', 'ncm']),
    )
    expect(r.valid).toBe(true)
    expect(r.changes).toEqual({ material: 'POLIESTER', height_mm: '425', weight_g: '850.5', ncm: '42029200' })
  })
  it('campo marcado e vazio é erro (não apaga dados por engano)', () => {
    const r = buildBulkChanges({ material: '' }, new Set(['material']))
    expect(r.valid).toBe(false)
    expect(r.errors.material).toMatch(/Informe/)
  })
  it('valida números, NCM, ano e capacidade', () => {
    const r = buildBulkChanges(
      { height_mm: '-3', ncm: '123', collection_year: '20', capacity_value: '20' },
      new Set(['height_mm', 'ncm', 'collection_year', 'capacity']),
    )
    expect(Object.keys(r.errors).sort()).toEqual(['capacity', 'collection_year', 'height_mm', 'ncm'])
  })
  it('capacidade leva valor e unidade juntos', () => {
    const r = buildBulkChanges({ capacity_value: '20', capacity_unit: 'L' }, new Set(['capacity']))
    expect(r.changes).toEqual({ capacity_value: '20', capacity_unit: 'L' })
  })
  it('nada marcado não é válido', () => {
    expect(buildBulkChanges({ material: 'X' }, new Set()).valid).toBe(false)
  })
  it('resumo em português para a confirmação', () => {
    expect(describeChanges({ material: 'POLIESTER', height_mm: '425', pkg_height_mm: '450', status: 'em_preparacao' })).toEqual([
      'Status do cadastro: Em preparação', 'Material: POLIESTER', 'Altura: 42,5 cm', 'Embalagem · Altura: 45 cm',
    ])
  })
})
