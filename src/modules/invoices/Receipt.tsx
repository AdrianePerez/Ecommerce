import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PackageCheck, Truck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, ErrorState, Field, Input, Modal, cn } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { STAGE_LABEL, setInvoiceReceived, type InvoiceListRow, type InvoiceStage } from './api'

export const STAGE_TONE: Record<InvoiceStage, 'warn' | 'bad' | 'accent' | 'good'> = {
  em_transito: 'warn', cadastro_pendente: 'bad', em_preparacao: 'accent', finalizada: 'good',
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

/** Selo de recebimento com ação para marcar/alterar. */
export function ReceiptCell({ inv, compact }: { inv: Pick<InvoiceListRow, 'id' | 'number' | 'received_at'>; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {inv.received_at ? (
        <button type="button" onClick={() => setOpen(true)} title="Alterar recebimento"
          className="inline-flex items-center gap-1.5 rounded px-1 text-left text-sm hover:bg-sunk">
          <PackageCheck className="size-4 text-good" aria-hidden />
          <span className="tabular">{compact ? formatDate(inv.received_at) : `Recebida em ${formatDate(inv.received_at)}`}</span>
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-warn"><Truck className="size-4" aria-hidden /> Em trânsito</span>
          <Button size="sm" onClick={() => setOpen(true)}>Recebi</Button>
        </div>
      )}
      <ReceiveModal open={open} inv={inv} onClose={() => setOpen(false)} />
    </>
  )
}

function ReceiveModal({ open, inv, onClose }: { open: boolean; inv: Pick<InvoiceListRow, 'id' | 'number' | 'received_at'>; onClose: () => void }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(today())
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) { setDate(inv.received_at ? new Date(inv.received_at).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : today()); setError(null) }
  }, [open, inv.received_at])
  const save = useMutation({
    mutationFn: (d: string | null) => setInvoiceReceived(inv.id, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['invoice-totals'] })
      qc.invalidateQueries({ queryKey: ['invoice-monitor', inv.id] })
      onClose()
    },
    onError: (e: Error) => setError(friendlyDbError(e)),
  })
  return (
    <Modal open={open} onClose={onClose} title={`Recebimento — NF-e ${inv.number}`}
      footer={<>
        {inv.received_at && <Button variant="ghost" className="mr-auto" loading={save.isPending && save.variables === null} onClick={() => save.mutate(null)}>Voltar para em trânsito</Button>}
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={save.isPending && save.variables !== null} onClick={() => date ? save.mutate(date) : setError('Informe a data.')}>Confirmar recebimento</Button>
      </>}>
      <div className="flex flex-col gap-3">
        {error && <ErrorState message={error} />}
        <Field label="Data em que a mercadoria chegou" htmlFor="rec_date">
          <Input id="rec_date" type="date" className="w-44" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">Só registra a chegada. Custos e estoque não mudam.</p>
      </div>
    </Modal>
  )
}

/** Andamento do cadastro dos produtos da nota. */
export function StageProgress({ inv }: { inv: Pick<InvoiceListRow, 'products_total' | 'products_ready' | 'products_incomplete' | 'items_ignored'> }) {
  const total = inv.products_total
  // estágio só do cadastro (independe do recebimento)
  const cad: InvoiceStage = inv.products_incomplete > 0 ? 'cadastro_pendente' : inv.products_ready < total ? 'em_preparacao' : 'finalizada'
  const pct = total ? (inv.products_ready / total) * 100 : 100
  return (
    <div className="flex min-w-44 flex-col gap-1">
      <div className="flex items-center gap-2">
        <Badge tone={STAGE_TONE[cad]}>{cad === 'finalizada' ? 'Cadastro finalizado' : STAGE_LABEL[cad]}</Badge>
      </div>
      {total > 0 ? (
        <div className="flex items-center gap-2" title={`${inv.products_ready} de ${total} produto(s) prontos para publicar; ${inv.products_incomplete} com cadastro incompleto`}>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-sunk" aria-hidden>
            <div className={cn('h-full rounded-full', pct === 100 ? 'bg-good' : 'bg-accent')} style={{ width: `${pct}%` }} />
          </div>
          <span className="tabular text-xs text-muted">{inv.products_ready}/{total} prontos{inv.products_incomplete ? ` · ${inv.products_incomplete} incompleto(s)` : ''}</span>
        </div>
      ) : (
        <span className="text-xs text-muted">Nenhum item para cadastrar{inv.items_ignored ? ` (${inv.items_ignored} ignorado(s))` : ''}</span>
      )}
    </div>
  )
}
