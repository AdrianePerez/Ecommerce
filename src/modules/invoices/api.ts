import { supabase } from '@/lib/supabase'
import type { NfeItem } from '@/lib/domain/nfe'
import type { CostRule } from '@/lib/domain/cost'
import type { CostHistoryEntry, Invoice, InvoiceItem, ProductCostSummary } from '@/lib/database.types'
import type { ItemMatch, Suggestion } from './importModel'

export const INVOICE_PAGE_SIZE = 25

// ---------------------------------------------------------------------
// Antes de importar
// ---------------------------------------------------------------------
export async function findImportedByKeys(keys: string[]) {
  if (!keys.length) return new Map<string, string>()
  const { data, error } = await supabase.from('invoices').select('id, access_key').in('access_key', keys)
  if (error) throw error
  return new Map((data ?? []).map((r: { id: string; access_key: string }) => [r.access_key, r.id]))
}

export async function matchItems(issuerCnpj: string, items: NfeItem[]) {
  const { data, error } = await supabase.rpc('match_invoice_items', {
    p_issuer_cnpj: issuerCnpj,
    p_items: items.map((i) => ({ item_number: i.item_number, ean: i.ean, supplier_code: i.supplier_code })),
  })
  if (error) throw error
  return new Map(((data ?? []) as ItemMatch[]).map((m) => [m.item_number, m]))
}

export async function suggestProducts(text: string, limit = 5): Promise<Suggestion[]> {
  const { data, error } = await supabase.rpc('suggest_products', { p_text: text, p_limit: limit })
  if (error) throw error
  return (data ?? []) as Suggestion[]
}

export async function getActiveCostRule() {
  const { data, error } = await supabase.from('cost_rules').select('*').eq('is_active', true).maybeSingle()
  if (error) throw error
  return data as CostRule | null
}

// ---------------------------------------------------------------------
// Importação
// ---------------------------------------------------------------------
/** Guarda o XML original no armazenamento privado. Caminho fixo pela chave (reenvio não duplica). */
export async function uploadXml(accessKey: string, xmlText: string) {
  const path = `${accessKey}.xml`
  const { error } = await supabase.storage
    .from('nfe-xml')
    .upload(path, new Blob([xmlText], { type: 'application/xml' }), { contentType: 'application/xml', upsert: false })
  // Já existe: tentativa anterior enviou o arquivo, mas a nota não foi gravada. O conteúdo é o mesmo (mesma chave).
  if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`Não foi possível guardar o XML: ${error.message}`)
  return path
}

export async function importInvoice(payload: unknown) {
  const { data, error } = await supabase.rpc('import_invoice', { p_payload: payload })
  if (error) throw error
  return data as string
}

export function duplicateIdFromError(e: unknown): string | null {
  const m = /NOTA_JA_IMPORTADA:([0-9a-f-]{36})/.exec((e as Error)?.message ?? '')
  return m ? m[1] : null
}

// ---------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------
export type InvoiceStage = 'em_transito' | 'cadastro_pendente' | 'em_preparacao' | 'finalizada'
export const STAGE_LABEL: Record<InvoiceStage, string> = {
  em_transito: 'Em trânsito', cadastro_pendente: 'Cadastro pendente', em_preparacao: 'Em preparação', finalizada: 'Finalizada',
}
export type InvoiceListRow = Invoice & {
  received_at: string | null
  supplier_name: string | null
  supplier_trade_name: string | null
  items_total: number
  items_ignored: number
  products_total: number
  products_incomplete: number
  products_ready: number
  stage: InvoiceStage
}

export interface InvoiceFilters {
  search?: string
  /** número da NF (exato, sem zeros à esquerda) */
  number?: string
  supplierId?: string
  /** datas no formato AAAA-MM-DD (inclusivas), horário de Brasília */
  issuedFrom?: string
  issuedTo?: string
  enteredFrom?: string
  enteredTo?: string
  stage?: InvoiceStage | ''
}

const dayStart = (d: string) => `${d}T00:00:00-03:00`
function nextDay(d: string) {
  const x = new Date(`${d}T12:00:00-03:00`)
  x.setDate(x.getDate() + 1)
  return dayStart(x.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyInvoiceFilters(q: any, f: InvoiceFilters) {
  const t = (f.search ?? '').trim().replace(/[^0-9A-Za-zÀ-ú ]/g, '')
  if (t) {
    const digits = t.replace(/\D/g, '')
    const ors = [`issuer_name.ilike.*${t}*`]
    if (digits) ors.push(`number.eq.${digits.replace(/^0+/, '') || '0'}`, `access_key.like.*${digits}*`, `issuer_cnpj.like.*${digits}*`)
    q = q.or(ors.join(','))
  }
  const num = (f.number ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if (num) q = q.eq('number', num)
  if (f.supplierId) q = q.eq('supplier_id', f.supplierId)
  if (f.issuedFrom) q = q.gte('issued_at', dayStart(f.issuedFrom))
  if (f.issuedTo) q = q.lt('issued_at', nextDay(f.issuedTo))
  if (f.enteredFrom) q = q.gte('imported_at', dayStart(f.enteredFrom))
  if (f.enteredTo) q = q.lt('imported_at', nextDay(f.enteredTo))
  if (f.stage) q = q.eq('stage', f.stage)
  return q
}

export async function listInvoices(f: InvoiceFilters, page: number) {
  const q = applyInvoiceFilters(supabase
    .from('invoice_monitor')
    .select('*', { count: 'exact' })
    .order('issued_at', { ascending: false })
    .range(page * INVOICE_PAGE_SIZE, page * INVOICE_PAGE_SIZE + INVOICE_PAGE_SIZE - 1), f)
  const { data, error, count } = await q
  if (error) throw error
  return { rows: (data ?? []) as InvoiceListRow[], total: count ?? 0 }
}

export interface InvoiceTotals { id: string; issued_at: string; imported_at: string; supplier_id: string; total_invoice: number; total_products: number; total_ipi: number; stage: InvoiceStage }

/** Todas as notas do filtro (só os totais), para o painel por mês. */
export async function listInvoiceTotals(f: InvoiceFilters) {
  const out: InvoiceTotals[] = []
  for (let from = 0; ; from += 1000) {
    const q = applyInvoiceFilters(supabase.from('invoice_monitor')
      .select('id, issued_at, imported_at, supplier_id, total_invoice, total_products, total_ipi, stage')
      .order('issued_at').range(from, from + 999), f)
    const { data, error } = await q
    if (error) throw error
    out.push(...((data ?? []) as InvoiceTotals[]))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Notas para escolher em filtros (mais recentes primeiro). */
export async function listInvoiceOptions() {
  const { data, error } = await supabase.from('invoices').select('id, number, series, issued_at, issuer_name, supplier:suppliers(name, trade_name)')
    .order('issued_at', { ascending: false }).limit(500)
  if (error) throw error
  return ((data ?? []) as unknown as { id: string; number: string; series: string | null; issued_at: string; issuer_name: string
    supplier: { name: string; trade_name: string | null } | null }[])
    .map((r) => ({ id: r.id, number: r.number, issued_at: r.issued_at, supplier: r.supplier?.trade_name || r.supplier?.name || r.issuer_name }))
}

/** Registra (ou desfaz, com null) o recebimento da mercadoria. Data AAAA-MM-DD. */
export async function setInvoiceReceived(id: string, receivedOn: string | null) {
  const { error } = await supabase.rpc('set_invoice_received', { p_invoice_id: id, p_received_on: receivedOn })
  if (error) throw error
}

export async function getInvoiceMonitor(id: string) {
  const { data, error } = await supabase.from('invoice_monitor').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as InvoiceListRow | null
}

export async function getInvoice(id: string) {
  const { data, error } = await supabase.from('invoices').select('*, supplier:suppliers(id, name)').eq('id', id).maybeSingle()
  if (error) throw error
  return data as (Invoice & { supplier: { id: string; name: string } | null }) | null
}

export type InvoiceItemRow = InvoiceItem & {
  product: { id: string; commercial_name: string | null; nf_description: string | null } | null
  costs: Pick<CostHistoryEntry, 'id' | 'entry_type' | 'is_reversed' | 'unit_cost' | 'product_id'>[]
}

export async function listInvoiceItems(invoiceId: string) {
  const { data, error } = await supabase
    .from('invoice_items')
    .select('*, product:products(id, commercial_name, nf_description), costs:product_cost_history(id, entry_type, is_reversed, unit_cost, product_id)')
    .eq('invoice_id', invoiceId)
    .order('item_number')
  if (error) throw error
  return (data ?? []) as InvoiceItemRow[]
}

export async function relinkItem(itemId: string, productId: string | null, reason: string) {
  const { error } = await supabase.rpc('relink_invoice_item', { p_item_id: itemId, p_new_product_id: productId, p_reason: reason })
  if (error) throw error
}

export async function xmlDownloadUrl(path: string) {
  const { data, error } = await supabase.storage.from('nfe-xml').createSignedUrl(path, 60, { download: true })
  if (error) throw error
  return data.signedUrl
}

// ---------------------------------------------------------------------
// Custos do produto
// ---------------------------------------------------------------------
export async function getCostSummary(productId: string) {
  const { data, error } = await supabase.from('product_cost_summary').select('*').eq('product_id', productId).maybeSingle()
  if (error) throw error
  return data as ProductCostSummary | null
}

export type CostHistoryRow = CostHistoryEntry & {
  supplier: { name: string } | null
  rule: { version: number } | null
  item: { item_number: number; unit_com: string | null; qty_com: number; conversion_factor: number; invoice: { id: string; number: string; series: string | null } | null } | null
}

export async function listCostHistory(productId: string) {
  const { data, error } = await supabase
    .from('product_cost_history')
    .select('*, supplier:suppliers(name), rule:cost_rules(version), item:invoice_items(item_number, unit_com, qty_com, conversion_factor, invoice:invoices(id, number, series))')
    .eq('product_id', productId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CostHistoryRow[]
}

// ---------------------------------------------------------------------
// Regra de custo
// ---------------------------------------------------------------------
export async function listCostRules() {
  const { data, error } = await supabase.from('cost_rules').select('*').order('version', { ascending: false })
  if (error) throw error
  return (data ?? []) as CostRule[]
}

export async function createCostRule(rule: Omit<CostRule, 'id' | 'is_active' | 'created_at'>) {
  const { data, error } = await supabase.from('cost_rules').insert({ ...rule, is_active: false }).select('*').single()
  if (error) throw error
  return data as CostRule
}

export async function activateCostRule(id: string) {
  const { error } = await supabase.rpc('activate_cost_rule', { p_rule_id: id })
  if (error) throw error
}
