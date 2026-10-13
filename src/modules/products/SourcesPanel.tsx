import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, Select, Spinner, Textarea } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { deleteSource, listAttributes, listSources, saveSource, type ResearchSource, type SourceType } from './api'

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  fabricante: 'Site do fabricante/marca', catalogo_oficial: 'Catálogo ou ficha oficial', distribuidor: 'Distribuidor autorizado',
  marketplace: 'Anúncio em marketplace', loja: 'Loja que vende o modelo', outro: 'Outra fonte',
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

/** Fontes consultadas para o produto. Atributos podem apontar para a fonte (aba Atributos). */
export function SourcesPanel({ productId }: { productId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: ['sources', productId], queryFn: () => listSources(productId) })
  const attrs = useQuery({ queryKey: ['attributes', productId], queryFn: () => listAttributes(productId) })
  const [editing, setEditing] = useState<ResearchSource | 'novo' | null>(null)
  const remove = useMutation({
    mutationFn: deleteSource,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sources', productId] }); qc.invalidateQueries({ queryKey: ['attributes', productId] }); toast('Fonte removida.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })
  const usedBy = (id: string) => (attrs.data ?? []).filter((a) => a.research_source_id === id)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Registre onde cada informação foi encontrada. Fonte fora do ar ou bloqueada também é registrada.</p>
        <Button variant="primary" onClick={() => setEditing('novo')}><Plus className="size-4" aria-hidden /> Nova fonte</Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {list.isPending ? <Spinner /> : list.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} /></div>
        ) : list.data.length === 0 ? (
          <EmptyState title="Nenhuma fonte registrada" description="Ex.: a página do produto no site da Luxcel, onde você conferiu medidas e material. Depois, na aba Atributos, escolha a fonte de cada valor." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sunk text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Fonte</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Consulta</th>
                <th className="px-3 py-2 font-medium">Informações</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => {
                const used = usedBy(s.id)
                return (
                  <tr key={s.id} className="border-t border-line align-top">
                    <td className="max-w-sm px-4 py-2.5">
                      <div className="font-medium">{s.title}</div>
                      {s.url && <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 truncate text-xs text-accent hover:underline">
                        <span className="truncate">{s.url}</span><ExternalLink className="size-3 shrink-0" aria-hidden /></a>}
                      {s.notes && <div className="mt-0.5 text-xs text-muted">{s.notes}</div>}
                    </td>
                    <td className="px-3 py-2.5">{SOURCE_TYPE_LABEL[s.source_type]}</td>
                    <td className="px-3 py-2.5">
                      <div className="tabular">{formatDate(s.accessed_on + 'T12:00')}</div>
                      {!s.accessible && <Badge tone="bad">Inacessível</Badge>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{used.length ? used.map((a) => a.label ?? a.attr_key).join(', ') : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" aria-label="Editar fonte" onClick={() => setEditing(s)}><Pencil className="size-4" /></Button>
                      <Button size="sm" variant="ghost" aria-label="Remover fonte"
                        onClick={() => confirm(used.length ? `Remover esta fonte? ${used.length} atributo(s) ficarão sem a referência.` : 'Remover esta fonte?') && remove.mutate(s.id)}>
                        <Trash2 className="size-4" /></Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <SourceModal productId={productId} value={editing} onClose={() => setEditing(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['sources', productId] })} />
    </div>
  )
}

function SourceModal({ productId, value, onClose, onSaved }: {
  productId: string; value: ResearchSource | 'novo' | null; onClose: () => void; onSaved: () => void
}) {
  const [type, setType] = useState<SourceType>('fabricante')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [date, setDate] = useState(today())
  const [accessible, setAccessible] = useState(true)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!value) return
    const s = value === 'novo' ? null : value
    setType(s?.source_type ?? 'fabricante'); setTitle(s?.title ?? ''); setUrl(s?.url ?? '')
    setDate(s?.accessed_on ?? today()); setAccessible(s?.accessible ?? true); setNotes(s?.notes ?? ''); setError(null)
  }, [value])

  const save = useMutation({
    mutationFn: () => {
      if (!title.trim()) throw new Error('Dê um nome para a fonte (ex.: Site Luxcel — página do produto).')
      if (url.trim() && !/^https?:\/\//i.test(url.trim())) throw new Error('O link precisa começar com http:// ou https://.')
      return saveSource(productId, { source_type: type, title: title.trim(), url: url.trim() || null, accessed_on: date, accessible, notes: notes.trim() || null },
        value !== 'novo' ? value?.id : undefined)
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: Error) => setError(friendlyDbError(e)),
  })

  return (
    <Modal open={!!value} onClose={onClose} title={value === 'novo' ? 'Nova fonte' : 'Editar fonte'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      <div className="flex flex-col gap-3">
        {error && <ErrorState message={error} />}
        <Field label="Tipo" htmlFor="src_type">
          <Select id="src_type" value={type} onChange={(e) => setType(e.target.value as SourceType)}>
            {Object.entries(SOURCE_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Nome" htmlFor="src_title"><Input id="src_title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Site Luxcel — Mochila Cinnamoroll" /></Field>
        <Field label="Link" htmlFor="src_url"><Input id="src_url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data da consulta" htmlFor="src_date"><Input id="src_date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!accessible} onChange={(e) => setAccessible(!e.target.checked)} className="size-4" />
            Página bloqueada ou fora do ar
          </label>
        </div>
        <Field label="Observações" htmlFor="src_notes"><Textarea id="src_notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
