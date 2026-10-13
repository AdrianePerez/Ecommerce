import { supabase } from '@/lib/supabase'
import { importCatalogCrop, pendingCatalogCrops } from '@/modules/images/api'
import type { BBox } from './pageModel'

export type CatalogStatus = 'enviando' | 'aguardando_processamento' | 'em_processamento' | 'processado'
  | 'processado_parcialmente' | 'erro' | 'aguardando_revisao'

export const CATALOG_STATUS_LABEL: Record<CatalogStatus, string> = {
  enviando: 'Envio incompleto',
  aguardando_processamento: 'Aguardando processamento',
  em_processamento: 'Em processamento',
  processado: 'Processado',
  processado_parcialmente: 'Processado parcialmente',
  erro: 'Erro no processamento',
  aguardando_revisao: 'Aguardando revisão',
}

export interface Catalog {
  id: string
  supplier_id: string | null
  brand: string | null
  name: string
  collection_year: number | null
  received_at: string | null
  notes: string | null
  file_name: string
  file_size: number
  file_sha256: string
  pdf_page_count: number
  page_count: number
  pages_uploaded: number
  split_spreads: boolean
  status: CatalogStatus
  status_message: string | null
  created_at: string
  updated_at: string
}
export interface CatalogOverview extends Catalog {
  supplier_name: string | null
  items_total: number
  items_pending: number
  items_approved: number
}
export interface CatalogPage {
  id: string
  catalog_id: string
  page_number: number
  pdf_page: number
  side: 'F' | 'L' | 'R'
  image_path: string
  width: number
  height: number
  text_content: string | null
  status: 'pendente' | 'processada' | 'sem_produtos' | 'erro'
}
export type CatalogItemStatus = 'aguardando_revisao' | 'aprovado' | 'rejeitado'
export interface CatalogItem {
  id: string
  catalog_id: string
  page_id: string
  code: string | null
  ean: string | null
  name: string | null
  description: string | null
  height_mm: number | null
  width_mm: number | null
  depth_mm: number | null
  weight_g: number | null
  material: string | null
  capacity_text: string | null
  size_label: string | null
  color_code: string | null
  box_qty: number | null
  suggested_price: number | null
  features: string[] | null
  bbox: BBox | null
  image_path: string | null
  source: string
  confidence: number | null
  status: CatalogItemStatus
  product_id: string | null
  match_reason: string | null
  reviewed_at: string | null
  created_at: string
}
export type CatalogItemInput = Partial<Omit<CatalogItem, 'id' | 'status' | 'product_id' | 'created_at' | 'reviewed_at'>> & {
  catalog_id: string
  page_id: string
}

export type CodeMatch = { product_id: string; name: string; supplier_sku: string | null; internal_sku: string | null; ean: string | null; match_reason: string; exact: boolean }

// ---------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------
export async function listCatalogs() {
  const { data, error } = await supabase.from('catalog_overview').select('*').is('archived_at', null).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CatalogOverview[]
}

export async function getCatalog(id: string) {
  const { data, error } = await supabase.from('catalog_overview').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as CatalogOverview | null
}

export async function findCatalogBySha(sha: string) {
  const { data, error } = await supabase.from('supplier_catalogs').select('*').eq('file_sha256', sha).maybeSingle()
  if (error) throw error
  return data as Catalog | null
}

export async function createCatalog(row: Pick<Catalog, 'supplier_id' | 'brand' | 'name' | 'collection_year' | 'received_at' | 'notes'
  | 'file_name' | 'file_size' | 'file_sha256' | 'pdf_page_count' | 'split_spreads'>) {
  const { data, error } = await supabase.from('supplier_catalogs').insert({ ...row, status: 'enviando' }).select('*').single()
  if (error) throw error
  return data as Catalog
}

export async function updateCatalog(id: string, patch: Partial<Catalog>) {
  const { error } = await supabase.from('supplier_catalogs').update(patch).eq('id', id)
  if (error) throw error
}

/** Exclui o catálogo: imagens das páginas e recortes no Storage, depois o registro (páginas e itens vão junto). */
/** Remove todos os arquivos de uma pasta do bucket, inclusive subpastas (ex.: recortes/). */
async function clearFolder(folder: string) {
  for (;;) {
    const { data, error } = await supabase.storage.from('catalogs').list(folder, { limit: 1000 })
    if (error) throw error
    const files = (data ?? []).filter((f) => f.id !== null)
    const subfolders = (data ?? []).filter((f) => f.id === null)
    for (const sub of subfolders) await clearFolder(`${folder}/${sub.name}`)
    if (!files.length) break
    const { error: rmErr } = await supabase.storage.from('catalogs').remove(files.map((f) => `${folder}/${f.name}`))
    if (rmErr) throw rmErr
  }
}

export async function deleteCatalog(id: string) {
  await clearFolder(id)
  const { error } = await supabase.from('supplier_catalogs').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------
export async function uploadPageImage(path: string, blob: Blob) {
  const { error } = await supabase.storage.from('catalogs').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`Falha ao enviar a imagem da página: ${error.message}`)
}

export async function upsertPage(row: Omit<CatalogPage, 'id' | 'status'>) {
  const { error } = await supabase.from('catalog_pages').upsert(row, { onConflict: 'catalog_id,page_number' })
  if (error) throw error
}

export async function listUploadedPageNumbers(catalogId: string) {
  const { data, error } = await supabase.from('catalog_pages').select('page_number').eq('catalog_id', catalogId)
  if (error) throw error
  return new Set((data ?? []).map((r: { page_number: number }) => r.page_number))
}

export async function listPages(catalogId: string) {
  const { data, error } = await supabase.from('catalog_pages').select('*').eq('catalog_id', catalogId).order('page_number')
  if (error) throw error
  return (data ?? []) as CatalogPage[]
}

/** URLs temporárias (1 h) para exibir imagens do bucket privado. */
export async function signedUrls(paths: string[]) {
  if (!paths.length) return new Map<string, string>()
  const out = new Map<string, string>()
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200)
    const { data, error } = await supabase.storage.from('catalogs').createSignedUrls(chunk, 3600)
    if (error) throw error
    for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  }
  return out
}

// ---------------------------------------------------------------------
// Itens
// ---------------------------------------------------------------------
export async function listItems(catalogId: string, pageId?: string) {
  let q = supabase.from('catalog_items').select('*').eq('catalog_id', catalogId).order('created_at')
  if (pageId) q = q.eq('page_id', pageId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as CatalogItem[]
}

export async function saveItem(input: CatalogItemInput, id?: string) {
  const q = id
    ? supabase.from('catalog_items').update(input).eq('id', id).select('*').single()
    : supabase.from('catalog_items').insert({ ...input, source: input.source ?? 'manual' }).select('*').single()
  const { data, error } = await q
  if (error) throw error
  return data as CatalogItem
}

export async function setItemStatus(id: string, status: Exclude<CatalogItemStatus, 'aprovado'>) {
  const { error } = await supabase.from('catalog_items').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteItem(id: string) {
  const { error } = await supabase.from('catalog_items').delete().eq('id', id)
  if (error) throw error
}

export async function matchCode(code: string, ean?: string | null) {
  const { data, error } = await supabase.rpc('match_catalog_code', { p_code: code, p_ean: ean ?? null })
  if (error) throw error
  return (data ?? []) as CodeMatch[]
}

/** Envia o recorte da foto e aprova o item, aplicando os dados no produto. */
export async function approveItem(item: CatalogItem, productId: string, overrides: string[], crop: Blob | null) {
  if (crop) {
    const path = `${item.catalog_id}/recortes/${item.id}.jpg`
    const { error: upErr } = await supabase.storage.from('catalogs').upload(path, crop, { contentType: 'image/jpeg', upsert: true })
    if (upErr) throw new Error(`Falha ao guardar o recorte: ${upErr.message}`)
    await saveItem({ catalog_id: item.catalog_id, page_id: item.page_id, image_path: path }, item.id)
  }
  const { error } = await supabase.rpc('approve_catalog_item', { p_item_id: item.id, p_product_id: productId, p_overrides: overrides })
  if (error) throw error
  // O recorte também entra na galeria do produto (para revisão). Falha aqui não desfaz a aprovação.
  if (crop) {
    try {
      const crops = await pendingCatalogCrops(productId)
      const mine = crops.find((c) => c.id === item.id)
      if (mine) await importCatalogCrop(productId, mine)
    } catch (e) {
      return { galleryWarning: `Aprovado, mas o recorte não entrou na galeria: ${(e as Error).message}` }
    }
  }
  return { galleryWarning: null as string | null }
}

export async function getProductBasics(id: string) {
  const { data, error } = await supabase.from('products')
    .select('id, commercial_name, nf_description, height_mm, width_mm, depth_mm, weight_g, material, ean').eq('id', id).maybeSingle()
  if (error) throw error
  return data as { id: string; commercial_name: string | null; nf_description: string | null; height_mm: number | null
    width_mm: number | null; depth_mm: number | null; weight_g: number | null; material: string | null; ean: string | null } | null
}
