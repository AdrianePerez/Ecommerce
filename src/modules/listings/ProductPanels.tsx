import { useQuery } from '@tanstack/react-query'
import { Copy, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Spinner } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatBRL, formatDateTime, formatNumber } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import type { Product } from '@/lib/database.types'
import { listProductImages, signedImageUrls } from '@/modules/images/api'
import { KIND_LABEL, thumbOf } from '@/modules/images/imageModel'
import { getCostSummary } from '@/modules/invoices/api'
import { listAttributes, listSources } from '@/modules/products/api'
import { listMarketplaces, listProductListings } from './api'
import { LISTING_STATUS_LABEL, LISTING_STATUS_TONE, sheetText } from './listingModel'
import { NewListingModal } from './NewListingModal'

const productName = (p: Pick<Product, 'commercial_name' | 'nf_description'>) => p.commercial_name || p.nf_description || 'Produto'

/** Aba "Anúncios" do produto. */
export function ProductListingsPanel({ product }: { product: Product }) {
  const listings = useQuery({ queryKey: ['product-listings', product.id], queryFn: () => listProductListings(product.id) })
  const markets = useQuery({ queryKey: ['marketplaces'], queryFn: listMarketplaces })
  const [newFor, setNewFor] = useState<string | null>(null)
  const active = (listings.data ?? []).filter((l) => l.status !== 'arquivado')
  const missing = (markets.data ?? []).filter((m) => m.active && !active.some((l) => l.marketplace_id === m.id))

  return (
    <div className="flex flex-col gap-3">
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Sem anúncio em:</span>
          {missing.map((m) => <Button key={m.id} size="sm" onClick={() => setNewFor(m.id)}><Plus className="size-3.5" aria-hidden /> {m.name}</Button>)}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {listings.isPending ? <Spinner /> : listings.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(listings.error)} onRetry={() => listings.refetch()} /></div>
        ) : !listings.data.length ? (
          <EmptyState title="Nenhum anúncio preparado" description="Crie o rascunho por canal: título, descrição e atributos já vêm montados com os dados confirmados." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sunk text-left text-xs text-muted">
              <tr><th className="px-4 py-2 font-medium">Canal</th><th className="px-3 py-2 font-medium">Título</th>
                <th className="px-3 py-2 text-right font-medium">Preço</th><th className="px-3 py-2 font-medium">Situação</th><th className="px-3 py-2 font-medium">Atualizado</th></tr>
            </thead>
            <tbody>
              {listings.data.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-4 py-2.5">{l.marketplace.name}{l.variant_label && <span className="text-muted"> · {l.variant_label}</span>}</td>
                  <td className="max-w-md px-3 py-2.5"><Link to={`/preparacao/${l.id}`} className="block truncate hover:text-accent hover:underline">{l.title || <i className="text-muted">sem título</i>}</Link></td>
                  <td className="tabular px-3 py-2.5 text-right">{formatBRL(l.suggested_price)}</td>
                  <td className="px-3 py-2.5"><Badge tone={LISTING_STATUS_TONE[l.status]}>{LISTING_STATUS_LABEL[l.status]}</Badge></td>
                  <td className="tabular px-3 py-2.5 text-muted">{formatDateTime(l.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <NewListingModal open={!!newFor} onClose={() => setNewFor(null)} marketplaceId={newFor ?? undefined}
        product={{ id: product.id, name: productName(product) }} />
    </div>
  )
}

/** Aba "Ficha comercial": tudo o que se sabe do produto num só lugar, para conferir e copiar. */
export function CommercialSheetPanel({ product }: { product: Product }) {
  const toast = useToast()
  const attrs = useQuery({ queryKey: ['attributes', product.id], queryFn: () => listAttributes(product.id) })
  const images = useQuery({ queryKey: ['product-images', product.id], queryFn: () => listProductImages(product.id) })
  const cost = useQuery({ queryKey: ['cost-summary', product.id], queryFn: () => getCostSummary(product.id) })
  const sources = useQuery({ queryKey: ['sources', product.id], queryFn: () => listSources(product.id) })
  const listings = useQuery({ queryKey: ['product-listings', product.id], queryFn: () => listProductListings(product.id) })
  const main = images.data?.find((i) => i.is_main) ?? null
  const mainUrl = useQuery({
    queryKey: ['image-thumbs-main', main?.id],
    queryFn: async () => (await signedImageUrls([thumbOf(main!.storage_path)])).get(thumbOf(main!.storage_path)) ?? null,
    enabled: !!main, staleTime: 50 * 60 * 1000,
  })

  if (attrs.isPending) return <Spinner />
  if (attrs.isError) return <ErrorState message={friendlyDbError(attrs.error)} />
  const text = sheetText(product, attrs.data)
  const pending = attrs.data.filter((a) => a.validation_status !== 'confirmada' && a.validation_status !== 'rejeitada')
  const approved = (images.data ?? []).filter((i) => i.status === 'aprovada')
  const catalogPrice = attrs.data.find((a) => a.attr_key === 'preco_sugerido_catalogo' && a.validation_status === 'confirmada')?.value_num

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast('Ficha copiada.') } catch { toast('Não foi possível copiar.', 'bad') }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card title="Dados confirmados" actions={<Button size="sm" variant="ghost" onClick={copy}><Copy className="size-3.5" aria-hidden /> Copiar ficha</Button>}>
        <dl className="grid grid-cols-[minmax(0,280px)_1fr] gap-x-4 gap-y-1.5 text-sm">
          {text.split('\n').map((line) => {
            const i = line.indexOf(': ')
            return [<dt key={`k${line}`} className="text-muted">{line.slice(0, i)}</dt>, <dd key={`v${line}`} className="tabular">{line.slice(i + 2)}</dd>]
          })}
        </dl>
        {pending.length > 0 && (
          <p className="mt-4 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
            {pending.length} informação(ões) aguardando confirmação não entram na ficha nem nos textos sugeridos: {pending.map((a) => a.label ?? a.attr_key).join(', ')}.
          </p>
        )}
      </Card>
      <div className="flex flex-col gap-4">
        <Card title="Imagem principal">
          {main && mainUrl.data ? <img src={mainUrl.data} alt="Imagem principal" className="mx-auto max-h-56 object-contain" />
            : <p className="text-sm text-muted">{images.isPending ? 'Carregando…' : 'Nenhuma imagem principal definida.'}</p>}
          <p className="mt-2 text-xs text-muted">
            {approved.length} aprovada(s){approved.length ? `: ${[...new Set(approved.map((i) => KIND_LABEL[i.kind]))].join(', ')}` : ''}.
          </p>
        </Card>
        <Card title="Comercial">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            <dt className="text-muted">Custo médio</dt><dd className="tabular">{cost.data ? formatBRL(cost.data.average_unit_cost) : '—'}</dd>
            <dt className="text-muted">Preço sugerido no catálogo</dt><dd className="tabular">{catalogPrice != null ? formatBRL(catalogPrice) : '—'}</dd>
            {cost.data && catalogPrice != null && cost.data.average_unit_cost > 0 && (<>
              <dt className="text-muted">Catálogo ÷ custo</dt><dd className="tabular">{formatNumber(catalogPrice / cost.data.average_unit_cost, 2)}×</dd>
            </>)}
            <dt className="text-muted">Fontes registradas</dt><dd className="tabular">{sources.data?.length ?? '—'}</dd>
          </dl>
          <div className="mt-3 flex flex-col gap-1">
            {(listings.data ?? []).filter((l) => l.status !== 'arquivado').map((l) => (
              <Link key={l.id} to={`/preparacao/${l.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-accent">
                <span>{l.marketplace.name}</span><Badge tone={LISTING_STATUS_TONE[l.status]}>{LISTING_STATUS_LABEL[l.status]}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
