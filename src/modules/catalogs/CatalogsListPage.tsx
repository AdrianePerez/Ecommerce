import { useQuery } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { CATALOG_STATUS_LABEL, listCatalogs, type CatalogStatus } from './api'

export const STATUS_TONE: Record<CatalogStatus, 'neutral' | 'good' | 'warn' | 'bad' | 'accent'> = {
  enviando: 'warn', aguardando_processamento: 'neutral', em_processamento: 'accent', processado: 'good',
  processado_parcialmente: 'warn', erro: 'bad', aguardando_revisao: 'warn',
}

export function CatalogsListPage() {
  const navigate = useNavigate()
  const list = useQuery({ queryKey: ['catalogs'], queryFn: listCatalogs })

  return (
    <>
      <PageHeader
        title="Catálogos e coleções"
        description="Catálogos dos fornecedores viram uma base de referência: fotos, códigos, medidas e preços sugeridos."
        actions={<Button variant="primary" onClick={() => navigate('/catalogos/novo')}><FileUp className="size-4" aria-hidden /> Enviar catálogo</Button>}
      />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {list.isPending ? <Spinner /> : list.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} /></div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhum catálogo enviado" description="Envie o PDF de um catálogo para revisar os produtos página a página."
            action={<Button variant="primary" onClick={() => navigate('/catalogos/novo')}>Enviar catálogo</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sunk text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Coleção</th>
                  <th className="px-3 py-2 font-medium">Fornecedor · Marca</th>
                  <th className="px-3 py-2 text-right font-medium">Páginas</th>
                  <th className="px-3 py-2 text-right font-medium">Produtos</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Enviado em</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((c) => (
                  <tr key={c.id} className="border-t border-line hover:bg-sunk/60">
                    <td className="px-4 py-2.5">
                      <Link to={`/catalogos/${c.id}`} className="font-medium hover:text-accent hover:underline">{c.name}</Link>
                      {c.collection_year && <span className="ml-1 text-muted">· {c.collection_year}</span>}
                    </td>
                    <td className="px-3 py-2.5">{c.supplier_name ?? '—'}{c.brand && <div className="text-xs text-muted">{c.brand}</div>}</td>
                    <td className="tabular px-3 py-2.5 text-right">{c.page_count || '—'}</td>
                    <td className="tabular px-3 py-2.5 text-right">
                      {c.items_total}
                      {c.items_pending > 0 && <div className="text-xs text-warn">{c.items_pending} a revisar</div>}
                    </td>
                    <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[c.status]}>{CATALOG_STATUS_LABEL[c.status]}</Badge></td>
                    <td className="tabular px-3 py-2.5 text-muted">{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
