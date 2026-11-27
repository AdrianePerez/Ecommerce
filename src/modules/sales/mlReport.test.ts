import { describe, expect, it } from 'vitest'
import { parseMlDate, parseMlSales, statusGroup } from './mlReport'
import type { Cell } from '@/lib/xlsx'

// Cabeçalhos reais do relatório (grupos + títulos); dados abaixo são fictícios.
const [GROUPS, HEADERS] = [["Vendas", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "Publicidade", "Anúncios", null, null, null, null, null, "Faturamento ao comprador", null, null, null, null, null, "Compradores", null, null, null, null, null, null, null, "Envios", null, null, null, null, null, null, "Devoluções", null, null, null, null, null, null, null, null, null, null, null, null, "Reclamações", null, null, null], ["N.º de venda", "Data de venda", "Depósito", "Estado", "Descrição do status", "Pacote de diversos produtos", "Pertence a um kit", "Unidades", "Receita por produtos (BRL)", "Receita por acréscimo no preço (pago pelo comprador)", "Taxa de parcelamento equivalente ao acréscimo", "Tarifa de venda e impostos (BRL)", "Receita por envio (BRL)", "Tarifas de envio (BRL)", "Custo de envio com base nas medidas e peso declarados", "Custo por diferenças nas medidas e no peso do pacote", "Descontos e bônus", "Cancelamentos e reembolsos (BRL)", "Total (BRL)", "Mês de faturamento das suas tarifas", "Pedido de compra", "Venda por publicidade", "SKU", "# de anúncio", "Título do anúncio", "Variação", "Preço unitário de venda do anúncio (BRL)", "Tipo de anúncio", "NF-e em anexo", "Dados pessoais ou da empresa", "Tipo e número do documento", "Endereço", "Tipo de contribuinte", "Inscrição estadual", "Comprador", "Negócio", "CPF", "Endereço", "Cidade", "Estado", "CEP", "País", "Forma de entrega", "Data a caminho", "Data de entrega", "Transportador", "Identificador do envio", "Número de rastreamento", "URL de acompanhamento", "Unidades", "Forma de entrega", "Data a caminho", "Data de entrega", "Transportador", "Número de rastreamento", "URL de acompanhamento", "Revisado pelo Mercado Livre", "Data de revisão", "Dinheiro liberado", "Resultado", "Destino", "Motivo do resultado", "Unidades", "Reclamação aberta", "Reclamação encerrada", "Em mediação"]] as Cell[][]
const col = (group: string, title: string) => {
  let g = ''
  for (let i = 0; i < HEADERS.length; i++) {
    if (GROUPS[i]) g = String(GROUPS[i])
    if (g === group && HEADERS[i] === title) return i
  }
  throw new Error(group + title)
}
const C = {
  order: col('Vendas', 'N.º de venda'), date: col('Vendas', 'Data de venda'), status: col('Vendas', 'Estado'),
  kit: col('Vendas', 'Pertence a um kit'), units: col('Vendas', 'Unidades'), gross: col('Vendas', 'Receita por produtos (BRL)'),
  fees: col('Vendas', 'Tarifa de venda e impostos (BRL)'), shipFee: col('Vendas', 'Tarifas de envio (BRL)'),
  discounts: col('Vendas', 'Descontos e bônus'), refunds: col('Vendas', 'Cancelamentos e reembolsos (BRL)'), total: col('Vendas', 'Total (BRL)'),
  sku: col('Anúncios', 'SKU'), listing: col('Anúncios', '# de anúncio'), unitPrice: col('Anúncios', 'Preço unitário de venda do anúncio (BRL)'),
  buyer: col('Compradores', 'Comprador'), cpf: col('Compradores', 'CPF'), uf: col('Compradores', 'Estado'), ship: col('Envios', 'Forma de entrega'),
}
const row = (v: Partial<Record<keyof typeof C, Cell>>) => {
  const r: Cell[] = Array(HEADERS.length).fill(' ')
  for (const [k, val] of Object.entries(v)) r[C[k as keyof typeof C]] = val as Cell
  return r
}
const sheet = (...rows: Cell[][]) => [[], ['Neste relatório…'], [], ['Vendas'], GROUPS, HEADERS, ...rows]

describe('relatório de vendas do Mercado Livre', () => {
  it('lê a data em português com fuso de Brasília', () => {
    expect(parseMlDate('26 de novembro de 2026 21:24 hs.')).toBe('2026-11-26T21:24:00-03:00')
    expect(parseMlDate('5 de março de 2026 08:07 hs')).toBe('2026-03-05T08:07:00-03:00')
    expect(parseMlDate('')).toBeNull()
  })

  it('venda simples: valores, UF e sem dados pessoais', () => {
    const r = parseMlSales(sheet(row({ order: '100', date: '20 de junho de 2026 23:18 hs', status: 'Entregue', units: 1, gross: 146.66,
      fees: -27.87, shipFee: -21.05, discounts: 3.34, total: 101.08, sku: 'MS49861SO0600UN', listing: 'MLB1', unitPrice: 146.66,
      buyer: 'Fulano', cpf: '00000000000', uf: 'Santa Catarina', ship: 'Mercado Envios Full' })))
    expect(r.rows).toHaveLength(1)
    const s = r.rows[0]
    expect(s).toMatchObject({ order_id: '100', sku: 'MS49861SO0600UN', units: 1, gross_revenue: 146.66, sale_fees: -27.87,
      shipping_net: -21.05, discounts: 3.34, net_total: 101.08, buyer_state: 'SC', shipping_mode: 'Mercado Envios Full', status_group: 'ativa' })
    expect(JSON.stringify(s)).not.toContain('Fulano')
    expect(JSON.stringify(s)).not.toContain('00000000000')
  })

  it('pacote: rateia os valores pelo preço de cada item e herda UF/envio', () => {
    const r = parseMlSales(sheet(
      row({ order: 'P1', date: '26 de novembro de 2026 20:42 hs.', status: 'Pacote de 3 produtos', gross: 699.9, fees: -87.82, shipFee: -45.25,
        discounts: 72.06, total: 638.89, uf: 'Ceará', ship: 'Correios e pontos de envio' }),
      row({ order: 'I1', date: '26 de novembro de 2026 20:42 hs.', status: 'Para enviar', units: 1, sku: 'A', listing: 'MLB1', unitPrice: 448.72 }),
      row({ order: 'I2', date: '26 de novembro de 2026 20:42 hs.', status: 'Para enviar', units: 1, sku: 'B', listing: 'MLB2', unitPrice: 126.87 }),
      row({ order: 'I3', date: '26 de novembro de 2026 20:42 hs.', status: 'Para enviar', units: 1, sku: 'C', listing: 'MLB3', unitPrice: 124.31 }),
    ))
    expect(r.rows.map((x) => x.order_id)).toEqual(['I1', 'I2', 'I3'])
    expect(r.rows.map((x) => x.gross_revenue)).toEqual([448.72, 126.87, 124.31])
    const sum = (k: 'net_total' | 'sale_fees') => Math.round(r.rows.reduce((a, x) => a + x[k], 0) * 100) / 100
    expect(sum('net_total')).toBe(638.89)
    expect(sum('sale_fees')).toBe(-87.82)
    expect(r.rows.every((x) => x.pack_id === 'P1' && x.buyer_state === 'CE' && x.shipping_mode === 'Correios e pontos de envio')).toBe(true)
  })

  it('kit dentro do pacote guarda o anúncio do kit', () => {
    const r = parseMlSales(sheet(
      row({ order: 'P2', date: '26 de novembro de 2026 21:24 hs.', status: 'Pacote de 2 produtos', gross: 599.9, total: 559.05 }),
      row({ order: 'K1', date: '26 de novembro de 2026 21:24 hs.', status: 'Etiqueta impressa', kit: 'MLB5574798241', units: 1, sku: 'M', listing: 'MLB8', unitPrice: 464.75 }),
      row({ order: 'K2', date: '26 de novembro de 2026 21:24 hs.', status: 'Etiqueta impressa', kit: 'MLB5574798241', units: 1, sku: 'L', listing: 'MLB5', unitPrice: 135.15 }),
    ))
    expect(r.rows.map((x) => x.kit_ext_id)).toEqual(['MLB5574798241', 'MLB5574798241'])
    expect(r.rows[0].gross_revenue + r.rows[1].gross_revenue).toBeCloseTo(599.9, 2)
  })

  it('classifica devolução e cancelamento', () => {
    expect(statusGroup('Venda cancelada. Não envie.', 0)).toBe('cancelada')
    expect(statusGroup('Devolução revisada', 0)).toBe('devolvida')
    expect(statusGroup('Entregue', -114.48)).toBe('devolvida')
    expect(statusGroup('A caminho', 0)).toBe('ativa')
  })

  it('recusa arquivo que não é o relatório', () => {
    expect(() => parseMlSales([['Produto', 'Preço']])).toThrow(/relatório de Vendas/)
  })
})
