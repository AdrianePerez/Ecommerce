import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Select, Spinner } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatNumber } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { parseBrDecimal } from '@/lib/domain/numbers'
import type { ProductAttribute, ValidationStatus } from '@/lib/database.types'
import { addAttribute, listAttributes, listSources, removeAttribute, setAttributeStatus } from './api'

export const VALIDATION_LABEL: Record<ValidationStatus, string> = {
  encontrada: 'Encontrada',
  aguardando_revisao: 'Aguardando revisão',
  confirmada: 'Confirmada',
  rejeitada: 'Rejeitada',
  divergente: 'Divergente',
  nao_encontrada: 'Não encontrada',
}
const TONE: Record<ValidationStatus, 'good' | 'warn' | 'bad' | 'neutral'> = {
  encontrada: 'neutral', aguardando_revisao: 'warn', confirmada: 'good', rejeitada: 'bad', divergente: 'bad', nao_encontrada: 'neutral',
}
const SOURCE_LABEL: Record<string, string> = { manual: 'Manual', nfe: 'Nota fiscal', catalogo: 'Catálogo', pesquisa: 'Pesquisa', ia: 'IA' }

/** "Alça reforçada" → "alca_reforcada" */
export function toAttrKey(label: string) {
  return label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
}

export function AttributesPanel({ productId }: { productId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: ['attributes', productId], queryFn: () => listAttributes(productId) })
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [state, setState] = useState<ValidationStatus>('confirmada')
  const sources = useQuery({ queryKey: ['sources', productId], queryFn: () => listSources(productId) })
  const sourceTitle = new Map((sources.data ?? []).map((x) => [x.id, x]))
  const [error, setError] = useState<string | null>(null)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['attributes', productId] })

  const add = useMutation({
    mutationFn: () => {
      let num: number | null = null
      try { num = parseBrDecimal(value)?.toNumber() ?? null } catch { num = null }
      return addAttribute({
        product_id: productId, attr_key: toAttrKey(label), label: label.trim(),
        value_text: num === null ? value.trim() : null, value_num: num, unit: unit.trim() || null, notes: null,
        research_source_id: sourceId || null, validation_status: state,
      })
    },
    onSuccess: () => { setLabel(''); setValue(''); setUnit(''); setSourceId(''); setState('confirmada'); setError(null); invalidate(); toast('Atributo adicionado.') },
    onError: (e: Error) => setError(friendlyDbError(e)),
  })
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: ValidationStatus }) => setAttributeStatus(id, s),
    onSuccess: invalidate,
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })
  const remove = useMutation({
    mutationFn: removeAttribute,
    onSuccess: () => { invalidate(); toast('Atributo removido.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (toAttrKey(label).length < 2) return setError('Informe o nome do atributo.')
    if (!value.trim()) return setError('Informe o valor.')
    add.mutate()
  }

  const show = (a: ProductAttribute) =>
    a.value_num !== null ? `${formatNumber(a.value_num, 4)}${a.unit ? ` ${a.unit}` : ''}` : `${a.value_text}${a.unit ? ` ${a.unit}` : ''}`

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {list.isPending ? <Spinner /> : list.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} /></div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhum atributo adicional" description="Características específicas da categoria, como número de compartimentos ou tipo de alça. Valores aprovados nos catálogos aparecem aqui com a página de origem; os que você pesquisar podem apontar para uma fonte." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sunk text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Atributo</th>
                <th className="px-3 py-2 font-medium">Valor</th>
                <th className="px-3 py-2 font-medium">Fonte</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-4 py-2">{a.label ?? a.attr_key}</td>
                  <td className="tabular px-3 py-2">{show(a)}</td>
                  <td className="px-3 py-2">
                    {SOURCE_LABEL[a.source] ?? a.source}
                    {a.source_ref && <div className="max-w-48 truncate text-xs text-muted" title={a.source_ref}>{a.source_ref}</div>}
                    {a.research_source_id && sourceTitle.get(a.research_source_id) && (() => {
                      const src = sourceTitle.get(a.research_source_id)!
                      return src.url
                        ? <a href={src.url} target="_blank" rel="noreferrer noopener" className="block max-w-48 truncate text-xs text-accent hover:underline" title={src.title}>{src.title}</a>
                        : <div className="max-w-48 truncate text-xs text-muted" title={src.title}>{src.title}</div>
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={TONE[a.validation_status]}>{VALIDATION_LABEL[a.validation_status]}</Badge>
                      <Select
                        aria-label={`Alterar estado de ${a.label ?? a.attr_key}`}
                        className="h-7 w-32 text-xs"
                        value={a.validation_status}
                        onChange={(e) => status.mutate({ id: a.id, s: e.target.value as ValidationStatus })}
                      >
                        {Object.entries(VALIDATION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </Select>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" aria-label="Remover atributo"
                      onClick={() => confirm('Remover este atributo?') && remove.mutate(a.id)}>
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
        <h3 className="text-sm font-semibold">Adicionar atributo</h3>
        {error && <ErrorState message={error} />}
        <Field label="Atributo" htmlFor="attr_label" hint="Ex.: Compartimentos, Tipo de alça">
          <Input id="attr_label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Field label="Valor" htmlFor="attr_value"><Input id="attr_value" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Unidade" htmlFor="attr_unit"><Input id="attr_unit" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
        </div>
        <Field label="Fonte" htmlFor="attr_source" hint={sources.data?.length ? undefined : 'Cadastre fontes na aba Fontes.'}>
          <Select id="attr_source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Digitado por mim (sem fonte externa)</option>
            {sources.data?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </Select>
        </Field>
        <Field label="Estado" htmlFor="attr_state">
          <Select id="attr_state" value={state} onChange={(e) => setState(e.target.value as ValidationStatus)}>
            {(['confirmada', 'encontrada', 'aguardando_revisao', 'divergente'] as const).map((k) => <option key={k} value={k}>{VALIDATION_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Button type="submit" variant="primary" loading={add.isPending}>Adicionar</Button>
      </form>
    </div>
  )
}
