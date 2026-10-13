import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, ErrorState, Field, Input, Modal, Spinner } from '@/components/ui'
import { friendlyDbError } from '@/lib/supabase'
import { listProducts } from '@/modules/products/api'
import type { Suggestion } from './importModel'

type Picked = { id: string; name: string }

/**
 * Escolha de produto para vincular um item de nota.
 * Mostra as sugestões por descrição e permite buscar por nome, SKU, código ou EAN.
 * Exige um motivo, que fica registrado no vínculo.
 */
export function ProductPicker({
  open, onClose, onPick, itemLabel, suggestions = [], reasonRequired = true, allowUnlink = false, confirmLabel = 'Vincular',
}: {
  open: boolean
  onClose: () => void
  onPick: (p: Picked | null, reason: string) => void
  itemLabel: string
  suggestions?: Suggestion[]
  reasonRequired?: boolean
  allowUnlink?: boolean
  confirmLabel?: string
}) {
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setText(''); setTerm(''); setPicked(null); setReason(''); setError(null) }
  }, [open])
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])

  const results = useQuery({
    queryKey: ['product-picker', term],
    queryFn: () => listProducts({ search: term }, 0),
    enabled: open && term.length >= 2,
  })

  function confirm(unlink = false) {
    if (!unlink && !picked) return setError('Escolha um produto.')
    if (reasonRequired && !reason.trim()) return setError('Informe o motivo (ex.: conferido na etiqueta, mesmo modelo do catálogo).')
    onPick(unlink ? null : picked, reason.trim() || 'Vínculo escolhido na conferência')
  }

  const option = (id: string, name: string, extra: React.ReactNode) => (
    <button
      key={id}
      type="button"
      onClick={() => setPicked({ id, name })}
      aria-pressed={picked?.id === id}
      className={
        'flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm ' +
        (picked?.id === id ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent')
      }
    >
      <span className="font-medium">{name}</span>
      <span className="shrink-0 text-xs text-muted">{extra}</span>
    </button>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vincular a um produto"
      wide
      footer={
        <>
          {allowUnlink && <Button variant="danger" className="mr-auto" onClick={() => confirm(true)}>Desvincular (não contar no custo)</Button>}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => confirm(false)}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Item da nota: <strong className="text-ink">{itemLabel}</strong></p>
        {error && <ErrorState message={error} />}

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-semibold">Descrição parecida</h3>
            {suggestions.map((s) =>
              option(s.id, s.name, <>
                {[s.brand, s.supplier_sku, s.ean].filter(Boolean).join(' · ')}{' '}
                <Badge tone={s.score >= 0.6 ? 'good' : 'neutral'}>{Math.round(s.score * 100)}% parecido</Badge>
              </>),
            )}
            <p className="text-xs text-muted">Semelhança de texto não garante que é o mesmo produto. Confira o modelo e a estampa.</p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold">Buscar produto</h3>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
            <Input className="pl-8" placeholder="Nome, SKU, código do fornecedor ou EAN" value={text}
              onChange={(e) => setText(e.target.value)} aria-label="Buscar produto" autoFocus />
          </div>
          {term.length >= 2 && (results.isPending ? <Spinner /> : results.isError ? (
            <ErrorState message={friendlyDbError(results.error)} />
          ) : results.data.rows.length === 0 ? (
            <p className="text-sm text-muted">Nenhum produto encontrado.</p>
          ) : (
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {results.data.rows.slice(0, 15).map((p) =>
                option(p.id, p.commercial_name || p.nf_description || '—', [p.brand, p.supplier_sku, p.ean].filter(Boolean).join(' · ')),
              )}
            </div>
          ))}
        </div>

        <Field label={reasonRequired ? 'Motivo do vínculo' : 'Motivo do vínculo (opcional)'} htmlFor="pick_reason"
          hint="Fica registrado junto com o vínculo.">
          <Input id="pick_reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
