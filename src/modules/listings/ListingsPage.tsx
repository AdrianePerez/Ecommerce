import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Spinner } from '@/components/ui'
import { formatBRL, formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { LISTINGS_PAGE, listListings, listMarketplaces, listingCounts, type ListingFilters } from './api'
import { LISTING_STATUS_LABEL, LISTING_STATUS_TONE, type ListingStatus } from './listingModel'
import { NewListingModal } from './NewListingModal'

export function ListingsPage() {
  const [filters, setFilters] = useState<ListingFilters>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => ({ ...f, search })); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const markets = useQuery({ queryKey: ['marketplaces'], queryFn: listMarketplaces })
  const counts = useQuery({ queryKey: ['listing-counts'], queryFn: listingCounts })
  const list = useQuery({ queryKey: ['listings', filters, page], queryFn: () => listListings(filters, page), placeholderData: (p) => p })

  const statuses: ListingStatus[] = ['rascunho', 'em_revisao', 'pronto_para_publicar', 'publicado']

  return (
    <>
      <PageHeader title="Central de preparação"
        description="Anúncios preparados por canal para publicação manual. Nada é publicado automaticamente."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Novo anúncio</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statuses.map((s) => (
          <button key={s} type="button" onClick={() => { setFilters((f) => ({ ...f, status: f.status === s ? '' : s })); setPage(0) }}
            className={`rounded-lg border bg-surface p-4 text-left hover:border-accent ${filters.status === s ? 'border-accent' : 'border-line'}`}>
            <div className="text-xs text-muted">{LISTING_STATUS_LABEL[s]}</div>
            <div className="tabular mt-1 text-2xl font-semibold">{counts.data?.[s] ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
          <Input className="pl-8" placeholder="Produto ou SKU" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
        </div>
        <Select className="w-44" aria-label="Canal" value={filters.marketplaceId ?? ''}
          onChange={(e) => { setFilters((f) => ({ ...f, marketplaceId: e.target.value })); setPage(0) }}>
          <option value="">Todos os canais</option>
          {markets.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Select className="w-52" aria-label="Situação" value={filters.status ?? ''}
          onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value as ListingStatus | '' })); setPage(0) }}>
          <option value="">Ativos (sem arquivados)</option>
          {Object.entries(LISTING_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {list.isPending ? <Spinner /> : list.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} /></div>
        ) : list.data.rows.length === 0 ? (
          <EmptyState title="Nenhum anúncio aqui" description="Crie um anúncio a partir de um produto. O rascunho já vem montado com os dados confirmados do cadastro."
            action={<Button variant="primary" onClick={() => setCreating(true)}>Novo anúncio</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sunk text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Anúncio</th>
                    <th className="px-3 py-2 font-medium">Canal</th>
                    <th className="px-3 py-2 text-right font-medium">Preço</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                    <th className="px-3 py-2 font-medium">Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((l) => (
                    <tr key={l.id} className="border-t border-line hover:bg-sunk/60">
                      <td className="max-w-md px-4 py-2.5">
                        <Link to={`/preparacao/${l.id}`} className="block truncate font-medium hover:text-accent hover:underline">
                          {l.title || <span className="text-muted italic">sem título</span>}
                        </Link>
                        <div className="truncate text-xs text-muted">{l.product.internal_sku ?? ''} · {l.product.commercial_name || l.product.nf_description}</div>
                      </td>
                      <td className="px-3 py-2.5">{l.marketplace.name}{l.variant_label && <div className="text-xs text-muted">{l.variant_label}</div>}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatBRL(l.suggested_price)}</td>
                      <td className="px-3 py-2.5"><Badge tone={LISTING_STATUS_TONE[l.status]}>{LISTING_STATUS_LABEL[l.status]}</Badge></td>
                      <td className="tabular px-3 py-2.5 text-muted">{formatDateTime(l.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={LISTINGS_PAGE} total={list.data.total} onPage={setPage} />
          </>
        )}
      </div>
      <NewListingModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
