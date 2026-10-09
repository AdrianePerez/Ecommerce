import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Spinner } from '@/components/ui'
import { formatDateTime, formatGrams, formatMmAsCm } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL } from '@/lib/domain/product'
import type { ProductOverview, ProductStatus } from '@/lib/database.types'
import { listSuppliers } from '@/modules/settings/api'
import { PAGE_SIZE, listFilterOptions, listProducts, type ProductFilters } from './api'
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
  const options = useQuery({ queryKey: ['product-filter-options'], queryFn: listFilterOptions })
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers() })

  const anyFilter = [...params.keys()].some((k) => k !== 'p')

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
                    <th className="px-4 py-2 font-medium">Produto</th>
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
                  {products.data.rows.map((p) => <Row key={p.id} p={p} />)}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={products.data.total} onPage={(n) => update({ p: String(n) })} />
          </>
        )}
      </div>
    </>
  )
}

function Row({ p }: { p: ProductOverview }) {
  const dims = p.missing_dimensions
    ? null
    : `${formatMmAsCm(p.height_mm).replace(' cm', '')} × ${formatMmAsCm(p.width_mm).replace(' cm', '')} × ${formatMmAsCm(p.depth_mm)}`
  return (
    <tr className="border-t border-line hover:bg-sunk/60">
      <td className="max-w-80 px-4 py-2.5">
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
