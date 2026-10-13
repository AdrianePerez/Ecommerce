import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button, ErrorState, Input, Modal, Select, cn } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { CAPACITY_UNITS } from '@/lib/domain/product'
import { friendlyDbError } from '@/lib/supabase'
import { listSuppliers } from '@/modules/settings/api'
import { bulkUpdateProducts } from './api'
import { BULK_FIELDS, BULK_GROUPS, buildBulkChanges, describeChanges, type BulkField, type BulkValues } from './bulkEdit'

export function BulkEditModal({
  open, onClose, ids, onDone,
}: { open: boolean; onClose: () => void; ids: string[]; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers(), enabled: open })
  const [values, setValues] = useState<BulkValues>({})
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [showErrors, setShowErrors] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setValues({}); setEnabled(new Set()); setOnlyEmpty(false); setStep('edit'); setShowErrors(false); setServerError(null) }
  }, [open])

  const built = buildBulkChanges(values, enabled)
  const supplierName = (id: string) => suppliers.data?.find((s) => s.id === id)?.name

  const apply = useMutation({
    mutationFn: () => bulkUpdateProducts(ids, built.changes, onlyEmpty),
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['product'] })
      qc.invalidateQueries({ queryKey: ['product-filter-options'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['product-history'] })
      toast(`${n} ${n === 1 ? 'produto alterado' : 'produtos alterados'}.`)
      onDone()
    },
    onError: (e: Error) => { setServerError(friendlyDbError(e)); setStep('edit') },
  })

  const set = (k: string, v: string) => {
    setValues((x) => ({ ...x, [k]: v }))
    setEnabled((x) => new Set(x).add(k === 'capacity_value' || k === 'capacity_unit' ? 'capacity' : k))
  }
  const toggle = (k: string, on: boolean) => setEnabled((x) => { const n = new Set(x); if (on) n.add(k); else n.delete(k); return n })

  function next() {
    setShowErrors(true)
    if (built.valid) { setServerError(null); setStep('confirm') }
  }

  const count = ids.length
  const plural = count === 1 ? 'produto' : 'produtos'

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Alterar em massa · ${count} ${plural}`}
      footer={step === 'edit' ? (
        <>
          <span className="mr-auto self-center text-xs text-muted">{enabled.size} {enabled.size === 1 ? 'campo marcado' : 'campos marcados'}</span>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={enabled.size === 0} onClick={next}>Revisar alteração</Button>
        </>
      ) : (
        <>
          <Button onClick={() => setStep('edit')} disabled={apply.isPending}>Voltar</Button>
          <Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>Aplicar em {count} {plural}</Button>
        </>
      )}
    >
      {serverError && <div className="mb-3"><ErrorState message={serverError} /></div>}

      {step === 'confirm' ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>Os campos abaixo serão {onlyEmpty ? <strong>preenchidos onde estiverem vazios</strong> : <strong>substituídos</strong>} em <strong>{count} {plural}</strong>:</p>
          <ul className="rounded-md border border-line bg-sunk px-4 py-3">
            {describeChanges(built.changes, supplierName).map((l) => <li key={l} className="py-0.5">• {l}</li>)}
          </ul>
          <p className="text-xs text-muted">A alteração é feita de uma vez: se algum produto não aceitar o valor, nenhum é alterado. Cada produto registra a mudança no próprio histórico.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted">Marque os campos que deseja alterar. Campos desmarcados não mudam. Nome, EAN e SKUs são próprios de cada produto e não aparecem aqui.</p>

          <div className="flex flex-col gap-2 rounded-md border border-line bg-sunk px-4 py-3 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" className="mt-0.5 accent-accent" checked={!onlyEmpty} onChange={() => setOnlyEmpty(false)} />
              <span><strong>Substituir</strong> o valor atual em todos os selecionados</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" className="mt-0.5 accent-accent" checked={onlyEmpty} onChange={() => setOnlyEmpty(true)} />
              <span><strong>Só preencher onde estiver vazio</strong> (não mexe no que já foi preenchido)</span>
            </label>
          </div>

          {BULK_GROUPS.map((g) => (
            <fieldset key={g} className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-semibold">{g}</legend>
              <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                {BULK_FIELDS.filter((f) => f.group === g).map((f) => (
                  <FieldRow key={f.key} field={f} values={values} on={enabled.has(f.key)}
                    error={showErrors ? built.errors[f.key] : undefined}
                    suppliers={suppliers.data?.map((s) => ({ value: s.id, label: s.name })) ?? []}
                    onToggle={(on) => toggle(f.key, on)} onChange={set} />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </Modal>
  )
}

function FieldRow({
  field: f, values, on, error, suppliers, onToggle, onChange,
}: {
  field: BulkField
  values: BulkValues
  on: boolean
  error?: string
  suppliers: { value: string; label: string }[]
  onToggle: (on: boolean) => void
  onChange: (k: string, v: string) => void
}) {
  const id = `bulk_${f.key}`
  const options = f.kind === 'supplier' ? suppliers : f.options
  return (
    <div className={cn('flex flex-col gap-1 rounded-md border px-3 py-2', on ? 'border-accent bg-accent-soft/40' : 'border-line')}>
      <label className="flex items-center gap-2 text-[13px] font-medium">
        <input type="checkbox" className="size-4 accent-accent" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        {f.label}
      </label>
      {f.kind === 'capacity' ? (
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
          <Input aria-label="Valor da capacidade" inputMode="decimal" className="tabular" value={values.capacity_value ?? ''}
            onChange={(e) => onChange('capacity_value', e.target.value)} />
          <Select aria-label="Unidade da capacidade" value={values.capacity_unit ?? ''} onChange={(e) => onChange('capacity_unit', e.target.value)}>
            <option value="">—</option>
            {CAPACITY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </div>
      ) : options ? (
        <Select id={id} aria-label={f.label} value={values[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ) : (
        <Input id={id} aria-label={f.label} value={values[f.key] ?? ''}
          inputMode={['cm', 'g', 'year', 'ncm', 'cest'].includes(f.kind) ? 'decimal' : undefined}
          className={['cm', 'g', 'year'].includes(f.kind) ? 'tabular' : f.kind === 'ncm' || f.kind === 'cest' ? 'font-mono' : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(f.key, e.target.value)} />
      )}
      {error ? <span className="text-xs text-bad" role="alert">{error}</span> : f.hint && on ? <span className="text-xs text-muted">{f.hint}</span> : null}
    </div>
  )
}
