import { supabase } from '@/lib/supabase'
import type {
  AuditLog, Product, ProductAttribute, ProductIdentifier, ProductInsert, ProductOverview, ProductStatus,
} from '@/lib/database.types'

export type ProductFilters = {
  search?: string
  status?: ProductStatus | ''
  brand?: string
  supplierId?: string
  collection?: string
  incomplete?: boolean
  missingDimensions?: boolean
  missingWeight?: boolean
  missingFiscal?: boolean
  includeArchived?: boolean
}

export const PAGE_SIZE = 25

/** Protege o termo de busca para uso dentro de um filtro or() do PostgREST. */
export function quoted(term: string) {
  return `"*${term.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}*"`
}

/** IDs de produtos com algum identificador (EAN/código) contendo o termo. */
export async function productIdsByIdentifier(term: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('product_identifiers')
    .select('product_id')
    .ilike('value', `%${term}%`)
    .limit(200)
  if (error) throw error
  return [...new Set((data ?? []).map((r: { product_id: string }) => r.product_id))]
}

/** Aplica busca e filtros a uma consulta da view product_overview. */
async function applyFilters<Q extends { or: (f: string) => Q; eq: (c: string, v: unknown) => Q; is: (c: string, v: null) => Q; gt: (c: string, v: number) => Q }>(q: Q, f: ProductFilters): Promise<Q> {
  const term = f.search?.trim()
  if (term) {
    const ids = await productIdsByIdentifier(term)
    const cols = ['commercial_name', 'nf_description', 'internal_sku', 'supplier_sku', 'ean', 'brand', 'model']
    const ors = cols.map((c) => `${c}.ilike.${quoted(term)}`)
    if (ids.length) ors.push(`id.in.(${ids.join(',')})`)
    q = q.or(ors.join(','))
  }
  if (f.status) q = q.eq('status', f.status)
  else if (!f.includeArchived) q = q.is('archived_at', null)
  if (f.brand) q = q.eq('brand', f.brand)
  if (f.collection) q = q.eq('collection', f.collection)
  if (f.supplierId) q = q.eq('main_supplier_id', f.supplierId)
  if (f.incomplete) q = q.gt('missing_count', 0)
  if (f.missingDimensions) q = q.eq('missing_dimensions', true)
  if (f.missingWeight) q = q.eq('missing_weight', true)
  if (f.missingFiscal) q = q.eq('missing_fiscal', true)
  return q
}

export async function listProducts(f: ProductFilters, page: number) {
  const base = supabase
    .from('product_overview')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
  const { data, error, count } = await applyFilters(base, f)
  if (error) throw error
  return { rows: (data ?? []) as ProductOverview[], total: count ?? 0 }
}

export const BULK_LIMIT = 2000

/** Todos os IDs que atendem aos filtros (para "selecionar todos do filtro"). */
export async function listProductIds(f: ProductFilters) {
  const base = supabase.from('product_overview').select('id').order('updated_at', { ascending: false }).range(0, BULK_LIMIT - 1)
  const { data, error } = await applyFilters(base, f)
  if (error) throw error
  return (data ?? []).map((r: { id: string }) => r.id)
}

/** Altera vários produtos de uma vez (tudo ou nada). Retorna quantos foram alterados. */
export async function bulkUpdateProducts(ids: string[], changes: Record<string, string>, onlyEmpty: boolean) {
  const { data, error } = await supabase.rpc('bulk_update_products', { p_ids: ids, p_changes: changes, p_only_empty: onlyEmpty })
  if (error) throw error
  return data as number
}

/** Valores distintos para os filtros de marca e coleção. */
export async function listFilterOptions() {
  const { data, error } = await supabase
    .from('products')
    .select('brand, collection')
    .is('archived_at', null)
    .limit(5000)
  if (error) throw error
  const rows = (data ?? []) as { brand: string | null; collection: string | null }[]
  const uniq = (xs: (string | null)[]) =>
    [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return { brands: uniq(rows.map((r) => r.brand)), collections: uniq(rows.map((r) => r.collection)) }
}

export async function getProduct(id: string) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as Product | null
}

function withArchive(p: ProductInsert, previous?: Product | null): ProductInsert {
  if (p.status === 'arquivado') return { ...p, archived_at: previous?.archived_at ?? new Date().toISOString() }
  return { ...p, archived_at: null }
}

export async function createProduct(p: ProductInsert) {
  const { data, error } = await supabase.from('products').insert(withArchive(p)).select('*').single()
  if (error) throw error
  return data as Product
}

export async function updateProduct(id: string, p: ProductInsert, previous: Product) {
  const { data, error } = await supabase
    .from('products')
    .update(withArchive(p, previous))
    .eq('id', id)
    .eq('updated_at', previous.updated_at) // controle de concorrência otimista
    .select('*')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Este produto foi alterado por outra pessoa enquanto você editava. Recarregue a página para ver a versão atual.')
  return data as Product
}

// ---------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------
export async function listIdentifiers(productId: string) {
  const { data, error } = await supabase
    .from('product_identifiers')
    .select('*, supplier:suppliers(name)')
    .eq('product_id', productId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as (ProductIdentifier & { supplier: { name: string } | null })[]
}

export async function addIdentifier(row: Pick<ProductIdentifier, 'product_id' | 'id_type' | 'value' | 'supplier_id' | 'match_reason'>) {
  const { data: u } = await supabase.auth.getUser()
  const { error } = await supabase.from('product_identifiers').insert({
    ...row,
    source: 'manual',
    confirmed_by: u.user?.id ?? null,
    confirmed_at: new Date().toISOString(),
  })
  if (error) throw error
}

export async function removeIdentifier(id: string) {
  const { error } = await supabase.from('product_identifiers').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------
// Atributos adicionais
// ---------------------------------------------------------------------
export async function listAttributes(productId: string) {
  const { data, error } = await supabase
    .from('product_attributes')
    .select('*')
    .eq('product_id', productId)
    .order('attr_key')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as ProductAttribute[]
}

export async function addAttribute(
  row: Pick<ProductAttribute, 'product_id' | 'attr_key' | 'label' | 'value_text' | 'value_num' | 'unit' | 'notes'>
    & { research_source_id?: string | null; validation_status?: ProductAttribute['validation_status'] },
) {
  const { research_source_id, validation_status, ...rest } = row
  const { error } = await supabase
    .from('product_attributes')
    .insert({
      ...rest, research_source_id: research_source_id ?? null,
      source: research_source_id ? 'pesquisa' : 'manual', validation_status: validation_status ?? 'confirmada',
    })
  if (error) throw error
}

// ---------------------------------------------------------------------
// Fontes de pesquisa
// ---------------------------------------------------------------------
export type SourceType = 'fabricante' | 'catalogo_oficial' | 'distribuidor' | 'marketplace' | 'loja' | 'outro'
export interface ResearchSource {
  id: string
  product_id: string
  source_type: SourceType
  title: string
  url: string | null
  accessed_on: string
  accessible: boolean
  notes: string | null
  created_at: string
}
export type ResearchSourceInput = Pick<ResearchSource, 'source_type' | 'title' | 'url' | 'accessed_on' | 'accessible' | 'notes'>

export async function listSources(productId: string) {
  const { data, error } = await supabase.from('product_research_sources').select('*')
    .eq('product_id', productId).order('accessed_on', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ResearchSource[]
}

export async function saveSource(productId: string, input: ResearchSourceInput, id?: string) {
  const q = id
    ? supabase.from('product_research_sources').update(input).eq('id', id)
    : supabase.from('product_research_sources').insert({ ...input, product_id: productId })
  const { error } = await q
  if (error) throw error
}

export async function deleteSource(id: string) {
  const { error } = await supabase.from('product_research_sources').delete().eq('id', id)
  if (error) throw error
}

export async function setAttributeStatus(id: string, status: ProductAttribute['validation_status']) {
  const { error } = await supabase.from('product_attributes').update({ validation_status: status }).eq('id', id)
  if (error) throw error
}

export async function removeAttribute(id: string) {
  const { error } = await supabase.from('product_attributes').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------
export async function listProductHistory(productId: string) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('table_name', 'products')
    .eq('record_id', productId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as AuditLog[]
}
