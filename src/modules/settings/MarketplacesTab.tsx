import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, ErrorState, Field, Input, Modal, Spinner, Textarea } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { useAuth } from '@/app/auth'
import { toAttrKey } from '@/modules/products/AttributesPanel'
import { listMarketplaces, updateMarketplace, type AttributeField, type MarketplaceConfig } from '@/modules/listings/api'
import { REQUIRED_FIELD_LABEL } from '@/modules/listings/listingModel'

const num = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR'))

export function MarketplacesTab() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const list = useQuery({ queryKey: ['marketplaces'], queryFn: listMarketplaces })
  const [editing, setEditing] = useState<MarketplaceConfig | null>(null)

  if (list.isPending) return <Spinner />
  if (list.isError) return <ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} />

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Limites e campos exigidos por canal, usados na Central de preparação. As regras dos marketplaces mudam: confira de tempos em tempos e atualize a data.
        {!isAdmin && ' Somente administradores alteram.'}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-sunk text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Canal</th>
              <th className="px-3 py-2 text-right font-medium">Título (máx.)</th>
              <th className="px-3 py-2 text-right font-medium">Descrição (máx.)</th>
              <th className="px-3 py-2 text-right font-medium">Imagens</th>
              <th className="px-3 py-2 font-medium">Exigidos</th>
              <th className="px-3 py-2 font-medium">Conferido em</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.data.map((m) => (
              <tr key={m.id} className="border-t border-line align-top">
                <td className="px-4 py-2.5"><div className="font-medium">{m.name}</div>{!m.active && <Badge>Inativo</Badge>}</td>
                <td className="tabular px-3 py-2.5 text-right">{num(m.title_max)}</td>
                <td className="tabular px-3 py-2.5 text-right">{num(m.description_max)}{m.description_plain_text && <div className="text-xs text-muted">só texto</div>}</td>
                <td className="tabular px-3 py-2.5 text-right">{m.images_max != null ? `${m.images_min}–${num(m.images_max)}` : `mín. ${m.images_min}`}</td>
                <td className="px-3 py-2.5 text-xs">
                  {m.required_fields.map((f) => REQUIRED_FIELD_LABEL[f] ?? f).join(', ')}
                  {m.attribute_fields.some((f) => f.required) && <div className="text-muted">+ {m.attribute_fields.filter((f) => f.required).map((f) => f.label).join(', ')}</div>}
                </td>
                <td className="tabular px-3 py-2.5">{m.rules_checked_on ? formatDate(m.rules_checked_on + 'T12:00') : <Badge tone="warn">nunca</Badge>}</td>
                <td className="px-3 py-2.5 text-right">
                  {isAdmin && <Button size="sm" variant="ghost" aria-label={`Editar ${m.name}`} onClick={() => setEditing(m)}><Pencil className="size-4" /></Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MarketplaceModal value={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

type Form = {
  active: boolean; title_min: string; title_max: string; description_max: string; description_plain_text: boolean
  images_min: string; images_max: string; keywords_max: string; required_fields: string[]; attribute_fields: AttributeField[]
  rules_notes: string; rules_checked_on: string
}

function MarketplaceModal({ value, onClose }: { value: MarketplaceConfig | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState<Form | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!value) return
    const s = (n: number | null) => (n == null ? '' : String(n))
    setF({
      active: value.active, title_min: s(value.title_min), title_max: s(value.title_max), description_max: s(value.description_max),
      description_plain_text: value.description_plain_text, images_min: String(value.images_min), images_max: s(value.images_max),
      keywords_max: s(value.keywords_max), required_fields: [...value.required_fields], attribute_fields: value.attribute_fields.map((a) => ({ ...a })),
      rules_notes: value.rules_notes ?? '', rules_checked_on: value.rules_checked_on ?? '',
    })
    setError(null)
  }, [value])

  const save = useMutation({
    mutationFn: () => {
      const int = (s: string, label: string, min = 0) => {
        if (!s.trim()) return null
        const n = Number(s)
        if (!Number.isInteger(n) || n < min) throw new Error(`${label}: use um número inteiro${min ? ` a partir de ${min}` : ''}.`)
        return n
      }
      const attrs = f!.attribute_fields.filter((a) => a.label.trim()).map((a) => ({ ...a, label: a.label.trim(), key: a.key || toAttrKey(a.label) }))
      if (new Set(attrs.map((a) => a.key)).size !== attrs.length) throw new Error('Há atributos com o mesmo nome.')
      if (attrs.some((a) => a.key.length < 2)) throw new Error('Nome de atributo muito curto.')
      return updateMarketplace(value!.id, {
        active: f!.active, title_min: int(f!.title_min, 'Título mínimo'), title_max: int(f!.title_max, 'Título máximo', 1),
        description_max: int(f!.description_max, 'Descrição máxima', 1), description_plain_text: f!.description_plain_text,
        images_min: int(f!.images_min, 'Mínimo de imagens') ?? 0, images_max: int(f!.images_max, 'Máximo de imagens', 1),
        keywords_max: int(f!.keywords_max, 'Palavras-chave'), required_fields: f!.required_fields, attribute_fields: attrs,
        rules_notes: f!.rules_notes.trim() || null, rules_checked_on: f!.rules_checked_on || null,
      }, value!.updated_at)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['marketplaces'] }); toast('Regras do canal salvas.'); onClose() },
    onError: (e: Error) => setError(friendlyDbError(e)),
  })

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x))
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

  return (
    <Modal open={!!value && !!f} onClose={onClose} wide title={value ? `Regras — ${value.name}` : ''}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      {f && (
        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} />}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Canal ativo (aparece ao criar anúncios)</label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Título mín." htmlFor="m_tmin"><Input id="m_tmin" inputMode="numeric" value={f.title_min} onChange={(e) => set('title_min', e.target.value)} /></Field>
            <Field label="Título máx." htmlFor="m_tmax"><Input id="m_tmax" inputMode="numeric" value={f.title_max} onChange={(e) => set('title_max', e.target.value)} /></Field>
            <Field label="Descrição máx." htmlFor="m_dmax"><Input id="m_dmax" inputMode="numeric" value={f.description_max} onChange={(e) => set('description_max', e.target.value)} /></Field>
            <Field label="Palavras-chave máx." htmlFor="m_kmax"><Input id="m_kmax" inputMode="numeric" value={f.keywords_max} onChange={(e) => set('keywords_max', e.target.value)} /></Field>
            <Field label="Imagens mín." htmlFor="m_imin"><Input id="m_imin" inputMode="numeric" value={f.images_min} onChange={(e) => set('images_min', e.target.value)} /></Field>
            <Field label="Imagens máx." htmlFor="m_imax"><Input id="m_imax" inputMode="numeric" value={f.images_max} onChange={(e) => set('images_max', e.target.value)} /></Field>
            <label className="col-span-2 mt-6 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={f.description_plain_text} onChange={(e) => set('description_plain_text', e.target.checked)} /> Descrição só em texto (sem HTML)</label>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Campos exigidos para “pronto para publicar”</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {Object.entries(REQUIRED_FIELD_LABEL).map(([k, l]) => (
                <label key={k} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" className="size-4" checked={f.required_fields.includes(k)}
                    onChange={(e) => set('required_fields', e.target.checked ? [...f.required_fields, k] : f.required_fields.filter((x) => x !== k))} /> {l}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Atributos do canal</legend>
            <div className="flex flex-col gap-1.5">
              {f.attribute_fields.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input aria-label="Nome do atributo" value={a.label} disabled={!!a.key && value!.attribute_fields.some((x) => x.key === a.key)}
                    onChange={(e) => set('attribute_fields', f.attribute_fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <label className="flex shrink-0 items-center gap-1.5 text-sm">
                    <input type="checkbox" className="size-4" checked={a.required}
                      onChange={(e) => set('attribute_fields', f.attribute_fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /> obrigatório
                  </label>
                  <Button size="sm" variant="ghost" aria-label="Remover atributo" onClick={() => set('attribute_fields', f.attribute_fields.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <Button size="sm" className="self-start" onClick={() => set('attribute_fields', [...f.attribute_fields, { key: '', label: '', required: false }])}>
                <Plus className="size-3.5" aria-hidden /> Atributo</Button>
            </div>
          </fieldset>
          <Field label="Observações sobre as regras" htmlFor="m_notes"><Textarea id="m_notes" value={f.rules_notes} onChange={(e) => set('rules_notes', e.target.value)} /></Field>
          <div className="flex items-end gap-2">
            <Field label="Regras conferidas em" htmlFor="m_checked"><Input id="m_checked" type="date" value={f.rules_checked_on} onChange={(e) => set('rules_checked_on', e.target.value)} /></Field>
            <Button size="sm" className="mb-0.5" onClick={() => set('rules_checked_on', today)}>Conferi hoje</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
