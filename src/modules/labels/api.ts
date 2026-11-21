import { supabase } from '@/lib/supabase'
import { productThumbs } from '@/modules/images/api'

export const LABELS_PER_SHEET = 6

export type LabelProduct = { id: string; name: string; sku: string | null; ean: string | null; imageUrl: string | null }
export type LabelJob = { items: { id: string; qty: number }[]; skip: number }

export async function labelProducts(ids: string[]): Promise<LabelProduct[]> {
  const out: LabelProduct[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('products')
      .select('id, commercial_name, nf_description, internal_sku, supplier_sku, ean')
      .in('id', ids.slice(i, i + 200))
    if (error) throw error
    const thumbs = await productThumbs((data ?? []).map((p) => p.id))
    for (const p of data ?? []) {
      out.push({
        id: p.id,
        name: p.commercial_name || p.nf_description || '',
        sku: p.internal_sku || p.supplier_sku || null,
        ean: p.ean,
        imageUrl: thumbs.get(p.id)?.url ?? null,
      })
    }
  }
  const order = new Map(ids.map((id, i) => [id, i]))
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

// O trabalho de impressão vai para a aba nova pelo armazenamento do navegador (só o que imprimir, sem dados sensíveis).
const KEY = 'etiquetas:'
export function saveJob(job: LabelJob): string {
  const id = crypto.randomUUID().slice(0, 8)
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith(KEY)) localStorage.removeItem(k) }
    localStorage.setItem(KEY + id, JSON.stringify(job))
  } catch { /* sem armazenamento: a aba nova avisa */ }
  return id
}
export function loadJob(id: string): LabelJob | null {
  try { const s = localStorage.getItem(KEY + id); return s ? JSON.parse(s) as LabelJob : null } catch { return null }
}
