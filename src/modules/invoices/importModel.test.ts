import { describe, expect, it } from 'vitest'
import { parseNfe } from '@/lib/domain/nfe'
import { buildPayload, checkReady, createNew, ignoreItem, initialDecision, linkTo } from './importModel'

import normalXml from '@/test/fixtures/nfe-proc-normal.xml?raw'

const parsed = parseNfe(normalXml)
const [mochila, estojo] = parsed.items
const none = { item_number: 1, ean_product_id: null, ean_product_name: null, sku_product_id: null, sku_product_name: null }

describe('decisão inicial de cada item', () => {
  it('EAN conhecido vincula automaticamente', () => {
    const d = initialDecision(mochila, { ...none, ean_product_id: 'p1', ean_product_name: 'Mochila' }, [])
    expect(d).toMatchObject({ action: 'link', product_id: 'p1', match_method: 'ean', status: 'ean' })
  })
  it('código do fornecedor conhecido vincula automaticamente', () => {
    const d = initialDecision(mochila, { ...none, sku_product_id: 'p2', sku_product_name: 'Mochila' }, [])
    expect(d).toMatchObject({ action: 'link', product_id: 'p2', match_method: 'supplier_sku' })
  })
  it('EAN e código apontando produtos diferentes exige decisão', () => {
    const d = initialDecision(mochila, { ...none, ean_product_id: 'p1', ean_product_name: 'A', sku_product_id: 'p2', sku_product_name: 'B' }, [])
    expect(d).toMatchObject({ action: null, status: 'conflito' })
  })
  it('descrição parecida não vincula sozinha: pede confirmação', () => {
    const d = initialDecision(mochila, none, [{ id: 'p3', name: 'Mochila 16', brand: null, supplier_sku: null, ean: null, score: 0.7 }])
    expect(d).toMatchObject({ action: null, status: 'sugestao' })
  })
  it('sem correspondência: novo cadastro', () => {
    expect(initialDecision(mochila, none, [])).toMatchObject({ action: 'create', status: 'sem_cadastro' })
  })
  it('caixa com qTrib em unidades sugere o fator; caixa sem pista pede revisão', () => {
    expect(initialDecision(estojo, none, []).conversion_factor).toBe(12)
    expect(initialDecision(estojo, none, []).factor_needs_review).toBe(false)
    const semPista = { ...estojo, unit_trib: 'CX', qty_trib: '2' }
    expect(initialDecision(semPista, none, [])).toMatchObject({ conversion_factor: 1, factor_needs_review: true })
  })
})

describe('pronto para gravar', () => {
  const ok = [initialDecision(mochila, none, []), initialDecision(estojo, none, [])]
  it('nota coerente fica pronta', () => {
    expect(checkReady(parsed, ok, null)).toEqual({ ready: true, problems: [] })
  })
  it('bloqueia nota duplicada, item sem decisão e fator a confirmar', () => {
    const pend = { ...ok[0], action: null } as const
    const fator = { ...ok[1], factor_needs_review: true }
    const r = checkReady(parsed, [pend, fator], 'inv-1')
    expect(r.ready).toBe(false)
    expect(r.problems.join(' ')).toMatch(/já foi importada/)
    expect(r.problems.join(' ')).toMatch(/precisa de decisão/)
    expect(r.problems.join(' ')).toMatch(/fator de conversão/)
  })
  it('item ignorado não precisa de fator confirmado', () => {
    const fator = ignoreItem({ ...ok[1], factor_needs_review: true })
    expect(checkReady(parsed, [ok[0], fator], null).ready).toBe(true)
  })
  it('bloqueia nota de devolução', () => {
    const dev = { ...parsed, invoice: { ...parsed.invoice, purpose: 4 } }
    expect(checkReady(dev, ok, null).ready).toBe(false)
  })
})

describe('dados enviados ao banco', () => {
  it('leva ação, produto, fator e motivo de cada item', () => {
    const ds = [linkTo(initialDecision(mochila, none, []), 'p9', 'Mochila X', 'Conferido na etiqueta'), createNew(initialDecision(estojo, none, []))]
    const p = buildPayload(parsed, ds, { path: 'k.xml', sha256: 'abc' })
    expect(p.invoice.xml_path).toBe('k.xml')
    expect(p.items[0]).toMatchObject({ action: 'link', product_id: 'p9', match_method: 'manual', match_reason: 'Conferido na etiqueta', total_products: '1078.8' })
    expect(p.items[1]).toMatchObject({ action: 'create', conversion_factor: 12 })
  })
})
