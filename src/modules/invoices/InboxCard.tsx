import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, Mail, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, ErrorState, Spinner } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatBRL, formatDate, formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { listInbox, setInboxStatus } from './api'

/** XMLs que chegaram sozinhos (e-mail/SEFAZ) e ainda não foram conferidos. */
export function InboxCard() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const inbox = useQuery({ queryKey: ['nfe-inbox'], queryFn: () => listInbox('nova'), refetchInterval: 5 * 60 * 1000 })
  const ignore = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => setInboxStatus(id, 'ignorada', reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nfe-inbox'] }); toast('Nota ignorada. Ela não volta a aparecer.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  if (inbox.isPending) return null
  if (inbox.isError) return <div className="mb-4"><ErrorState message={friendlyDbError(inbox.error)} /></div>
  const rows = inbox.data
  if (!rows.length) return null
  const importable = rows.filter((r) => r.has_full_xml)
  const open = (ids: string[]) => navigate(`/entradas/importar?caixa=${ids.join(',')}`)

  return (
    <Card className="mb-4 border-warn/40" title={`Aguardando importação (${rows.length})`}
      actions={importable.length > 1 && <Button size="sm" variant="primary" onClick={() => open(importable.slice(0, 20).map((r) => r.id))}>
        Conferir {Math.min(importable.length, 20)} de uma vez</Button>}>
      <p className="mb-3 flex items-center gap-2 text-sm text-muted"><Inbox className="size-4" aria-hidden />
        Notas que chegaram automaticamente. Ao conferir e gravar, elas entram como <strong className="font-medium text-ink">em trânsito</strong> até você marcar o recebimento.</p>
      {ignore.isPending && <Spinner label="Atualizando…" />}
      <div className="-mx-4 -mb-4 overflow-x-auto border-t border-line">
        <table className="w-full text-sm">
          <thead className="bg-sunk text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Emissão</th>
              <th className="px-3 py-2 font-medium">Nota</th>
              <th className="px-3 py-2 font-medium">Fornecedor</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Chegou por</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="tabular px-4 py-2.5">{formatDate(r.issued_at)}</td>
                <td className="px-3 py-2.5 font-medium">NF-e {r.number ?? '—'}{r.series ? `/${r.series}` : ''}</td>
                <td className="max-w-64 truncate px-3 py-2.5" title={r.issuer_name ?? ''}>{r.issuer_name ?? '—'}</td>
                <td className="tabular px-3 py-2.5 text-right">{formatBRL(r.total_invoice)}</td>
                <td className="px-3 py-2.5 text-xs text-muted">
                  <span className="inline-flex items-center gap-1" title={[r.email_from, r.email_subject].filter(Boolean).join(' — ')}>
                    {r.source === 'email' ? <><Mail className="size-3.5" aria-hidden /> E-mail</> : 'SEFAZ'} · {formatDateTime(r.received_at)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {r.has_full_xml
                    ? <Button size="sm" onClick={() => open([r.id])}>Conferir e importar</Button>
                    : <span className="text-xs text-muted">aguardando XML completo</span>}
                  <Button size="sm" variant="ghost" aria-label="Ignorar" title="Ignorar (não é compra para revenda, nota duplicada…)"
                    onClick={() => { const reason = prompt('Motivo para ignorar (opcional):', ''); if (reason !== null) ignore.mutate({ id: r.id, reason }) }}>
                    <X className="size-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
