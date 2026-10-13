import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, ErrorState, Field, Input, Modal, Select, Spinner, Textarea } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { signedImageUrls, updateImage, type ProductImage } from './api'
import {
  KIND_LABEL, RIGHTS_LABEL, RIGHTS_TONE, STATUS_LABEL, STATUS_TONE, checkImageUrl,
  type ImageKind, type ImageRights, type ImageStatus,
} from './imageModel'

const SOURCE_LABEL: Record<string, string> = { manual: 'Enviada manualmente', catalogo: 'Catálogo do fornecedor', pesquisa: 'Pesquisa', ia: 'IA', nfe: 'Nota fiscal' }

/** Visualização ampliada do arquivo original, com navegação. */
export function ImageViewer({ images, index, onIndex, onClose }: {
  images: ProductImage[]; index: number | null; onIndex: (i: number) => void; onClose: () => void
}) {
  const img = index === null ? null : images[index]
  const url = useQuery({
    queryKey: ['image-original', img?.storage_path],
    queryFn: async () => (await signedImageUrls([img!.storage_path])).get(img!.storage_path) ?? null,
    enabled: !!img, staleTime: 50 * 60 * 1000,
  })
  useEffect(() => {
    if (index === null) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [index, images.length, onIndex])

  return (
    <Modal open={!!img} onClose={onClose} wide title={img ? `${KIND_LABEL[img.kind]} · ${index! + 1} de ${images.length}` : ''}>
      {img && (
        <div className="flex flex-col gap-3">
          <div className="relative flex min-h-80 items-center justify-center rounded bg-sunk">
            {url.isPending ? <Spinner /> : url.data ? (
              <img src={url.data} alt={img.file_name ?? 'Imagem do produto'} className="max-h-[60vh] max-w-full object-contain" />
            ) : <span className="text-sm text-muted">Arquivo indisponível.</span>}
            <Button size="sm" variant="secondary" className="absolute top-1/2 left-2 -translate-y-1/2" aria-label="Anterior"
              disabled={index === 0} onClick={() => onIndex(index! - 1)}><ChevronLeft className="size-4" /></Button>
            <Button size="sm" variant="secondary" className="absolute top-1/2 right-2 -translate-y-1/2" aria-label="Próxima"
              disabled={index === images.length - 1} onClick={() => onIndex(index! + 1)}><ChevronRight className="size-4" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={STATUS_TONE[img.status]}>{STATUS_LABEL[img.status]}</Badge>
            <Badge tone={RIGHTS_TONE[img.rights]}>{RIGHTS_LABEL[img.rights]}</Badge>
            <span className="text-muted tabular">{img.width}×{img.height} px</span>
            {url.data && <a href={url.data} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-accent hover:underline">
              Abrir original <ExternalLink className="size-3.5" aria-hidden /></a>}
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Edição de classificação, situação, direitos de uso e origem. */
export function ImageEditModal({ image, onClose, onSaved }: { image: ProductImage | null; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<ImageKind>('referencia')
  const [status, setStatus] = useState<ImageStatus>('aguardando_revisao')
  const [rights, setRights] = useState<ImageRights>('a_verificar')
  const [rightsNotes, setRightsNotes] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!image) return
    setKind(image.kind); setStatus(image.status); setRights(image.rights)
    setRightsNotes(image.rights_notes ?? ''); setSourceUrl(image.source_url ?? ''); setNotes(image.notes ?? ''); setError(null)
  }, [image])

  const save = useMutation({
    mutationFn: () => {
      if (sourceUrl.trim() && checkImageUrl(sourceUrl)) throw new Error('Link de origem inválido.')
      if (image!.is_main && (status !== 'aprovada' || rights === 'nao_autorizada'))
        throw new Error('Esta é a imagem principal: ela precisa continuar aprovada e com uso permitido. Escolha outra principal antes.')
      return updateImage(image!.id, {
        kind, status, rights, rights_notes: rightsNotes.trim() || null, source_url: sourceUrl.trim() || null, notes: notes.trim() || null,
      })
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: Error) => setError(friendlyDbError(e)),
  })

  return (
    <Modal open={!!image} onClose={onClose} title="Detalhes da imagem"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      {image && (
        <div className="flex flex-col gap-3">
          {error && <ErrorState message={error} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo" htmlFor="img_kind">
              <Select id="img_kind" value={kind} onChange={(e) => setKind(e.target.value as ImageKind)}>
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Situação" htmlFor="img_status">
              <Select id="img_status" value={status} onChange={(e) => setStatus(e.target.value as ImageStatus)}>
                {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Direito de uso" htmlFor="img_rights"
            hint="Encontrar a imagem na internet não significa autorização para uso comercial.">
            <Select id="img_rights" value={rights} onChange={(e) => setRights(e.target.value as ImageRights)}>
              {Object.entries(RIGHTS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Observação sobre o direito de uso" htmlFor="img_rights_notes">
            <Input id="img_rights_notes" value={rightsNotes} onChange={(e) => setRightsNotes(e.target.value)}
              placeholder="Ex.: fornecedor liberou por e-mail em 10/10/2026" />
          </Field>
          <Field label="Link de origem" htmlFor="img_source_url">
            <Input id="img_source_url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Observações" htmlFor="img_notes">
            <Textarea id="img_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-sunk p-3 text-xs">
            <dt className="text-muted">Origem</dt><dd>{SOURCE_LABEL[image.source] ?? image.source}{image.source_ref ? ` · ${image.source_ref}` : ''}</dd>
            <dt className="text-muted">Arquivo</dt>
            <dd className="tabular">{image.file_name ?? '—'} · {image.width}×{image.height} px · {((image.bytes ?? 0) / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB</dd>
            <dt className="text-muted">Incluída em</dt><dd>{formatDateTime(image.created_at)}</dd>
          </dl>
        </div>
      )}
    </Modal>
  )
}
