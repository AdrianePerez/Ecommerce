import { supabase } from '@/lib/supabase'
import type { Product, ProductAttribute } from '@/lib/database.types'
import { listProductImages } from '@/modules/images/api'
import { buildDescription, buildTitle, prefillAttributes, type ListingStatus } from './listingModel'

export interface AttributeField { key: string; label: string; required: boolean }

export interface MarketplaceConfig {
  id: string
  code: string
  name: string
  active: boolean
  title_min: number | null
  title_max: number | null
  description_max: number | null
  description_plain_text: boolean
  images_min: number
  images_max: number | null
  keywords_max: number | null
  required_fields: string[]
  attribute_fields: AttributeField[]
  rules_notes: string | null
  rules_checked_on: string | null
  updated_at: string
}

export interface Listing {
  id: string
  product_id: string
  marketplace_id: string
  variant_label: string
  title: string | null
  description: string | null
  category_suggested: string | null
  category_external_id: string | null
  attributes: Record<string, string>
  keywords: string[]
  suggested_price: number | null
  pricing_rule_id: string | null
  shipping_cost: number | null
  main_image_id: string | null
  status: ListingStatus
  last_reviewed_at: string | null
  external_id: string | null
  external_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ListingRow extends Listing {
  product: { id: string; commercial_name: string | null; nf_description: string | null; internal_sku: string | null; brand: string | null }
  marketplace: { name: string; code: string }
}

export type ListingPatch = Partial<Pick<Listing, 'title' | 'description' | 'category_suggested' | 'category_external_id' | 'attributes'
  | 'keywords' | 'suggested_price' | 'pricing_rule_id' | 'shipping_cost' | 'main_image_id' | 'status' | 'external_id' | 'external_url' | 'notes' | 'variant_label'>>

// ---------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------
export async function listMarketplaces() {
  const { data, error } = await supabase.from('marketplace_configs').select('*').order('active', { ascending: false }).order('name')
  if (error) throw error
  return (data ?? []) as MarketplaceConfig[]
}

export async function updateMarketplace(id: string, patch: Partial<Omit<MarketplaceConfig, 'id' | 'code' | 'updated_at'>>, expectedUpdatedAt: string) {
  const { data, error } = await supabase.from('marketplace_configs').update(patch).eq('id', id).eq('updated_at', expectedUpdatedAt).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Não foi salvo: a regra foi alterada por outra pessoa ou você não é administrador. Recarregue a página.')
}

// ---------------------------------------------------------------------
// Anúncios
// ---------------------------------------------------------------------
export interface ListingFilters { status?: ListingStatus | ''; marketplaceId?: string; search?: string }
export const LISTINGS_PAGE = 25

export async function listListings(f: ListingFilters, page: number) {
  let q = supabase.from('product_listings')
    .select('*, product:products!inner(id, commercial_name, nf_description, internal_sku, brand), marketplace:marketplace_configs(name, code)', { count: 'exact' })
  if (f.status) q = q.eq('status', f.status)
  else q = q.neq('status', 'arquivado')
  if (f.marketplaceId) q = q.eq('marketplace_id', f.marketplaceId)
  const s = f.search?.trim().replace(/[,%()]/g, ' ')
  if (s) q = q.or(`commercial_name.ilike.%${s}%,nf_description.ilike.%${s}%,internal_sku.ilike.%${s}%`, { referencedTable: 'products' })
  const { data, error, count } = await q.order('updated_at', { ascending: false }).range(page * LISTINGS_PAGE, page * LISTINGS_PAGE + LISTINGS_PAGE - 1)
  if (error) throw error
  return { rows: (data ?? []) as ListingRow[], total: count ?? 0 }
}

export async function listingCounts() {
  const { data, error } = await supabase.from('product_listings').select('status')
  if (error) throw error
  const c: Partial<Record<ListingStatus, number>> = {}
  for (const r of (data ?? []) as { status: ListingStatus }[]) c[r.status] = (c[r.status] ?? 0) + 1
  return c
}

export async function listProductListings(productId: string) {
  const { data, error } = await supabase.from('product_listings')
    .select('*, marketplace:marketplace_configs(name, code)').eq('product_id', productId).order('created_at')
  if (error) throw error
  return (data ?? []) as (Listing & { marketplace: { name: string; code: string } })[]
}

export async function getListing(id: string) {
  const { data, error } = await supabase.from('product_listings').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as Listing | null
}

export async function listingIssues(id: string) {
  const { data, error } = await supabase.rpc('listing_issues', { p_listing_id: id })
  if (error) throw error
  return (data ?? []) as string[]
}

async function productWithAttrs(productId: string) {
  const [{ data: p, error: e1 }, { data: a, error: e2 }] = await Promise.all([
    supabase.from('products').select('*').eq('id', productId).single(),
    supabase.from('product_attributes').select('*').eq('product_id', productId),
  ])
  if (e1) throw e1
  if (e2) throw e2
  return { product: p as Product, attrs: (a ?? []) as ProductAttribute[] }
}

/** Cria o rascunho já com título, descrição, atributos e imagens sugeridos a partir do cadastro. */
export async function createListing(productId: string, m: MarketplaceConfig, variantLabel = '') {
  const [{ product, attrs }, images] = await Promise.all([productWithAttrs(productId), listProductImages(productId)])
  const approved = images.filter((i) => i.status === 'aprovada' && i.rights !== 'nao_autorizada')
  const main = approved.find((i) => i.is_main) ?? approved[0] ?? null
  const extra = approved.filter((i) => i.id !== main?.id).slice(0, Math.max(0, (m.images_max ?? 12) - 1))

  const { data, error } = await supabase.from('product_listings').insert({
    product_id: productId, marketplace_id: m.id, variant_label: variantLabel.trim(),
    title: buildTitle(product, attrs, m.title_max) || null,
    description: buildDescription(product, attrs) || null,
    attributes: prefillAttributes(product, m.attribute_fields.map((f) => f.key)),
    main_image_id: main?.id ?? null,
  }).select().single()
  if (error) throw error
  const listing = data as Listing
  if (extra.length) await setListingImages(listing.id, extra.map((i) => i.id))
  return listing
}

export async function updateListing(id: string, patch: ListingPatch, expectedUpdatedAt: string) {
  const { data, error } = await supabase.from('product_listings').update(patch).eq('id', id).eq('updated_at', expectedUpdatedAt).select().maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Este anúncio foi alterado em outra tela enquanto você editava. Recarregue para ver a versão atual.')
  return data as Listing
}

/** Imagens adicionais do anúncio (além da principal), na ordem dada. */
export async function listListingImages(listingId: string) {
  const { data, error } = await supabase.from('listing_assets').select('image_id, position').eq('listing_id', listingId).order('position')
  if (error) throw error
  return (data ?? []).map((r) => (r as { image_id: string }).image_id)
}

export async function setListingImages(listingId: string, imageIds: string[]) {
  const { error: delErr } = await supabase.from('listing_assets').delete().eq('listing_id', listingId)
  if (delErr) throw delErr
  if (!imageIds.length) return
  const { error } = await supabase.from('listing_assets').insert(imageIds.map((image_id, i) => ({ listing_id: listingId, image_id, position: i + 1 })))
  if (error) throw error
}

export async function suggestionsFor(listing: Listing, m: MarketplaceConfig) {
  const { product, attrs } = await productWithAttrs(listing.product_id)
  return {
    title: buildTitle(product, attrs, m.title_max),
    description: buildDescription(product, attrs),
    attributes: prefillAttributes(product, m.attribute_fields.map((f) => f.key)),
    product,
  }
}
