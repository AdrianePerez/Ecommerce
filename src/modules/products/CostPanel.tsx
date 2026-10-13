import { useQuery } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { Link } from 'react-router-dom'
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui'
import { formatBRL, formatDate, formatNumber } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { getCostSummary, listCostHistory, type CostHistoryRow } from '@/modules/invoices/api'

/** Resumo para a coluna lateral da ficha do produto. */
export function CostSummaryCard({ productId }: { productId: string }) {
  const s = useQuery({ queryKey: ['product-costs', 'summary', productId], queryFn: () => getCostSummary(productId) })
  if (s.isPending) return <Spinner />
  if (s.isError) return <ErrorState message={friendlyDbError(s.error)} />
  if (!s.data) return <p className="text-sm text-muted">Sem compras registradas. O custo aparece quando uma NF-e com este produto for importada.</p>
  const d = s.data
  return (
    <dl className="flex flex-col gap-3 text-sm">
      <div>
        <dt className="text-xs text-muted">Custo médio ponderado</dt>
        <dd className="tabular text-xl font-semibold">{formatBRL(d.average_unit_cost)}</dd>
        <dd className="tabular text-xs text-muted">{formatNumber(d.total_quantity, 4)} un em {d.entries} {d.entries === 1 ? 'entrada' : 'entradas'}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Última compra</dt>
        <dd className="tabular font-medium">{formatBRL(d.last_unit_cost)}</dd>
        <dd className="tabular text-xs text-muted">{formatDate(d.last_purchase_at)} · {formatNumber(d.last_quantity, 4)} un</dd>
      </div>
      <p className="text-xs text-muted">Custo gerencial simplificado (regra configurável). Não é o custo contábil.</p>
    </dl>
  )
}

/** Variação % em relação à compra vigente anterior (por data). */
export function withVariation(rows: CostHistoryRow[]) {
  const active = rows.filter((r) => r.entry_type === 'entrada' && !r.is_reversed)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.created_at.localeCompare(b.created_at))
  const variation = new Map<string, number | null>()
  active.forEach((r, i) => {
    const prev = active[i - 1]
    variation.set(r.id, prev && Number(prev.unit_cost) > 0
      ? new Decimal(r.unit_cost).minus(prev.unit_cost).dividedBy(prev.unit_cost).times(100).toDecimalPlaces(1).toNumber()
      : null)
  })
  return variation
}

export function CostHistoryPanel({ productId }: { productId: string }) {
  const h = useQuery({ queryKey: ['product-costs', 'history', productId], queryFn: () => listCostHistory(productId) })
  if (h.isPending) return <Spinner />
  if (h.isError) return <ErrorState message={friendlyDbError(h.error)} onRetry={() => h.refetch()} />
  if (!h.data.length) return <EmptyState title="Nenhuma compra registrada" description="As entradas aparecem aqui quando uma NF-e com este produto é importada." />
  const variation = withVariation(h.data)

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-sunk text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Data</th>
            <th className="px-3 py-2 font-medium">Nota</th>
            <th className="px-3 py-2 font-medium">Fornecedor</th>
            <th className="px-3 py-2 text-right font-medium">Quantidade</th>
            <th className="px-3 py-2 text-right font-medium">Produtos + IPI</th>
            <th className="px-3 py-2 text-right font-medium">Custo unit.</th>
            <th className="px-3 py-2 text-right font-medium">Variação</th>
            <th className="px-3 py-2 font-medium">Situação</th>
          </tr>
        </thead>
        <tbody>
          {h.data.map((r) => {
            const v = variation.get(r.id)
            const muted = r.entry_type === 'estorno' || r.is_reversed
            return (
              <tr key={r.id} className={`border-t border-line align-top ${muted ? 'text-muted' : ''}`}>
                <td className="tabular px-4 py-2.5">{formatDate(r.occurred_at)}</td>
                <td className="px-3 py-2.5">
                  {r.item?.invoice ? (
                    <Link to={`/entradas/${r.item.invoice.id}`} className="hover:text-accent hover:underline">
                      NF-e {r.item.invoice.number} · item {r.item.item_number}
                    </Link>
                  ) : '—'}
                </td>
                <td className="px-3 py-2.5">{r.supplier?.name ?? '—'}</td>
                <td className="tabular px-3 py-2.5 text-right whitespace-nowrap">
                  {formatNumber(r.quantity, 4)} un
                  {r.item && Number(r.item.conversion_factor) !== 1 && (
                    <div className="text-xs text-muted">{formatNumber(r.item.qty_com, 4)} {r.item.unit_com} × {formatNumber(r.item.conversion_factor, 4)}</div>
                  )}
                </td>
                <td className="tabular px-3 py-2.5 text-right">{formatBRL(Number(r.products_value) + Number(r.ipi_value))}</td>
                <td className="tabular px-3 py-2.5 text-right font-medium">{formatBRL(r.unit_cost)}</td>
                <td className="tabular px-3 py-2.5 text-right">
                  {v === null || v === undefined ? '—' : (
                    <span className={v > 0 ? 'text-bad' : v < 0 ? 'text-good' : ''}>{v > 0 ? '+' : ''}{formatNumber(v, 1)}%</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {r.entry_type === 'estorno' ? <Badge tone="warn">Estorno</Badge> : r.is_reversed ? <Badge>Estornada</Badge> : <Badge tone="good">Vigente</Badge>}
                  <span className="ml-1 text-xs text-muted">regra v{r.rule?.version}</span>
                  {r.reason && <div className="mt-0.5 max-w-56 text-xs text-muted">{r.reason}</div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
