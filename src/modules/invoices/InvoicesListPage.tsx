import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileUp, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, ErrorState, Input, PageHeader, Pagination, Spinner } from '@/components/ui'
import { formatBRL, formatDate, formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { INVOICE_PAGE_SIZE, listInvoices } from './api'

export function InvoicesListPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const page = Number(params.get('p') ?? 0)
  const [text, setText] = useState(params.get('q') ?? '')
  const q = params.get('q') ?? ''

  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) setParams(text ? { q: text } : {}, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [text, q, setParams])

  const list = useQuery({
    queryKey: ['invoices', q, page],
    queryFn: () => listInvoices(q, page),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader
        title="Entrada de mercadorias"
        description="Notas fiscais de compra importadas. Cada nota é contada uma única vez nos custos."
        actions={<Button variant="primary" onClick={() => navigate('/entradas/importar')}><FileUp className="size-4" aria-hidden /> Importar XML</Button>}
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
        <Input className="pl-8" aria-label="Buscar notas" placeholder="Número, fornecedor, CNPJ ou chave de acesso"
          value={text} onChange={(e) => setText(e.target.value)} />
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {list.isPending ? <Spinner /> : list.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} /></div>
        ) : list.data.total === 0 ? (
          q ? <EmptyState title="Nenhuma nota encontrada" /> : (
            <EmptyState title="Nenhuma nota importada" description="Importe o XML das notas de compra para registrar os produtos e calcular o custo."
              action={<Button variant="primary" onClick={() => navigate('/entradas/importar')}>Importar XML</Button>} />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sunk text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Emissão</th>
                    <th className="px-3 py-2 font-medium">Nota</th>
                    <th className="px-3 py-2 font-medium">Fornecedor</th>
                    <th className="px-3 py-2 text-right font-medium">Itens</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Importada em</th>
                  </tr>
                </thead>
                <tbody className={list.isPlaceholderData ? 'opacity-60' : ''}>
                  {list.data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-line hover:bg-sunk/60">
                      <td className="tabular px-4 py-2.5">{formatDate(r.issued_at)}</td>
                      <td className="px-3 py-2.5">
                        <Link to={`/entradas/${r.id}`} className="font-medium hover:text-accent hover:underline">
                          NF-e {r.number}{r.series ? `/${r.series}` : ''}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">{r.supplier?.name ?? r.issuer_name}</td>
                      <td className="tabular px-3 py-2.5 text-right">{r.items?.[0]?.count ?? '—'}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatBRL(r.total_invoice)}</td>
                      <td className="tabular px-3 py-2.5 text-muted">{formatDateTime(r.imported_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={INVOICE_PAGE_SIZE} total={list.data.total}
              onPage={(n) => setParams({ ...(q ? { q } : {}), p: String(n) }, { replace: true })} />
          </>
        )}
      </div>
    </>
  )
}
