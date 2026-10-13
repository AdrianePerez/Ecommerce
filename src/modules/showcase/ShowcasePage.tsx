import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ImageOff, LayoutGrid, Rows3, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Spinner, cn } from '@/components/ui'
import { formatBRL, formatDateTime } from '@/lib/format'
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL } from '@/lib/domain/product'
import { friendlyDbError } from '@/lib/supabase'
import type { ProductStatus } from '@/lib/database.types'
import { productThumbs, signedImageUrls } from '@/modules/images/api'
import { thumbOf } from '@/modules/images/imageModel'
import { listMarketplaces } from '@/modules/listings/api'
import { LISTING_STATUS_LABEL, LISTING_STATUS_TONE, type ListingStatus } from '@/modules/listings/listingModel'
import { listPricingRules, shippingMissing, simulate, type PricingRule } from '@/modules/pricing/api'
import { marginTone, pct } from '@/modules/pricing/components'
import { listFilterOptions } from '@/modules/products/api'
import { listSuppliers } from '@/modules/settings/api'
import { SHOWCASE_PAGE, completeness, listShowcase, type ShowcaseFilters, type ShowcaseRow } from './api'

const FLAGS: [keyof ShowcaseFilters, string][] = [
  ['incomplete', 'Cadastro incompleto'], ['noPhotos', 'Sem foto'], ['noDimensions', 'Sem dimensões'], ['noWeight', 'Sem peso'],
  ['noTitle', 'Sem título'], ['noDescription', 'Sem descrição'], ['noPrice', 'Sem preço'],
]

function readView(): 'grade' | 'tabela' {
  try { return localStorage.getItem('vitrine-modo') === 'tabela' ? 'tabela' : 'grade' } catch { return 'grade' }
}

export function ShowcasePage() {
  const [filters, setFilters] = useState<ShowcaseFilters>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [view, setView] = useState<'grade' | 'tabela'>(readView)
  useEffect(() => { try { localStorage.setItem('vitrine-modo', view) } catch { /* sem armazenamento: só não lembra */ } }, [view])
  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => ({ ...f, search })); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const list = useQuery({ queryKey: ['showcase', filters, page], queryFn: () => listShowcase(filters, page), placeholderData: keepPreviousData })
  const rows = list.data?.rows ?? []
  const markets = useQuery({ queryKey: ['marketplaces'], queryFn: listMarketplaces })
  const rules = useQuery({ queryKey: ['pricing-rules', 'all'], queryFn: () => listPricingRules() })
  const options = useQuery({ queryKey: ['product-filter-options'], queryFn: listFilterOptions })
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers() })
  // Foto: a principal do anúncio; senão a principal do produto; senão a primeira aprovada (ou em revisão)
  const thumbs = useQuery({
    queryKey: ['showcase-thumbs', rows.map((r) => `${r.row_id}:${r.listing_image_path ?? r.main_image_path ?? ''}`).join(',')],
    queryFn: async () => {
      const own = rows.filter((r) => r.listing_image_path || r.main_image_path)
      const [urls, fallback] = await Promise.all([
        signedImageUrls(own.map((r) => thumbOf((r.listing_image_path ?? r.main_image_path)!))),
        productThumbs([...new Set(rows.filter((r) => !r.listing_image_path && !r.main_image_path).map((r) => r.product_id))]),
      ])
      const out = new Map<string, string>()
      for (const r of rows) {
        const path = r.listing_image_path ?? r.main_image_path
        const url = path ? urls.get(thumbOf(path)) : fallback.get(r.product_id)?.url
        if (url) out.set(r.row_id, url)
      }
      return out
    },
    enabled: rows.length > 0, staleTime: 50 * 60 * 1000,
  })

  const set = <K extends keyof ShowcaseFilters>(k: K, v: ShowcaseFilters[K]) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0) }
  const active = FLAGS.filter(([k]) => filters[k]).length + (['listingStatus', 'productStatus', 'marketplace', 'brand', 'supplierId', 'collection'] as const).filter((k) => filters[k]).length

  return (
    <>
      <PageHeader title="Vitrine de anúncios" description="Produtos e anúncios num só lugar: foto, custo, preço, margem estimada e o que falta."
        actions={<div className="flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Modo de exibição">
          <Button size="sm" variant={view === 'grade' ? 'primary' : 'ghost'} aria-pressed={view === 'grade'} onClick={() => setView('grade')}><LayoutGrid className="size-4" aria-hidden /> Grade</Button>
          <Button size="sm" variant={view === 'tabela' ? 'primary' : 'ghost'} aria-pressed={view === 'tabela'} onClick={() => setView('tabela')}><Rows3 className="size-4" aria-hidden /> Tabela</Button>
        </div>} />

      <div className="mb-2 flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
          <Input className="pl-8" placeholder="Nome, SKU, código do fornecedor, EAN, marca ou modelo" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
        </div>
        <Select className="w-40" aria-label="Canal" value={filters.marketplace ?? ''} onChange={(e) => set('marketplace', e.target.value)}>
          <option value="">Todos os canais</option>
          {markets.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="sem">Sem anúncio</option>
        </Select>
        <Select className="w-48" aria-label="Situação do anúncio" value={filters.listingStatus ?? ''} onChange={(e) => set('listingStatus', e.target.value as ListingStatus | '')}>
          <option value="">Situação do anúncio</option>
          {(Object.keys(LISTING_STATUS_LABEL) as ListingStatus[]).filter((k) => k !== 'arquivado').map((k) => <option key={k} value={k}>{LISTING_STATUS_LABEL[k]}</option>)}
        </Select>
        <Select className="w-48" aria-label="Status do produto" value={filters.productStatus ?? ''} onChange={(e) => set('productStatus', e.target.value as ProductStatus | '')}>
          <option value="">Status do produto</option>
          {PRODUCT_STATUSES.filter((s) => s !== 'arquivado').map((s) => <option key={s} value={s}>{PRODUCT_STATUS_LABEL[s]}</option>)}
        </Select>
        <Select className="w-36" aria-label="Marca" value={filters.brand ?? ''} onChange={(e) => set('brand', e.target.value)}>
          <option value="">Todas as marcas</option>
          {options.data?.brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </Select>
        <Select className="w-40" aria-label="Fornecedor" value={filters.supplierId ?? ''} onChange={(e) => set('supplierId', e.target.value)}>
          <option value="">Todos os fornecedores</option>
          {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.trade_name || s.name}</option>)}
        </Select>
        <Select className="w-40" aria-label="Coleção" value={filters.collection ?? ''} onChange={(e) => set('collection', e.target.value)}>
          <option value="">Todas as coleções</option>
          {options.data?.collections.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FLAGS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={!!filters[k]} onClick={() => set(k, !filters[k])}
            className={cn('rounded-full border px-3 py-1 text-xs', filters[k] ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line bg-surface text-muted hover:border-accent')}>
            {l}
          </button>
        ))}
        {active > 0 && <Button size="sm" variant="ghost" onClick={() => { setFilters({ search }); setPage(0) }}>Limpar filtros</Button>}
        <span className="tabular ml-auto text-xs text-muted">{list.data ? `${list.data.total.toLocaleString('pt-BR')} linha(s)` : ''}</span>
      </div>

      <div className={cn('rounded-lg border border-line bg-surface', list.isPlaceholderData && 'opacity-60')}>
        {list.isPending ? <Spinner /> : list.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nada encontrado" description="Ajuste a busca ou os filtros. Produtos sem anúncio aparecem uma vez; com anúncios, uma linha por canal." />
        ) : view === 'grade' ? (
          <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {rows.map((r) => <Card key={r.row_id} r={r} rules={rules.data} thumb={thumbs.data?.get(r.row_id)} />)}
          </ul>
        ) : (
          <Table rows={rows} rules={rules.data} thumbs={thumbs.data} />
        )}
        {rows.length > 0 && <Pagination page={page} pageSize={SHOWCASE_PAGE} total={list.data?.total ?? 0} onPage={setPage} />}
      </div>
      <p className="mt-2 text-xs text-muted">Margem estimada com o custo médio atual e a regra de preço do anúncio. Não é o resultado contábil.</p>
    </>
  )
}

function useMargin(r: ShowcaseRow, rules: PricingRule[] | undefined) {
  return useMemo(() => {
    if (!r.listing_id || r.suggested_price == null || r.average_unit_cost == null || !rules) return null
    const rule = rules.find((x) => x.id === r.pricing_rule_id) ?? rules.find((x) => x.marketplace_id === r.marketplace_id && x.is_active)
    if (!rule) return null
    const s = simulate(rule, Number(r.average_unit_cost), Number(r.suggested_price), { shipping: r.shipping_cost })
    return { margin: s.result.marginPct, target: s.target, profit: s.result.profit,
      noShipping: shippingMissing(rule, r.shipping_cost, Number(r.suggested_price)) }
  }, [r, rules])
}

const name = (r: ShowcaseRow) => r.commercial_name || r.nf_description || 'Produto'
const link = (r: ShowcaseRow) => (r.listing_id ? `/preparacao/${r.listing_id}` : `/produtos/${r.product_id}`)

function Completeness({ r }: { r: ShowcaseRow }) {
  const c = completeness(r)
  const full = c.done === c.total
  return (
    <div title={full ? 'Completo' : `Falta: ${c.missing.join(', ')}`} className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-sunk" aria-hidden>
        <div className={cn('h-full rounded-full', full ? 'bg-good' : 'bg-warn')} style={{ width: `${(c.done / c.total) * 100}%` }} />
      </div>
      <span className="tabular text-xs text-muted">{c.done}/{c.total}</span>
    </div>
  )
}

function Card({ r, rules, thumb }: { r: ShowcaseRow; rules?: PricingRule[]; thumb?: string }) {
  const m = useMargin(r, rules)
  const c = completeness(r)
  return (
    <li className="flex flex-col overflow-hidden rounded-md border border-line">
      <Link to={link(r)} className="flex aspect-square items-center justify-center bg-white">
        {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain" /> : <ImageOff className="size-6 text-muted/50" aria-label="Sem foto" />}
      </Link>
      <div className="flex flex-1 flex-col gap-1 border-t border-line p-2.5 text-xs">
        <Link to={link(r)} className="line-clamp-2 text-sm font-medium hover:text-accent hover:underline">{r.title || name(r)}</Link>
        <span className="truncate font-mono text-muted">{r.internal_sku ?? r.supplier_sku ?? '—'}{r.brand && <span className="font-sans"> · {r.brand}</span>}</span>
        <div className="flex flex-wrap items-center gap-1">
          {r.listing_id ? <>
            <Badge tone="neutral">{r.marketplace_name}{r.variant_label ? ` · ${r.variant_label}` : ''}</Badge>
            <Badge tone={LISTING_STATUS_TONE[r.listing_status!]}>{LISTING_STATUS_LABEL[r.listing_status!]}</Badge>
          </> : <Badge tone="warn">Sem anúncio</Badge>}
        </div>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <dt className="text-muted">Custo</dt><dd className="tabular text-right">{formatBRL(r.average_unit_cost)}</dd>
          <dt className="text-muted">Preço</dt><dd className="tabular text-right font-medium">{formatBRL(r.suggested_price)}</dd>
          <dt className="text-muted">Margem</dt><dd className={cn('tabular text-right', marginTone(m?.margin, m?.target))}>{m ? pct(m.margin) : '—'}
            {m?.noShipping && <span className="block text-[11px] text-warn" title="Frete não informado no anúncio: a margem real é menor">sem frete</span>}</dd>
        </dl>
        <div className="mt-auto flex items-center justify-between pt-1.5" title={c.missing.length ? `Falta: ${c.missing.join(', ')}` : 'Completo'}>
          <Completeness r={r} />
        </div>
      </div>
    </li>
  )
}

function Table({ rows, rules, thumbs }: { rows: ShowcaseRow[]; rules?: PricingRule[]; thumbs?: Map<string, string> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-sunk text-left text-xs text-muted">
          <tr>
            <th className="w-14 py-2 pl-3"><span className="sr-only">Foto</span></th>
            <th className="px-3 py-2 font-medium">Produto / anúncio</th>
            <th className="px-3 py-2 font-medium">SKU · Marca</th>
            <th className="px-3 py-2 font-medium">Canal</th>
            <th className="px-3 py-2 text-right font-medium">Custo médio</th>
            <th className="px-3 py-2 text-right font-medium">Preço</th>
            <th className="px-3 py-2 text-right font-medium">Margem est.</th>
            <th className="px-3 py-2 font-medium">Completude</th>
            <th className="px-3 py-2 font-medium">Atualizado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <TableRow key={r.row_id} r={r} rules={rules} thumb={thumbs?.get(r.row_id)} />)}
        </tbody>
      </table>
    </div>
  )
}

function TableRow({ r, rules, thumb }: { r: ShowcaseRow; rules?: PricingRule[]; thumb?: string }) {
  const m = useMargin(r, rules)
  return (
    <tr className="border-t border-line hover:bg-sunk/60">
      <td className="py-1.5 pl-3">
        <Link to={link(r)} className="flex size-10 items-center justify-center rounded border border-line bg-white">
          {thumb ? <img src={thumb} alt="" loading="lazy" className="size-10 rounded object-contain" /> : <ImageOff className="size-4 text-muted/50" aria-label="Sem foto" />}
        </Link>
      </td>
      <td className="max-w-80 px-3 py-2">
        <Link to={link(r)} className="block truncate font-medium hover:text-accent hover:underline">{r.title || name(r)}</Link>
        {r.title && <div className="truncate text-xs text-muted">{name(r)}</div>}
      </td>
      <td className="px-3 py-2"><div className="font-mono text-xs">{r.internal_sku ?? r.supplier_sku ?? '—'}</div><div className="text-xs text-muted">{r.brand ?? ''}</div></td>
      <td className="px-3 py-2">
        {r.listing_id ? <div className="flex flex-col items-start gap-0.5"><span>{r.marketplace_name}{r.variant_label ? ` · ${r.variant_label}` : ''}</span>
          <Badge tone={LISTING_STATUS_TONE[r.listing_status!]}>{LISTING_STATUS_LABEL[r.listing_status!]}</Badge></div> : <Badge tone="warn">Sem anúncio</Badge>}
      </td>
      <td className="tabular px-3 py-2 text-right">{formatBRL(r.average_unit_cost)}</td>
      <td className="tabular px-3 py-2 text-right font-medium">{formatBRL(r.suggested_price)}</td>
      <td className={cn('tabular px-3 py-2 text-right', marginTone(m?.margin, m?.target))}>{m ? pct(m.margin) : '—'}
        {m?.noShipping && <span className="block text-[11px] text-warn" title="Frete não informado no anúncio: a margem real é menor">sem frete</span>}</td>
      <td className="px-3 py-2"><Completeness r={r} /></td>
      <td className="tabular px-3 py-2 whitespace-nowrap text-muted">{formatDateTime(r.updated_at)}</td>
    </tr>
  )
}
