import { describe, expect, it } from 'vitest'
import { NfeError, isPackUnit, isValidAccessKey, parseNfe, suggestConversionFactor } from './nfe'
import { describeRule, itemCostTotal, unitCost, weightedAverage } from './cost'

import normalXml from '@/test/fixtures/nfe-proc-normal.xml?raw'
import semProtocoloXml from '@/test/fixtures/nfe-sem-protocolo-dz.xml?raw'
import devolucaoXml from '@/test/fixtures/nfe-devolucao.xml?raw'

const FIXTURES: Record<string, string> = {
  'nfe-proc-normal.xml': normalXml, 'nfe-sem-protocolo-dz.xml': semProtocoloXml, 'nfe-devolucao.xml': devolucaoXml,
}
const fixture = (name: string) => FIXTURES[name]
const RULE_V1 = { include_ipi: true, include_freight: false, include_insurance: false, include_other: false, include_st: false, subtract_discount: false }

describe('parseNfe — nota autorizada (procNFe)', () => {
  const { invoice, items, warnings } = parseNfe(fixture('nfe-proc-normal.xml'))

  it('lê o cabeçalho', () => {
    expect(invoice.access_key).toBe('42260912345678000199550010000123451000012341')
    expect(invoice.number).toBe('12345')
    expect(invoice.series).toBe('1')
    expect(invoice.issued_at).toBe('2026-09-15T14:30:00-03:00')
    expect(invoice.issuer_cnpj).toBe('12345678000199')
    expect(invoice.issuer_name).toBe('FORNECEDOR FICTICIO DE TESTE LTDA')
    expect(invoice.issuer_trade_name).toBe('FICTICIO')
    expect(invoice.recipient_doc).toBe('98765432000155')
    expect(invoice.protocol_status).toBe('100')
    expect(invoice.purpose).toBe(1)
  })

  it('lê os totais como texto decimal exato', () => {
    expect(invoice.totals).toMatchObject({
      products: '1520.4', freight: '21.58', discount: '10', ipi: '105.18', st: '52.35', invoice: '1689.51',
    })
  })

  it('lê os itens com impostos e unidades', () => {
    expect(items).toHaveLength(2)
    const [a, b] = items
    expect(a).toMatchObject({
      item_number: 1, supplier_code: 'MC1601', ean: '7891234567895', ncm: '42029200', cest: '2804800',
      cfop: '6102', fiscal_origin: 2, unit_com: 'UN', qty_com: '12', unit_price_com: '89.9',
      total_products: '1078.8', freight: '21.58', discount: '10', ipi_rate: '9.75', ipi_value: '105.18',
      st_value: '52.35',
    })
    // "SEM GTIN" vira nulo; IPI não tributado (IPINT) vira zero; Simples Nacional tem origem
    expect(b).toMatchObject({
      supplier_code: 'ES0207', ean: null, ean_trib: null, unit_com: 'CX', qty_com: '2',
      unit_trib: 'UN', qty_trib: '24', ipi_value: '0', ipi_rate: null, fiscal_origin: 0, cest: null,
    })
  })

  it('não gera avisos para uma nota coerente', () => {
    expect(warnings).toEqual([])
  })
})

describe('parseNfe — casos especiais', () => {
  it('nota sem protocolo, data no formato antigo e soma divergente geram avisos', () => {
    const r = parseNfe(fixture('nfe-sem-protocolo-dz.xml'))
    expect(r.invoice.access_key).toBe('42261002345678000199550010000007771000007770')
    expect(r.invoice.issued_at).toBe('2026-10-02T00:00:00-03:00')
    expect(r.invoice.protocol_status).toBeNull()
    expect(r.items[0].ean).toBeNull()
    expect(r.warnings.some((w) => w.includes('protocolo'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('soma dos itens'))).toBe(true)
  })

  it('nota de devolução é identificada', () => {
    const r = parseNfe(fixture('nfe-devolucao.xml'))
    expect(r.invoice.purpose).toBe(4)
    expect(r.warnings.some((w) => w.includes('devolução'))).toBe(true)
  })

  it('recusa arquivos que não são NF-e', () => {
    expect(() => parseNfe('isto não é xml')).toThrow(NfeError)
    expect(() => parseNfe('<root><a/></root>')).toThrow(/não é uma NF-e/)
    expect(() => parseNfe('<procEventoNFe><evento><infEvento/></evento></procEventoNFe>')).toThrow(/evento/)
    expect(() => parseNfe(fixture('nfe-proc-normal.xml').replace('<mod>55</mod>', '<mod>65</mod>'))).toThrow(/Modelo 65/)
  })

  it('aceita arquivo com BOM no início', () => {
    expect(parseNfe('﻿' + fixture('nfe-proc-normal.xml')).items).toHaveLength(2)
  })
})

describe('chave de acesso', () => {
  it('valida o dígito verificador', () => {
    expect(isValidAccessKey('42260912345678000199550010000123451000012341')).toBe(true)
    expect(isValidAccessKey('42260912345678000199550010000123451000012342')).toBe(false)
    expect(isValidAccessKey('123')).toBe(false)
  })
})

describe('conversão de unidade', () => {
  it('identifica unidades de embalagem', () => {
    expect(isPackUnit('CX')).toBe(true)
    expect(isPackUnit('dz')).toBe(true)
    expect(isPackUnit('UN')).toBe(false)
  })
  it('sugere fator pelo qTrib ou pela dúzia', () => {
    expect(suggestConversionFactor({ unit_com: 'CX', qty_com: '2', unit_trib: 'UN', qty_trib: '24' })).toBe(12)
    expect(suggestConversionFactor({ unit_com: 'DZ', qty_com: '3', unit_trib: 'DZ', qty_trib: '3' })).toBe(12)
    expect(suggestConversionFactor({ unit_com: 'UN', qty_com: '5', unit_trib: 'UN', qty_trib: '5' })).toBe(1)
    expect(suggestConversionFactor({ unit_com: 'CX', qty_com: '3', unit_trib: 'UN', qty_trib: '10' })).toBe(1) // não inteiro
  })
})

describe('custo gerencial (mesmos casos do teste SQL)', () => {
  it('regra v1: (produtos + IPI) ÷ quantidade', () => {
    expect(unitCost({ total_products: 1000 }, 10, 1, RULE_V1).toNumber()).toBe(100)
    expect(unitCost({ total_products: 2400, ipi_value: 200 }, 20, 1, RULE_V1).toNumber()).toBe(130)
    expect(unitCost({ total_products: 240 }, 2, 12, RULE_V1).toNumber()).toBe(10)
  })
  it('custo médio ponderado: 10 × 100 + 20 × 130 = 120', () => {
    expect(weightedAverage([{ quantity: 10, cost_total: 1000 }, { quantity: 20, cost_total: 2600 }])!.toNumber()).toBe(120)
    expect(weightedAverage([])).toBeNull()
  })
  it('frete, ST e desconto só entram quando a regra manda', () => {
    const c = { total_products: '1078.8', ipi_value: '105.18', freight: '21.58', st_value: '52.35', discount: '10' }
    expect(itemCostTotal(c, RULE_V1).toString()).toBe('1183.98')
    expect(itemCostTotal(c, { ...RULE_V1, include_freight: true, include_st: true, subtract_discount: true }).toString()).toBe('1247.91')
  })
  it('sem erro de ponto flutuante', () => {
    expect(itemCostTotal({ total_products: '0.1', ipi_value: '0.2' }, RULE_V1).toString()).toBe('0.3')
  })
  it('descreve a regra em português', () => {
    expect(describeRule(RULE_V1)).toBe('(produtos + IPI) ÷ quantidade')
  })
})
