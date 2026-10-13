import { supabase } from '@/lib/supabase'
import type { DataSource } from '@/lib/database.types'
import {
  THUMB_SIZE, checkImageFile, imagePath, sniffImageMime, thumbOf, zipEntryName,
  type ImageKind, type ImageMime, type ImageRights, type ImageStatus,
} from './imageModel'

const BUCKET = 'product-images'

export interface ProductImage {
  id: string
  product_id: string
  parent_image_id: string | null
  storage_path: string
  file_name: string | null
  mime_type: ImageMime
  width: number | null
  height: number | null
  bytes: number | null
  sha256: string
  kind: ImageKind
  status: ImageStatus
  rights: ImageRights
  rights_notes: string | null
  source: DataSource
  source_url: string | null
  source_ref: string | null
  research_source_id: string | null
  catalog_item_id: string | null
  is_main: boolean
  position: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface GalleryImage extends ProductImage {
  product: { id: string; commercial_name: string | null; nf_description: string | null; internal_sku: string | null; supplier_sku: string | null }
}

export type ImagePatch = Partial<Pick<ProductImage, 'kind' | 'status' | 'rights' | 'rights_notes' | 'source_url' | 'notes'>>

// ---------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------
export async function listProductImages(productId: string) {
  const { data, error } = await supabase.from('product_images').select('*')
    .eq('product_id', productId).order('position').order('created_at')
  if (error) throw error
  return (data ?? []) as ProductImage[]
}

export interface GalleryFilters {
  status?: ImageStatus | ''
  kind?: ImageKind | ''
  rights?: ImageRights | ''
  search?: string
}

export async function listGallery(f: GalleryFilters, page: number, pageSize: number) {
  let q = supabase.from('product_images')
    .select('*, product:products!inner(id, commercial_name, nf_description, internal_sku, supplier_sku)', { count: 'exact' })
  if (f.status) q = q.eq('status', f.status)
  if (f.kind) q = q.eq('kind', f.kind)
  if (f.rights) q = q.eq('rights', f.rights)
  const s = f.search?.trim().replace(/[,%()]/g, ' ')
  if (s) {
    q = q.or(
      `commercial_name.ilike.%${s}%,nf_description.ilike.%${s}%,internal_sku.ilike.%${s}%,supplier_sku.ilike.%${s}%`,
      { referencedTable: 'products' },
    )
  }
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) throw error
  return { rows: (data ?? []) as GalleryImage[], total: count ?? 0 }
}

/** URLs temporárias (1 h) para exibir arquivos do bucket privado. */
export async function signedImageUrls(paths: string[]) {
  const out = new Map<string, string>()
  const unique = [...new Set(paths)]
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique.slice(i, i + 200), 3600)
    if (error) throw error
    for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  }
  return out
}

// ---------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------
async function sha256Hex(buf: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function makeThumb(blob: Blob) {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, THUMB_SIZE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  const dims = { width: bmp.width, height: bmp.height }
  bmp.close()
  const thumb = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao gerar a miniatura.'))), 'image/jpeg', 0.8))
  return { thumb, ...dims }
}

export interface NewImage {
  productId: string
  blob: Blob
  fileName?: string | null
  kind?: ImageKind
  rights?: ImageRights
  status?: ImageStatus
  source?: DataSource
  sourceUrl?: string | null
  sourceRef?: string | null
  parentImageId?: string | null
  catalogItemId?: string | null
  rightsNotes?: string | null
}

/** Envia o arquivo original sem alteração + miniatura, e registra na galeria. */
export async function addImage(n: NewImage): Promise<ProductImage> {
  const buf = await n.blob.arrayBuffer()
  const mime = sniffImageMime(new Uint8Array(buf.slice(0, 16)))
  const problem = checkImageFile(buf.byteLength, mime)
  if (problem) throw new Error(n.fileName ? `${n.fileName}: ${problem}` : problem)
  const sha = await sha256Hex(buf)

  const { data: dup, error: dupErr } = await supabase.from('product_images').select('id')
    .eq('product_id', n.productId).eq('sha256', sha).maybeSingle()
  if (dupErr) throw dupErr
  if (dup) throw new Error(`${n.fileName ? `${n.fileName}: ` : ''}esta imagem já está na galeria do produto.`)

  let dims: { thumb: Blob; width: number; height: number }
  try { dims = await makeThumb(n.blob) } catch {
    throw new Error(`${n.fileName ? `${n.fileName}: ` : ''}não foi possível abrir a imagem (arquivo corrompido?).`)
  }

  const { data: last } = await supabase.from('product_images').select('position')
    .eq('product_id', n.productId).order('position', { ascending: false }).limit(1).maybeSingle()

  const id = crypto.randomUUID()
  const path = imagePath(n.productId, id, mime!)
  const storage = supabase.storage.from(BUCKET)
  const up1 = await storage.upload(path, new Blob([buf], { type: mime! }), { contentType: mime!, upsert: false })
  if (up1.error) throw new Error(`Falha ao enviar a imagem: ${up1.error.message}`)
  const up2 = await storage.upload(thumbOf(path), dims.thumb, { contentType: 'image/jpeg', upsert: true })
  if (up2.error) { await storage.remove([path]); throw new Error(`Falha ao enviar a miniatura: ${up2.error.message}`) }

  const { data, error } = await supabase.from('product_images').insert({
    id, product_id: n.productId, parent_image_id: n.parentImageId ?? null, storage_path: path,
    file_name: n.fileName ?? null, mime_type: mime, width: dims.width, height: dims.height, bytes: buf.byteLength, sha256: sha,
    kind: n.kind ?? 'referencia', status: n.status ?? 'aguardando_revisao', rights: n.rights ?? 'a_verificar',
    rights_notes: n.rightsNotes ?? null, source: n.source ?? 'manual', source_url: n.sourceUrl ?? null,
    source_ref: n.sourceRef ?? null, catalog_item_id: n.catalogItemId ?? null,
    position: ((last as { position: number } | null)?.position ?? 0) + 1,
  }).select().single()
  if (error) { await storage.remove([path, thumbOf(path)]); throw error }
  return data as ProductImage
}

/** Baixa a imagem de um link pelo servidor (evita bloqueio do navegador e endereços internos). */
export async function fetchImageFromUrl(url: string): Promise<{ blob: Blob; finalUrl: string }> {
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token
  if (!token) throw new Error('Sessão expirada. Entre novamente.')
  const base = import.meta.env.VITE_SUPABASE_URL as string
  let res: Response
  try {
    res = await fetch(`${base}/functions/v1/importar-imagem`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    })
  } catch {
    throw new Error('Não foi possível falar com o servidor de importação. Verifique a internet.')
  }
  if (res.status === 404) throw new Error('A função de importar por link ainda não foi publicada no Supabase.')
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Não foi possível baixar a imagem (erro ${res.status}).`)
  }
  return { blob: await res.blob(), finalUrl: res.headers.get('x-final-url') || url }
}

// ---------------------------------------------------------------------
// Alterações
// ---------------------------------------------------------------------
export async function updateImage(id: string, patch: ImagePatch) {
  const { error } = await supabase.from('product_images').update(patch).eq('id', id)
  if (error) throw error
}

export async function updateImages(ids: string[], patch: ImagePatch) {
  if (!ids.length) return
  const { error } = await supabase.from('product_images').update(patch).in('id', ids)
  if (error) throw error
}

export async function setMainImage(id: string) {
  const { error } = await supabase.rpc('set_main_image', { p_image_id: id })
  if (error) throw error
}

export async function reorderImages(productId: string, ids: string[]) {
  const { error } = await supabase.rpc('reorder_product_images', { p_product_id: productId, p_ids: ids })
  if (error) throw error
}

export async function deleteImage(img: ProductImage) {
  const { data, error } = await supabase.from('product_images').delete().eq('id', img.id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Imagem aprovada não pode ser excluída. Rejeite primeiro.')
  await supabase.storage.from(BUCKET).remove([img.storage_path, thumbOf(img.storage_path)])
}

// ---------------------------------------------------------------------
// Pacote para o Canva
// ---------------------------------------------------------------------
export async function downloadZip(images: (ProductImage & { sku?: string | null })[], zipName: string, onProgress?: (done: number) => void) {
  if (!images.length) throw new Error('Nenhuma imagem selecionada.')
  const urls = await signedImageUrls(images.map((i) => i.storage_path))
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const counters = new Map<string, number>()
  let done = 0
  for (const img of images) {
    const url = urls.get(img.storage_path)
    if (!url) throw new Error('Não foi possível gerar o link de uma das imagens.')
    const res = await fetch(url)
    if (!res.ok) throw new Error('Falha ao baixar uma das imagens.')
    const n = (counters.get(img.product_id) ?? 0) + 1
    counters.set(img.product_id, n)
    zip.file(zipEntryName(img.sku ?? null, n, img.kind, img.mime_type), await res.blob())
    onProgress?.(++done)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

// ---------------------------------------------------------------------
// Recortes de catálogo aprovados
// ---------------------------------------------------------------------
export interface CatalogCrop {
  id: string
  image_path: string
  code: string | null
  catalog_name: string
  page_number: number
}

export async function pendingCatalogCrops(productId: string): Promise<CatalogCrop[]> {
  const { data, error } = await supabase.from('catalog_items')
    .select('id, image_path, code, catalog:supplier_catalogs(name), page:catalog_pages(page_number)')
    .eq('product_id', productId).eq('status', 'aprovado').not('image_path', 'is', null)
  if (error) throw error
  const rows = (data ?? []) as unknown as { id: string; image_path: string; code: string | null
    catalog: { name: string } | null; page: { page_number: number } | null }[]
  if (!rows.length) return []
  const { data: used, error: e2 } = await supabase.from('product_images').select('catalog_item_id')
    .in('catalog_item_id', rows.map((r) => r.id))
  if (e2) throw e2
  const taken = new Set((used ?? []).map((u) => (u as { catalog_item_id: string }).catalog_item_id))
  return rows.filter((r) => !taken.has(r.id)).map((r) => ({
    id: r.id, image_path: r.image_path, code: r.code, catalog_name: r.catalog?.name ?? 'Catálogo', page_number: r.page?.page_number ?? 0,
  }))
}

export async function importCatalogCrop(productId: string, crop: CatalogCrop) {
  const { data, error } = await supabase.storage.from('catalogs').download(crop.image_path)
  if (error || !data) throw new Error('O recorte não está mais disponível (o catálogo pode ter sido excluído).')
  return addImage({
    productId, blob: data, fileName: `${crop.code ?? 'recorte'}.jpg`, kind: 'referencia', rights: 'fornecedor',
    source: 'catalogo', sourceRef: `Catálogo "${crop.catalog_name}", página ${crop.page_number}`, catalogItemId: crop.id,
  })
}
