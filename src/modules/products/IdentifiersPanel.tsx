import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Select, Spinner } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { isValidGtin } from '@/lib/domain/validators'
import type { IdentifierType } from '@/lib/database.types'
import { listSuppliers } from '@/modules/settings/api'
import { addIdentifier, listIdentifiers, removeIdentifier } from './api'

const TYPE_LABEL: Record<IdentifierType, string> = { ean: 'EAN/GTIN', supplier_sku: 'Código do fornecedor', outro: 'Outro' }
const SOURCE_LABEL: Record<string, string> = { manual: 'Manual', nfe: 'Nota fiscal', catalogo: 'Catálogo', pesquisa: 'Pesquisa', ia: 'IA' }

export function IdentifiersPanel({ productId }: { productId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: ['identifiers', productId], queryFn: () => listIdentifiers(productId) })
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers() })

  const [type, setType] = useState<IdentifierType>('ean')
  const [value, setValue] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const add = useMutation({
    mutationFn: () =>
      addIdentifier({
        product_id: productId,
        id_type: type,
        value: value.trim(),
        supplier_id: type === 'supplier_sku' ? supplierId : null,
        match_reason: reason.trim() || 'Vínculo informado manualmente',
      }),
    onSuccess: () => {
      setValue('')
      setReason('')
      setFormError(null)
      qc.invalidateQueries({ queryKey: ['identifiers', productId] })
      toast('Identificador adicionado.')
    },
    onError: (e: Error) => setFormError(friendlyDbError(e)),
  })

  const remove = useMutation({
    mutationFn: removeIdentifier,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['identifiers', productId] })
      toast('Vínculo removido. A alteração ficou registrada na auditoria.')
    },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!value.trim()) return setFormError('Informe o código.')
    if (type === 'ean' && !isValidGtin(value.trim())) return setFormError('EAN/GTIN inválido (confira os dígitos).')
    if (type === 'supplier_sku' && !supplierId) return setFormError('Selecione o fornecedor deste código.')
    add.mutate()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {list.isPending ? <Spinner /> : list.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} /></div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhum identificador" description="EAN e códigos de fornecedor usados para reconhecer este produto nas notas e catálogos." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sunk text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Código</th>
                <th className="px-3 py-2 font-medium">Fornecedor</th>
                <th className="px-3 py-2 font-medium">Origem e motivo</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className="px-4 py-2">{TYPE_LABEL[i.id_type]}</td>
                  <td className="px-3 py-2 font-mono">{i.value}</td>
                  <td className="px-3 py-2">{i.supplier?.name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge>{SOURCE_LABEL[i.source] ?? i.source}</Badge>
                    {i.match_reason && <div className="mt-0.5 text-xs text-muted">{i.match_reason}</div>}
                    <div className="text-xs text-muted">{formatDateTime(i.created_at)}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remover vínculo ${i.value}`}
                      loading={remove.isPending && remove.variables === i.id}
                      onClick={() => {
                        if (confirm(`Remover o vínculo do código ${i.value} com este produto?`)) remove.mutate(i.id)
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold">Adicionar identificador</h3>
        {formError && <ErrorState message={formError} />}
        <Field label="Tipo" htmlFor="id_type">
          <Select id="id_type" value={type} onChange={(e) => setType(e.target.value as IdentifierType)}>
            {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        {type === 'supplier_sku' && (
          <Field label="Fornecedor" htmlFor="id_supplier">
            <Select id="id_supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Código" htmlFor="id_value">
          <Input id="id_value" className="font-mono" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Motivo do vínculo" htmlFor="id_reason" hint="Ex.: conferido na etiqueta do produto">
          <Input id="id_reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={add.isPending}>Adicionar</Button>
      </form>
    </div>
  )
}
