import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Link2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button, Card, ErrorState, PageHeader, Spinner } from '@/components/ui'
import { ReceiptCell, StageProgress } from './Receipt'
import { useToast } from '@/components/ui/toast'
import { formatBRL, formatCnpj, formatDateTime, formatNumber } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import type { MatchMethod } from '@/lib/database.types'
import { getInvoice, getInvoiceMonitor, listInvoiceItems, relinkItem, xmlDownloadUrl, type InvoiceItemRow } from './api'
import { ProductPicker } from './ProductPicker'

const METHOD_LABEL: Record<MatchMethod, string> = {
  ean: 'Pelo EAN', supplier_sku: 'Pelo código do fornecedor', manual: 'Manual', novo: 'Novo cadastro', ignorado: 'Ignorado',
}

export function InvoiceDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const toast = useToast()
  const [relinking, setRelinking] = useState<InvoiceItemRow | null>(null)

  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => getInvoice(id!) })
  const items = useQuery({ queryKey: ['invoice-items', id], queryFn: () => listInvoiceItems(id!) })
  const monitor = useQuery({ queryKey: ['invoice-monitor', id], queryFn: () => getInvoiceMonitor(id!) })

  const relink = useMutation({
    mutationFn: ({ item, productId, reason }: { item: InvoiceItemRow; productId: string | null; reason: string }) =>
      relinkItem(item.id, productId, reason),
    onSuccess: () => {
      setRelinking(null)
      qc.invalidateQueries({ queryKey: ['invoice-items', id] })
      qc.invalidateQueries({ queryKey: ['product-costs'] })
      qc.invalidateQueries({ queryKey: ['identifiers'] })
      toast('Vínculo corrigido. O custo foi estornado do produto anterior e lançado no novo.')
    },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  async function download(path: string) {
    try {
      window.location.href = await xmlDownloadUrl(path)
    } catch (e) {
      toast(friendlyDbError(e as Error), 'bad')
    }
  }

  if (invoice.isPending) return <Spinner />
  if (invoice.isError) return <ErrorState message={friendlyDbError(invoice.error)} onRetry={() => invoice.refetch()} />
  if (!invoice.data) return <ErrorState message="Nota não encontrada." />
  const inv = invoice.data

  return (
    <>
      <Link to="/entradas" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="size-4" aria-hidden /> Entrada de mercadorias
      </Link>
      <PageHeader
        title={`NF-e ${inv.number}${inv.series ? ` · série ${inv.series}` : ''}`}
        description={<>{inv.supplier?.name ?? inv.issuer_name} · emitida em {formatDateTime(inv.issued_at)}</>}
        actions={inv.xml_path && <Button onClick={() => download(inv.xml_path!)}><Download className="size-4" aria-hidden /> Baixar XML</Button>}
      />

      {monitor.data && (
        <div className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-line bg-surface px-4 py-3">
          <div><div className="mb-1 text-xs text-muted">Mercadoria</div><ReceiptCell inv={monitor.data} /></div>
          <div><div className="mb-1 text-xs text-muted">Cadastro dos produtos</div><StageProgress inv={monitor.data} /></div>
          <Link to={`/produtos?nf=${monitor.data.id}`} className="ml-auto text-sm text-accent hover:underline">Ver os produtos desta nota</Link>
        </div>
      )}

      <Card className="mb-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Info label="CNPJ do emitente" value={<span className="font-mono">{formatCnpj(inv.issuer_cnpj)}</span>} />
          <Info label="Natureza da operação" value={inv.nature ?? '—'} />
          <Info label="Protocolo" value={inv.protocol_status === '100' ? <Badge tone="good">Autorizada</Badge> : inv.protocol_status ?? <Badge tone="warn">Sem protocolo no XML</Badge>} />
          <Info label="Importada em" value={formatDateTime(inv.imported_at)} />
          <Info label="Produtos" value={formatBRL(inv.total_products)} />
          <Info label="IPI" value={formatBRL(inv.total_ipi)} />
          <Info label="Frete · Seguro" value={`${formatBRL(inv.total_freight)} · ${formatBRL(inv.total_insurance)}`} />
          <Info label="Desconto · Outras" value={`${formatBRL(inv.total_discount)} · ${formatBRL(inv.total_other)}`} />
          <Info label="ICMS-ST" value={formatBRL(inv.total_st)} />
          <Info label="Total da nota" value={<strong>{formatBRL(inv.total_invoice)}</strong>} />
          <Info label="Chave de acesso" className="col-span-2" value={<span className="font-mono text-xs break-all">{inv.access_key}</span>} />
        </dl>
      </Card>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {items.isPending ? <Spinner /> : items.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(items.error)} onRetry={() => items.refetch()} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-sunk text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Código / EAN</th>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                  <th className="px-3 py-2 text-right font-medium">Valor unit.</th>
                  <th className="px-3 py-2 text-right font-medium">IPI</th>
                  <th className="px-3 py-2 text-right font-medium">Custo unit.</th>
                  <th className="px-3 py-2 font-medium">Produto do cadastro</th>
                </tr>
              </thead>
              <tbody>
                {items.data.map((it) => {
                  const active = it.costs.find((c) => c.entry_type === 'entrada' && !c.is_reversed)
                  return (
                    <tr key={it.id} className="border-t border-line align-top">
                      <td className="tabular px-3 py-2.5">{it.item_number}</td>
                      <td className="px-3 py-2.5 font-mono text-xs leading-5"><div>{it.supplier_code}</div><div className="text-muted">{it.ean ?? 'sem EAN'}</div></td>
                      <td className="max-w-72 px-3 py-2.5">{it.description}<div className="font-mono text-xs text-muted">NCM {it.ncm ?? '—'}</div></td>
                      <td className="tabular px-3 py-2.5 text-right whitespace-nowrap">
                        {formatNumber(it.qty_com, 4)} {it.unit_com}
                        {Number(it.conversion_factor) !== 1 && <div className="text-xs text-muted">× {formatNumber(it.conversion_factor, 4)} = {formatNumber(it.base_qty, 4)} un</div>}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{formatBRL(it.unit_price_com)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatBRL(it.ipi_value)}</td>
                      <td className="tabular px-3 py-2.5 text-right font-medium">{active ? formatBRL(active.unit_cost) : '—'}</td>
                      <td className="min-w-60 px-3 py-2.5">
                        {it.product ? (
                          <Link to={`/produtos/${it.product.id}`} className="font-medium hover:text-accent hover:underline">
                            {it.product.commercial_name || it.product.nf_description}
                          </Link>
                        ) : <span className="text-muted">Não vinculado</span>}
                        <div className="mt-0.5 text-xs text-muted">{METHOD_LABEL[it.match_method]}{it.match_reason ? ` · ${it.match_reason}` : ''}</div>
                        <Button size="sm" variant="ghost" className="mt-1 h-7 px-2" onClick={() => setRelinking(it)}>
                          <Link2 className="size-3.5" aria-hidden /> Corrigir vínculo
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProductPicker
        open={!!relinking}
        onClose={() => setRelinking(null)}
        itemLabel={relinking ? `${relinking.supplier_code} · ${relinking.description}` : ''}
        allowUnlink={!!relinking?.product_id}
        confirmLabel="Corrigir vínculo"
        onPick={(p, reason) => relinking && relink.mutate({ item: relinking, productId: p?.id ?? null, reason })}
      />
    </>
  )
}

function Info({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular mt-0.5">{value}</dd>
    </div>
  )
}
