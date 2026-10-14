import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ImageOff, PencilRuler, Plus, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Spinner } from '@/components/ui'
import { formatDate, formatDateTime, formatGrams, formatMmAsCm } from '@/lib/format'
import { listInvoiceOptions } from '@/modules/invoices/api'
import { friendlyDbError } from '@/lib/supabase'
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL } from '@/lib/domain/product'
import type { ProductOverview, ProductStatus } from '@/lib/database.types'
import { listSuppliers } from '@/modules/settings/api'
import { BULK_LIMIT, PAGE_SIZE, listFilterOptions, listProductIds, listProducts, type ProductFilters } from './api'
import { BulkEditModal } from './BulkEditModal'
import { productThumbs, type ProductThumb } from '@/modules/images/api'
import { StatusBadge } from './StatusBadge'

const FLAG_FILTERS = [
  { key: 'incomplete', label: 'Cadastro incompleto' },
  { key: 'missingDimensions', label: 'Sem dimensões' },
  { key: 'missingWeight', label: 'Sem peso' },
  { key: 'missingFiscal', label: 'Sem NCM' },
] as const

export function ProductsListPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const page = Number(params.get('p') ?? 0)

  const filters: ProductFilters = {
    search: params.get('q') ?? '',
    status: (params.get('status') ?? '') as ProductStatus | '',
    brand: params.get('marca') ?? '',
    collection: params.get('colecao') ?? '',
    supplierId: params.get('fornecedor') ?? '',
    incomplete: params.get('incomplete') === '1',
    missingDimensions: params.get('missingDimensions') === '1',
    missingWeight: params.get('missingWeight') === '1',
    missingFiscal: params.get('missingFiscal') === '1',
    invoiceId: params.get('nf') ?? '',
  }

  // Busca com pequeno atraso para não consultar a cada tecla
  const [searchText, setSearchText] = useState(filters.search ?? '')
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== searchText) update({ q: searchText })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('p' in patch)) next.delete('p')
    setParams(next, { replace: true })
  }

  const products = useQuery({
    queryKey: ['products', filters, page],
    queryFn: () => listProducts(filters, page),
    placeholderData: keepPreviousData,
  })
  const rowIds = products.data?.rows.map((r) => r.id) ?? []
  const thumbs = useQuery({
    queryKey: ['product-thumbs', rowIds.join(',')],
    queryFn: () => productThumbs(rowIds),
    enabled: rowIds.length > 0,
    staleTime: 50 * 60 * 1000, // links assinados valem 1 h
  })
  const options = useQuery({ queryKey: ['product-filter-options'], queryFn: listFilterOptions })
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers() })
  const invoices = useQuery({ queryKey: ['invoice-options'], queryFn: listInvoiceOptions })

  const anyFilter = [...params.keys()].some((k) => k !== 'p')

  // Seleção para alteração em massa (mantida ao trocar de página)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const pageIds = products.data?.rows.map((r) => r.id) ?? []
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const togglePage = (on: boolean) => setSelected((s) => {
    const n = new Set(s)
    for (const id of pageIds) { if (on) n.add(id); else n.delete(id) }
    return n
  })
  const toggleOne = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  async function selectAllFiltered() {
    setSelectingAll(true)
    try { setSelected(new Set(await listProductIds(filters))) } finally { setSelectingAll(false) }
  }
  const total = products.data?.total ?? 0

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Cadastro mestre: um registro por produto, independente de notas e anúncios."
        actions={
          <Button variant="primary" onClick={() => navigate('/produtos/novo')}>
            <Plus className="size-4" aria-hidden /> Novo produto
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
          <Input
            aria-label="Buscar produtos"
            placeholder="Buscar por nome, SKU, código do fornecedor, EAN, marca ou modelo"
            className="pl-8"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <Select aria-label="Status" className="w-48" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">Todos os status ativos</option>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>{PRODUCT_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Select aria-label="Marca" className="w-40" value={filters.brand} onChange={(e) => update({ marca: e.target.value })}>
          <option value="">Todas as marcas</option>
          {options.data?.brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </Select>
        <Select aria-label="Coleção" className="w-40" value={filters.collection} onChange={(e) => update({ colecao: e.target.value })}>
          <option value="">Todas as coleções</option>
          {options.data?.collections.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select aria-label="Fornecedor" className="w-48" value={filters.supplierId} onChange={(e) => update({ fornecedor: e.target.value })}>
          <option value="">Todos os fornecedores</option>
          {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select aria-label="NF de entrada" className="w-64" value={filters.invoiceId} onChange={(e) => update({ nf: e.target.value })}>
          <option value="">Todas as NF de entrada</option>
          {invoices.data?.map((n) => (
            <option key={n.id} value={n.id}>NF {n.number} · {n.supplier} · {formatDate(n.issued_at)}</option>
          ))}
        </Select>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FLAG_FILTERS.map(({ key, label }) => {
          const on = params.get(key) === '1'
          return (
            <button
              key={key}
              onClick={() => update({ [key]: on ? '' : '1' })}
              aria-pressed={on}
              className={
                on
                  ? 'rounded-full border border-accent bg-accent-soft px-3 py-1 text-xs font-medium text-accent'
                  : 'rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted hover:border-accent'
              }
            >
              {label}
            </button>
          )
        })}
        {anyFilter && (
          <button
            className="text-xs text-accent hover:underline"
            onClick={() => { setSearchText(''); setParams(new URLSearchParams(), { replace: true }) }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm">
          <strong>{selected.size.toLocaleString('pt-BR')} {selected.size === 1 ? 'produto selecionado' : 'produtos selecionados'}</strong>
          {allPageSelected && selected.size < total && total <= BULK_LIMIT && (
            <button className="text-accent underline-offset-2 hover:underline disabled:opacity-60" disabled={selectingAll} onClick={selectAllFiltered}>
              {selectingAll ? 'Selecionando…' : `Selecionar todos os ${total.toLocaleString('pt-BR')} do filtro`}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X className="size-4" aria-hidden /> Limpar seleção</Button>
            <Button size="sm" variant="primary" onClick={() => setBulkOpen(true)}><PencilRuler className="size-4" aria-hidden /> Alterar em massa</Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {products.isPending ? (
          <Spinner />
        ) : products.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(products.error)} onRetry={() => products.refetch()} /></div>
        ) : products.data.total === 0 ? (
          anyFilter ? (
            <EmptyState title="Nenhum produto encontrado" description="Ajuste a busca ou os filtros." />
          ) : (
            <EmptyState
              title="Nenhum produto cadastrado"
              description="Cadastre produtos manualmente. A partir da fase 2, eles também poderão ser criados pela importação de XML das notas fiscais."
              action={<Button variant="primary" onClick={() => navigate('/produtos/novo')}>Cadastrar primeiro produto</Button>}
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sunk text-left text-xs text-muted">
                  <tr>
                    <th className="w-10 py-2 pl-4">
                      <input type="checkbox" className="size-4 align-middle accent-accent" aria-label="Selecionar todos desta página"
                        checked={allPageSelected} onChange={(e) => togglePage(e.target.checked)} />
                    </th>
                    <th className="w-16 py-2 pl-2"><span className="sr-only">Foto</span></th>
                    <th className="px-3 py-2 font-medium">Produto</th>
                    <th className="px-3 py-2 font-medium">SKU / Código / EAN</th>
                    <th className="px-3 py-2 font-medium">Marca · Coleção</th>
                    <th className="px-3 py-2 font-medium">Dimensões (A×L×P)</th>
                    <th className="px-3 py-2 font-medium">Peso</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Pendências</th>
                    <th className="px-3 py-2 font-medium">Atualizado</th>
                  </tr>
                </thead>
                <tbody className={products.isPlaceholderData ? 'opacity-60' : ''}>
                  {products.data.rows.map((p) => <Row key={p.id} p={p} thumb={thumbs.data?.get(p.id)} thumbsLoading={thumbs.isPending && thumbs.fetchStatus !== 'idle'} selected={selected.has(p.id)} onSelect={(on) => toggleOne(p.id, on)} />)}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={products.data.total} onPage={(n) => update({ p: String(n) })} />
          </>
        )}
      </div>
      <BulkEditModal open={bulkOpen} ids={[...selected]} onClose={() => setBulkOpen(false)}
        onDone={() => { setBulkOpen(false); setSelected(new Set()) }} />
    </>
  )
}

function Row({ p, thumb, thumbsLoading, selected, onSelect }: {
  p: ProductOverview; thumb?: ProductThumb; thumbsLoading: boolean; selected: boolean; onSelect: (on: boolean) => void
}) {
  const dims = p.missing_dimensions
    ? null
    : `${formatMmAsCm(p.height_mm).replace(' cm', '')} × ${formatMmAsCm(p.width_mm).replace(' cm', '')} × ${formatMmAsCm(p.depth_mm)}`
  return (
    <tr className={selected ? 'border-t border-line bg-accent-soft/50' : 'border-t border-line hover:bg-sunk/60'}>
      <td className="py-2.5 pl-4">
        <input type="checkbox" className="size-4 align-middle accent-accent" aria-label={`Selecionar ${p.commercial_name || p.nf_description}`}
          checked={selected} onChange={(e) => onSelect(e.target.checked)} />
      </td>
      <td className="py-1.5 pl-2">
        <Thumb productId={p.id} thumb={thumb} loading={thumbsLoading} name={p.commercial_name || p.nf_description || ''} />
      </td>
      <td className="max-w-80 px-3 py-2.5">
        <Link to={`/produtos/${p.id}`} className="font-medium text-ink hover:text-accent hover:underline">
          {p.commercial_name || p.nf_description}
        </Link>
        {p.commercial_name && p.nf_description && (
          <div className="truncate text-xs text-muted" title={p.nf_description}>NF: {p.nf_description}</div>
        )}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs leading-5">
        {p.internal_sku && <div>{p.internal_sku}</div>}
        {p.supplier_sku && <div className="text-muted">{p.supplier_sku}</div>}
        {p.ean && <div className="text-muted">{p.ean}</div>}
        {!p.internal_sku && !p.supplier_sku && !p.ean && <span className="text-muted">—</span>}
      </td>
      <td className="px-3 py-2.5">
        <div>{p.brand ?? '—'}</div>
        {p.collection && <div className="text-xs text-muted">{p.collection}{p.collection_year ? ` · ${p.collection_year}` : ''}</div>}
      </td>
      <td className="tabular px-3 py-2.5 whitespace-nowrap">{dims ?? <Badge tone="warn">Falta</Badge>}</td>
      <td className="tabular px-3 py-2.5 whitespace-nowrap">{p.missing_weight ? <Badge tone="warn">Falta</Badge> : formatGrams(p.weight_g)}</td>
      <td className="px-3 py-2.5"><StatusBadge status={p.status} /></td>
      <td className="px-3 py-2.5">
        {p.missing_count === 0 ? <Badge tone="good">Completo</Badge> : <Badge tone="warn">{p.missing_count} {p.missing_count === 1 ? 'item' : 'itens'}</Badge>}
      </td>
      <td className="tabular px-3 py-2.5 whitespace-nowrap text-muted">{formatDateTime(p.updated_at)}</td>
    </tr>
  )
}

/** Fotinho do produto; ao passar o mouse, mostra maior. Sem foto: atalho para a aba Imagens. */
function Thumb({ productId, thumb, loading, name }: { productId: string; thumb?: ProductThumb; loading: boolean; name: string }) {
  const [preview, setPreview] = useState<{ left: number; top: number } | null>(null)
  if (!thumb) {
    return (
      <Link to={`/produtos/${productId}?aba=imagens`} title={loading ? '' : 'Sem foto — clique para adicionar'}
        className="flex size-12 items-center justify-center rounded-md border border-dashed border-line text-muted/60 hover:border-accent hover:text-accent">
        {loading ? <span className="size-12 animate-pulse rounded-md bg-sunk" /> : <ImageOff className="size-4" aria-hidden />}
      </Link>
    )
  }
  return (
    <Link to={`/produtos/${productId}?aba=imagens`} className="relative block size-12" aria-label={`Foto de ${name}`}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const size = 216
        setPreview({ left: r.right + 8, top: Math.max(8, Math.min(r.top - 8, window.innerHeight - size - 8)) })
      }}
      onMouseLeave={() => setPreview(null)}>
      <img src={thumb.url} alt="" loading="lazy" className="size-12 rounded-md border border-line bg-white object-contain" />
      {thumb.status !== 'aprovada' && (
        <span className="absolute -right-1 -bottom-1 size-2.5 rounded-full border-2 border-surface bg-warn" title="Foto ainda não aprovada" />
      )}
      {preview && (
        <span className="pointer-events-none fixed z-50 block w-52 rounded-lg border border-line bg-white p-1 shadow-lg" style={preview}>
          <img src={thumb.url} alt="" className="aspect-square w-full object-contain" />
        </span>
      )}
    </Link>
  )
}
