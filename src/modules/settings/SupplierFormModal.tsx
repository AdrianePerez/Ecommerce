import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, ErrorState, Field, Input, Modal, Textarea } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatCnpj } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { isValidCnpj, onlyDigits } from '@/lib/domain/validators'
import type { Supplier } from '@/lib/database.types'
import { saveSupplier } from './api'

export function SupplierFormModal({
  open, onClose, supplier, onSaved,
}: { open: boolean; onClose: () => void; supplier?: Supplier | null; onSaved?: (s: Supplier) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [tradeName, setTradeName] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(supplier?.name ?? '')
    setTradeName(supplier?.trade_name ?? '')
    setCnpj(supplier?.cnpj ? formatCnpj(supplier.cnpj) : '')
    setNotes(supplier?.notes ?? '')
    setError(null)
  }, [open, supplier])

  const save = useMutation({
    mutationFn: () =>
      saveSupplier(
        { name: name.trim(), trade_name: tradeName.trim() || null, cnpj: cnpj ? onlyDigits(cnpj) : null, notes: notes.trim() || null },
        supplier?.id,
      ),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      toast(supplier ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.')
      onSaved?.(s)
      onClose()
    },
    onError: (e: Error) => setError(friendlyDbError(e)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Informe a razão social.')
    if (cnpj && !isValidCnpj(cnpj)) return setError('CNPJ inválido.')
    save.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>Salvar</Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <ErrorState message={error} />}
        <Field label="Razão social" htmlFor="sup_name">
          <Input id="sup_name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Nome fantasia" htmlFor="sup_trade">
          <Input id="sup_trade" value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
        </Field>
        <Field label="CNPJ" htmlFor="sup_cnpj" hint="Usado para reconhecer o fornecedor nas notas fiscais.">
          <Input id="sup_cnpj" inputMode="numeric" className="font-mono" value={cnpj} onChange={(e) => setCnpj(e.target.value)}
            onBlur={() => isValidCnpj(cnpj) && setCnpj(formatCnpj(onlyDigits(cnpj)))} />
        </Field>
        <Field label="Observações" htmlFor="sup_notes">
          <Textarea id="sup_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
