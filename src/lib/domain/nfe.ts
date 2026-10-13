// Leitura do XML da NF-e (layout 4.00, modelo 55).
// Os valores são mantidos como texto decimal exato (como vieram do XML) para
// não perder precisão; os cálculos usam decimal.js.
import Decimal from 'decimal.js'
import { normalizeGtin } from './validators'

export type NfeTotals = {
  products: string; freight: string; insurance: string; discount: string
  ipi: string; st: string; other: string; invoice: string
}

export type NfeItem = {
  item_number: number
  supplier_code: string
  ean: string | null
  ean_trib: string | null
  description: string
  ncm: string | null
  cest: string | null
  cfop: string | null
  fiscal_origin: number | null
  unit_com: string
  qty_com: string
  unit_price_com: string
  unit_trib: string | null
  qty_trib: string | null
  total_products: string
  discount: string
  freight: string
  insurance: string
  other: string
  ipi_rate: string | null
  ipi_value: string
  st_value: string
}

export type NfeInvoice = {
  access_key: string
  number: string
  series: string
  model: string
  issued_at: string
  nature: string
  purpose: number
  operation_type: number | null
  issuer_cnpj: string
  issuer_name: string
  issuer_trade_name: string | null
  recipient_doc: string | null
  recipient_name: string | null
  totals: NfeTotals
  protocol_status: string | null
  protocol_message: string | null
}

export type ParsedNfe = { invoice: NfeInvoice; items: NfeItem[]; warnings: string[] }

export class NfeError extends Error {}

// ---------------------------------------------------------------------
// Utilidades de leitura (ignoram o namespace do XML)
// ---------------------------------------------------------------------
function all(el: Element | Document | null, name: string): Element[] {
  return el ? Array.from(el.getElementsByTagNameNS('*', name)) : []
}
function first(el: Element | Document | null, name: string): Element | null {
  return all(el, name)[0] ?? null
}
/** Filho direto (evita pegar, por exemplo, o <CNPJ> do destinatário dentro do emitente). */
function child(el: Element | null, name: string): Element | null {
  if (!el) return null
  for (const c of Array.from(el.children)) if (c.localName === name) return c
  return null
}
function txt(el: Element | null, name: string): string {
  return child(el, name)?.textContent?.trim() ?? ''
}
function deepTxt(el: Element | Document | null, name: string): string {
  return first(el, name)?.textContent?.trim() ?? ''
}
/** Número decimal do XML como texto canônico; vazio vira "0". */
function dec(v: string): string {
  if (!v) return '0'
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new NfeError(`Valor numérico inválido no XML: "${v}"`)
  return new Decimal(v).toString()
}
function decOrNull(v: string): string | null {
  return v ? dec(v) : null
}

/** Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9). */
export function isValidAccessKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false
  const digits = key.slice(0, 43).split('').map(Number).reverse()
  const sum = digits.reduce((acc, d, i) => acc + d * ((i % 8) + 2), 0)
  const r = sum % 11
  const dv = r < 2 ? 0 : 11 - r
  return dv === Number(key[43])
}

// ---------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------
export function parseNfe(xmlText: string): ParsedNfe {
  const warnings: string[] = []
  const doc = new DOMParser().parseFromString(xmlText.replace(/^﻿/, ''), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new NfeError('O arquivo não é um XML válido. Verifique se é o XML da NF-e (e não o PDF da DANFE).')
  }
  const infNFe = first(doc, 'infNFe')
  if (!infNFe) {
    if (first(doc, 'infEvento') || first(doc, 'procEventoNFe'))
      throw new NfeError('Este XML é de um evento (cancelamento, carta de correção…), não de uma nota fiscal.')
    throw new NfeError('Este XML não é uma NF-e (não foi encontrada a tag infNFe).')
  }

  const ide = child(infNFe, 'ide')
  const emit = child(infNFe, 'emit')
  const dest = child(infNFe, 'dest')
  const icmsTot = first(child(infNFe, 'total'), 'ICMSTot')

  const model = txt(ide, 'mod') || '55'
  if (model !== '55') throw new NfeError(`Modelo ${model} não suportado. Importe apenas NF-e modelo 55 (notas de compra).`)

  // Chave de acesso: protocolo de autorização ou atributo Id="NFe<chave>"
  const protKey = deepTxt(first(doc, 'protNFe'), 'chNFe')
  const idKey = (infNFe.getAttribute('Id') ?? '').replace(/^NFe/, '')
  const access_key = protKey || idKey
  if (!/^\d{44}$/.test(access_key)) throw new NfeError('Chave de acesso não encontrada ou inválida no XML.')
  if (!isValidAccessKey(access_key)) warnings.push('O dígito verificador da chave de acesso não confere. Confira se o arquivo não foi alterado.')
  if (protKey && idKey && protKey !== idKey) warnings.push('A chave do protocolo é diferente da chave da nota.')

  const infProt = first(first(doc, 'protNFe'), 'infProt')
  const protocol_status = infProt ? txt(infProt, 'cStat') || null : null
  const protocol_message = infProt ? txt(infProt, 'xMotivo') || null : null
  if (!infProt) warnings.push('O XML não tem o protocolo de autorização da SEFAZ (é o arquivo da nota sem o "procNFe").')
  else if (!['100', '150'].includes(protocol_status ?? ''))
    warnings.push(`Situação do protocolo: ${protocol_status} – ${protocol_message ?? ''}. A nota pode não estar autorizada.`)

  const issued = txt(ide, 'dhEmi') || txt(ide, 'dEmi')
  if (!issued) throw new NfeError('Data de emissão não encontrada no XML.')
  const issued_at = /^\d{4}-\d{2}-\d{2}$/.test(issued) ? `${issued}T00:00:00-03:00` : issued

  const purpose = Number(txt(ide, 'finNFe') || '1')
  const tpNF = txt(ide, 'tpNF')

  const issuer_cnpj = txt(emit, 'CNPJ')
  if (!/^\d{14}$/.test(issuer_cnpj)) throw new NfeError('O emitente da nota não tem CNPJ válido (notas de pessoa física não são suportadas).')

  const invoice: NfeInvoice = {
    access_key,
    number: txt(ide, 'nNF'),
    series: txt(ide, 'serie'),
    model,
    issued_at,
    nature: txt(ide, 'natOp'),
    purpose,
    operation_type: tpNF ? Number(tpNF) : null,
    issuer_cnpj,
    issuer_name: txt(emit, 'xNome'),
    issuer_trade_name: txt(emit, 'xFant') || null,
    recipient_doc: txt(dest, 'CNPJ') || txt(dest, 'CPF') || null,
    recipient_name: txt(dest, 'xNome') || null,
    totals: {
      products: dec(txt(icmsTot, 'vProd')),
      freight: dec(txt(icmsTot, 'vFrete')),
      insurance: dec(txt(icmsTot, 'vSeg')),
      discount: dec(txt(icmsTot, 'vDesc')),
      ipi: dec(txt(icmsTot, 'vIPI')),
      st: dec(txt(icmsTot, 'vST')),
      other: dec(txt(icmsTot, 'vOutro')),
      invoice: dec(txt(icmsTot, 'vNF')),
    },
    protocol_status,
    protocol_message,
  }

  const PURPOSE: Record<number, string> = { 2: 'complementar', 3: 'de ajuste', 4: 'de devolução' }
  if (purpose !== 1) warnings.push(`Esta é uma nota ${PURPOSE[purpose] ?? `de finalidade ${purpose}`}. Somente notas normais podem ser importadas.`)
  if (tpNF === '0') warnings.push('A nota é de ENTRADA emitida pelo próprio emitente (tpNF=0). Confira se é mesmo uma compra.')

  const dets = all(infNFe, 'det')
  if (!dets.length) throw new NfeError('Nenhum item encontrado na nota.')

  const items: NfeItem[] = dets.map((det, i) => {
    const prod = child(det, 'prod')
    const imposto = child(det, 'imposto')
    const ipiTrib = first(child(imposto, 'IPI'), 'IPITrib')
    const icmsGroup = child(imposto, 'ICMS')?.firstElementChild ?? null // ICMS00, ICMS10, ICMSSN202...
    const origRaw = txt(icmsGroup, 'orig')
    const st = new Decimal(dec(txt(icmsGroup, 'vICMSST'))).plus(dec(txt(icmsGroup, 'vFCPST')))
    const qty = dec(txt(prod, 'qCom'))
    if (new Decimal(qty).lte(0)) throw new NfeError(`Item ${i + 1}: quantidade inválida.`)
    return {
      item_number: Number(det.getAttribute('nItem') ?? i + 1),
      supplier_code: txt(prod, 'cProd'),
      ean: normalizeGtin(txt(prod, 'cEAN')),
      ean_trib: normalizeGtin(txt(prod, 'cEANTrib')),
      description: txt(prod, 'xProd'),
      ncm: txt(prod, 'NCM') && txt(prod, 'NCM') !== '00' ? txt(prod, 'NCM') : null,
      cest: txt(prod, 'CEST') || null,
      cfop: txt(prod, 'CFOP') || null,
      fiscal_origin: /^[0-8]$/.test(origRaw) ? Number(origRaw) : null,
      unit_com: txt(prod, 'uCom').toUpperCase(),
      qty_com: qty,
      unit_price_com: dec(txt(prod, 'vUnCom')),
      unit_trib: txt(prod, 'uTrib').toUpperCase() || null,
      qty_trib: decOrNull(txt(prod, 'qTrib')),
      total_products: dec(txt(prod, 'vProd')),
      discount: dec(txt(prod, 'vDesc')),
      freight: dec(txt(prod, 'vFrete')),
      insurance: dec(txt(prod, 'vSeg')),
      other: dec(txt(prod, 'vOutro')),
      ipi_rate: decOrNull(txt(ipiTrib, 'pIPI')),
      ipi_value: dec(txt(ipiTrib, 'vIPI')),
      st_value: st.toString(),
    }
  })

  // Conferência: soma dos itens x total da nota
  const sumProducts = items.reduce((acc, it) => acc.plus(it.total_products), new Decimal(0))
  if (!sumProducts.equals(invoice.totals.products))
    warnings.push(`A soma dos itens (${sumProducts.toFixed(2)}) é diferente do total de produtos da nota (${new Decimal(invoice.totals.products).toFixed(2)}).`)

  return { invoice, items, warnings }
}

// ---------------------------------------------------------------------
// Conversão de unidade
// ---------------------------------------------------------------------
const PACK_UNITS = ['CX', 'CXA', 'CAIXA', 'DZ', 'DUZIA', 'PCT', 'PC2', 'KIT', 'FD', 'FARDO', 'JG', 'PAR', 'CJ']

/** Unidade comercial que provavelmente agrupa várias unidades (exige fator de conversão). */
export function isPackUnit(unit: string | null | undefined): boolean {
  if (!unit) return false
  return PACK_UNITS.includes(unit.toUpperCase().replace(/[^A-Z0-9]/g, ''))
}

/**
 * Fator sugerido: DZ = 12; se a unidade tributável for UN e diferente da comercial,
 * usa qTrib / qCom quando der um número inteiro (ex.: 2 CX com qTrib 24 UN = 12).
 */
export function suggestConversionFactor(it: Pick<NfeItem, 'unit_com' | 'qty_com' | 'unit_trib' | 'qty_trib'>): number {
  const u = it.unit_com.toUpperCase()
  if (u === 'DZ' || u === 'DUZIA') return 12
  if (it.unit_trib && it.qty_trib && it.unit_trib !== it.unit_com && /^(UN|UND|UNID|PC|PCA|PECA)$/.test(it.unit_trib)) {
    const ratio = new Decimal(it.qty_trib).dividedBy(it.qty_com)
    if (ratio.isInteger() && ratio.gt(1)) return ratio.toNumber()
  }
  return 1
}

/** SHA-256 do arquivo, para registro e conferência. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
