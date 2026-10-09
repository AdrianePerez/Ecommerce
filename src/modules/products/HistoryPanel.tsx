import { useQuery } from '@tanstack/react-query'
import { EmptyState, ErrorState, Spinner } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { listProfiles } from '@/modules/settings/api'
import { listProductHistory } from './api'

const IGNORED = new Set(['updated_at', 'created_at', 'created_by', 'id'])

const FIELD_LABEL: Record<string, string> = {
  commercial_name: 'Nome comercial', nf_description: 'Descrição da nota', internal_sku: 'SKU interno',
  supplier_sku: 'Código do fornecedor', ean: 'EAN', brand: 'Marca', model: 'Modelo', collection: 'Coleção',
  collection_year: 'Ano da coleção', main_supplier_id: 'Fornecedor principal', ncm: 'NCM', cest: 'CEST',
  fiscal_origin: 'Origem fiscal', fiscal_source: 'Fonte dos dados fiscais', unit: 'Unidade', material: 'Material',
  color: 'Cor', capacity_value: 'Capacidade', capacity_unit: 'Unidade da capacidade', height_mm: 'Altura (mm)',
  width_mm: 'Largura (mm)', depth_mm: 'Profundidade (mm)', weight_g: 'Peso (g)', pkg_height_mm: 'Altura emb. (mm)',
  pkg_width_mm: 'Largura emb. (mm)', pkg_depth_mm: 'Profundidade emb. (mm)', gross_weight_g: 'Peso bruto (g)',
  notes: 'Observações', status: 'Status', archived_at: 'Arquivado em',
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))

export function HistoryPanel({ productId }: { productId: string }) {
  const history = useQuery({ queryKey: ['product-history', productId], queryFn: () => listProductHistory(productId) })
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: listProfiles })
  const who = (id: string | null) => profiles.data?.find((p) => p.id === id)?.full_name ?? (id ? 'Usuário' : 'Sistema')

  if (history.isPending) return <Spinner />
  if (history.isError) return <ErrorState message={friendlyDbError(history.error)} onRetry={() => history.refetch()} />
  if (!history.data.length) return <EmptyState title="Sem registros" />

  return (
    <ol className="flex flex-col gap-2">
      {history.data.map((h) => {
        const changes =
          h.action === 'UPDATE' && h.old_data && h.new_data
            ? Object.keys(h.new_data).filter(
                (k) => !IGNORED.has(k) && JSON.stringify(h.old_data![k]) !== JSON.stringify(h.new_data![k]),
              )
            : []
        if (h.action === 'UPDATE' && changes.length === 0) return null
        return (
          <li key={h.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            <div className="mb-1 flex flex-wrap justify-between gap-2">
              <span className="font-medium">{h.action === 'INSERT' ? 'Produto cadastrado' : h.action === 'UPDATE' ? 'Alteração' : 'Exclusão'}</span>
              <span className="text-xs text-muted">{who(h.actor_id)} · {formatDateTime(h.created_at)}</span>
            </div>
            {changes.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-xs">
                {changes.map((k) => (
                  <li key={k}>
                    <span className="text-muted">{FIELD_LABEL[k] ?? k}:</span>{' '}
                    <span className="line-through decoration-muted/60">{show(h.old_data![k])}</span> → <strong>{show(h.new_data![k])}</strong>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
