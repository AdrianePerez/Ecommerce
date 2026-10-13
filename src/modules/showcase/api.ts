import { supabase } from '@/lib/supabase'
import type { ProductStatus } from '@/lib/database.types'
import { productIdsByIdentifier, quoted } from '@/modules/products/api'
import type { ListingStatus } from '@/modules/listings/listingModel'

export interface ShowcaseRow {
  row_id: string
  product_id: string
  commercial_name: string | null
  nf_description: string | null
  internal_sku: string | null
  supplier_sku: string | null
  ean: string | null
  brand: string | null
  model: string | null
  collection: string | null
  main_supplier_id: string | null
  supplier_name: string | null
  product_status: ProductStatus
  missing_count: number
  missing_dimensions: boolean
  missing_weight: boolean
  average_unit_cost: number | null
  approved_images: number
  main_image_path: string | null
  listing_id: string | null
  marketplace_id: string | null
  marketplace_name: string | null
  variant_label: string | null
  listing_status: ListingStatus | null
  title: string | null
  has_title: boolean
  has_description: boolean
  suggested_price: number | null
  pricing_rule_id: string | null
  shipping_cost: number | null
  updated_at: string
}

export interface ShowcaseFilters {
  search?: string
  listingStatus?: ListingStatus | ''
  productStatus?: ProductStatus | ''
  /** id do canal, ou 'sem' para produtos sem anúncio */
  marketplace?: string
  brand?: string
  supplierId?: string
  collection?: string
  incomplete?: boolean
  noPhotos?: boolean
  noDimensions?: boolean
  noWeight?: boolean
  noTitle?: boolean
  noDescription?: boolean
  noPrice?: boolean
}

export const SHOWCASE_PAGE = 48

export async function listShowcase(f: ShowcaseFilters, page: number) {
  let q = supabase.from('showcase_rows').select('*', { count: 'exact' }).is('archived_at', null)
  const term = f.search?.trim()
  if (term) {
    const ids = await productIdsByIdentifier(term)
    const ors = ['commercial_name', 'nf_description', 'internal_sku', 'supplier_sku', 'ean', 'brand', 'model'].map((c) => `${c}.ilike.${quoted(term)}`)
    if (ids.length) ors.push(`product_id.in.(${ids.join(',')})`)
    q = q.or(ors.join(','))
  }
  if (f.marketplace === 'sem') q = q.is('listing_id', null)
  else if (f.marketplace) q = q.eq('marketplace_id', f.marketplace)
  if (f.listingStatus) q = q.eq('listing_status', f.listingStatus)
  if (f.productStatus) q = q.eq('product_status', f.productStatus)
  if (f.brand) q = q.eq('brand', f.brand)
  if (f.supplierId) q = q.eq('main_supplier_id', f.supplierId)
  if (f.collection) q = q.eq('collection', f.collection)
  if (f.incomplete) q = q.gt('missing_count', 0)
  if (f.noPhotos) q = q.eq('approved_images', 0)
  if (f.noDimensions) q = q.eq('missing_dimensions', true)
  if (f.noWeight) q = q.eq('missing_weight', true)
  if (f.noTitle) q = q.not('listing_id', 'is', null).eq('has_title', false)
  if (f.noDescription) q = q.not('listing_id', 'is', null).eq('has_description', false)
  if (f.noPrice) q = q.not('listing_id', 'is', null).is('suggested_price', null)
  const { data, error, count } = await q
    .order('updated_at', { ascending: false }).order('row_id')
    .range(page * SHOWCASE_PAGE, page * SHOWCASE_PAGE + SHOWCASE_PAGE - 1)
  if (error) throw error
  return { rows: (data ?? []) as ShowcaseRow[], total: count ?? 0 }
}

/** Itens de completude da linha (cadastro + anúncio). */
export function completeness(r: ShowcaseRow) {
  const items: [string, boolean][] = [
    ['Cadastro mestre', r.missing_count === 0],
    ['Foto aprovada', r.approved_images > 0],
  ]
  if (r.listing_id) items.push(['Título', r.has_title], ['Descrição', r.has_description], ['Preço', r.suggested_price != null])
  else items.push(['Anúncio criado', false])
  const done = items.filter(([, ok]) => ok).length
  return { done, total: items.length, missing: items.filter(([, ok]) => !ok).map(([k]) => k) }
}
