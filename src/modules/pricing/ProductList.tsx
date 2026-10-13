import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ImageOff, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ErrorState, Input, Pagination, Select, Spinner, cn } from '@/components/ui'
import { formatBRL } from '@/lib/format'
import { friendlyDbError, supabase } from '@/lib/supabase'
import { productThumbs } from '@/modules/images/api'
import { PAGE_SIZE, listFilterOptions, listProducts, type ProductFilters } from '@/modules/products/api'

async function costsFor(ids: string[]) {
  const out = new Map<string, number>()
  if (!ids.length) return out
  const { data, error } = await supabase.from('product_cost_summary').select('product_id, average_unit_cost').in('product_id', ids)
  if (error) throw error
  for (const r of (data ?? []) as { product_id: string; average_unit_cost: number }[]) out.set(r.product_id, Number(r.average_unit_cost))
  return out
}

/** Lista de produtos para escolher no simulador (clique ou ↑ ↓). */
export function ProductList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const [text, setText] = useState('')
  const [filters, setFilters] = useState<ProductFilters>({})
  const [page, setPage] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => ({ ...f, search: text.trim() })); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [text])

  const list = useQuery({ queryKey: ['pricing-products', filters, page], queryFn: () => listProducts(filters, page), placeholderData: keepPreviousData })
  const ids = list.data?.rows.map((r) => r.id) ?? []
  const costs = useQuery({ queryKey: ['pricing-costs', ids.join(',')], queryFn: () => costsFor(ids), enabled: ids.length > 0 })
  const thumbs = useQuery({ queryKey: ['product-thumbs', ids.join(',')], queryFn: () => productThumbs(ids), enabled: ids.length > 0, staleTime: 50 * 60 * 1000 })
  const options = useQuery({ queryKey: ['product-filter-options'], queryFn: listFilterOptions })

  // Abre o primeiro da lista quando nada está escolhido
  useEffect(() => { if (!selectedId && ids[0]) onSelect(ids[0]) }, [selectedId, ids, onSelect])

  // ↑ ↓ trocam de produto (fora de campos de texto)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
      const i = ids.indexOf(selectedId ?? '')
      const j = e.key === 'ArrowDown' ? i + 1 : i - 1
      if (j >= 0 && j < ids.length) { e.preventDefault(); onSelect(ids[j]) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [ids, selectedId, onSelect])

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface lg:sticky lg:top-0 lg:max-h-[calc(100vh-120px)]">
      <div className="flex flex-col gap-2 border-b border-line p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
          <Input className="pl-8" placeholder="Nome, SKU, código ou EAN" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar produto" />
        </div>
        <div className="flex gap-2">
          <Select className="h-8 text-[13px]" aria-label="Marca" value={filters.brand ?? ''} onChange={(e) => { setFilters((f) => ({ ...f, brand: e.target.value })); setPage(0) }}>
            <option value="">Todas as marcas</option>
            {options.data?.brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          <Select className="h-8 text-[13px]" aria-label="Coleção" value={filters.collection ?? ''} onChange={(e) => { setFilters((f) => ({ ...f, collection: e.target.value })); setPage(0) }}>
            <option value="">Todas as coleções</option>
            {options.data?.collections.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto', list.isPlaceholderData && 'opacity-60')}>
        {list.isPending ? <Spinner /> : list.isError ? <div className="p-3"><ErrorState message={friendlyDbError(list.error)} /></div> : list.data.rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted">Nenhum produto encontrado.</p>
        ) : (
          <ul role="listbox" aria-label="Produtos">
            {list.data.rows.map((p) => {
              const on = p.id === selectedId
              const thumb = thumbs.data?.get(p.id)
              const cost = costs.data?.get(p.id)
              return (
                <li key={p.id} role="option" aria-selected={on}>
                  <button type="button" onClick={() => onSelect(p.id)}
                    className={cn('flex w-full items-center gap-2.5 border-l-2 px-2.5 py-2 text-left hover:bg-sunk/70',
                      on ? 'border-accent bg-accent-soft/60' : 'border-transparent')}>
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-white">
                      {thumb ? <img src={thumb.url} alt="" loading="lazy" className="size-10 object-contain" /> : <ImageOff className="size-4 text-muted/50" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.commercial_name || p.nf_description}</span>
                      <span className="block truncate font-mono text-xs text-muted">{p.internal_sku ?? p.supplier_sku ?? '—'}</span>
                    </span>
                    <span className={cn('tabular shrink-0 text-xs', cost == null ? 'text-warn' : 'text-muted')}>{cost == null ? (costs.isPending ? '' : 'sem custo') : formatBRL(cost)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
    </div>
  )
}
