import { supabase } from '@/lib/supabase'
import { productThumbs } from '@/modules/images/api'
import type { SaleRow } from './mlReport'
import type { SaleFact } from './summary'

export type Channel = 'mercado_livre' | 'tiktok_shop' | 'shopee'
export const CHANNEL_LABEL: Record<Channel, string> = { mercado_livre: 'Mercado Livre', tiktok_shop: 'TikTok Shop', shopee: 'Shopee' }

export type ImportResult = { import_id: string; novas: number; atualizadas: number; sem_produto: number }

export async function importSales(channel: Channel, fileName: string, rows: SaleRow[]): Promise<ImportResult> {
  const { data, error } = await supabase.rpc('import_sales', { p_channel: channel, p_file_name: fileName, p_rows: rows })
  if (error) throw error
  return data as ImportResult
}

export type SalesFilters = { from: string; to: string; channel: Channel | '' }

const FIELDS = 'order_id, pack_id, sold_at, status_group, sku, product_id, title, units, gross_revenue, sale_fees, shipping_net, net_total'

/** Vendas do período (datas no horário de Brasília). Lê em blocos de 1.000. */
export async function listSales(f: SalesFilters): Promise<SaleFact[]> {
  const out: SaleFact[] = []
  for (let from = 0; from < 50000; from += 1000) {
    let q = supabase.from('sales').select(FIELDS).order('sold_at', { ascending: false }).order('order_id').range(from, from + 999)
    if (f.from) q = q.gte('sold_at', `${f.from}T00:00:00-03:00`)
    if (f.to) q = q.lte('sold_at', `${f.to}T23:59:59.999-03:00`)
    if (f.channel) q = q.eq('channel', f.channel)
    const { data, error } = await q
    if (error) throw error
    const rows = (data ?? []).map((r) => ({
      ...r,
      units: Number(r.units), gross_revenue: Number(r.gross_revenue), sale_fees: Number(r.sale_fees),
      shipping_net: Number(r.shipping_net), net_total: Number(r.net_total),
    })) as SaleFact[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

export type ProductInfo = { id: string; name: string; sku: string | null; unitCost: number | null; thumb: string | null }

/** Nome, SKU, custo médio atual e foto dos produtos vendidos. */
export async function productInfo(ids: string[]): Promise<Map<string, ProductInfo>> {
  const out = new Map<string, ProductInfo>()
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    const [p, c, thumbs] = await Promise.all([
      supabase.from('products').select('id, commercial_name, nf_description, internal_sku, supplier_sku').in('id', part),
      supabase.from('product_cost_summary').select('product_id, average_unit_cost').in('product_id', part),
      productThumbs(part),
    ])
    if (p.error) throw p.error
    if (c.error) throw c.error
    const cost = new Map((c.data ?? []).map((r) => [r.product_id as string, Number(r.average_unit_cost)]))
    for (const r of p.data ?? []) {
      out.set(r.id, { id: r.id, name: r.commercial_name || r.nf_description || '', sku: r.internal_sku || r.supplier_sku || null,
        unitCost: cost.get(r.id) ?? null, thumb: thumbs.get(r.id)?.url ?? null })
    }
  }
  return out
}

export async function linkSku(sku: string, productId: string): Promise<number> {
  const { data, error } = await supabase.rpc('link_sales_sku', { p_sku: sku, p_product_id: productId })
  if (error) throw error
  return data as number
}

export type SalesImport = { id: string; channel: Channel; file_name: string; rows_total: number; rows_new: number; rows_updated: number; period_start: string | null; period_end: string | null; imported_at: string }
export async function listImports(): Promise<SalesImport[]> {
  const { data, error } = await supabase.from('sales_imports').select('id, channel, file_name, rows_total, rows_new, rows_updated, period_start, period_end, imported_at')
    .order('imported_at', { ascending: false }).limit(5)
  if (error) throw error
  return (data ?? []) as SalesImport[]
}
