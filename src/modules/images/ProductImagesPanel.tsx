import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowRight, Check, Download, Layers, Link2, Pencil, Star, Trash2, Upload, X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, Select, Spinner } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { friendlyDbError } from '@/lib/supabase'
import {
  addImage, deleteImage, downloadZip, fetchImageFromUrl, importCatalogCrop, listProductImages, pendingCatalogCrops,
  reorderImages, setMainImage, signedImageUrls, updateImage, type ProductImage,
} from './api'
import { ImageEditModal, ImageViewer } from './ImageDialogs'
import {
  KIND_LABEL, RIGHTS_LABEL, RIGHTS_TONE, STATUS_LABEL, STATUS_TONE, checkImageUrl, moveInList, thumbOf,
  type ImageKind, type ImageRights,
} from './imageModel'

type ProductRef = { id: string; internal_sku: string | null; supplier_sku: string | null }

export function ProductImagesPanel({ product }: { product: ProductRef }) {
  const qc = useQueryClient()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const versionRef = useRef<HTMLInputElement>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [urlOpen, setUrlOpen] = useState(false)
  const [viewer, setViewer] = useState<number | null>(null)
  const [editing, setEditing] = useState<ProductImage | null>(null)
  const [versionOf, setVersionOf] = useState<ProductImage | null>(null)
  const [zipping, setZipping] = useState<string | null>(null)

  const key = ['product-images', product.id]
  const images = useQuery({ queryKey: key, queryFn: () => listProductImages(product.id) })
  const crops = useQuery({ queryKey: ['catalog-crops', product.id], queryFn: () => pendingCatalogCrops(product.id) })
  const thumbs = useQuery({
    queryKey: ['image-thumbs', product.id, images.data?.map((i) => i.id).join(',')],
    queryFn: () => signedImageUrls((images.data ?? []).map((i) => thumbOf(i.storage_path))),
    enabled: !!images.data?.length, staleTime: 50 * 60 * 1000,
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ['catalog-crops', product.id] })
    qc.invalidateQueries({ queryKey: ['gallery'] })
  }
  const fail = (e: Error) => toast(friendlyDbError(e), 'bad')

  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => { await fn() },
    onSuccess: refresh,
    onError: fail,
  })

  const importCrops = useMutation({
    mutationFn: async () => {
      let ok = 0
      const errors: string[] = []
      for (const c of crops.data ?? []) {
        try { await importCatalogCrop(product.id, c); ok++ } catch (e) { errors.push((e as Error).message) }
      }
      return { ok, errors }
    },
    onSuccess: ({ ok, errors }) => {
      refresh()
      if (ok) toast(`${ok} recorte(s) do catálogo adicionados para revisão.`)
      if (errors.length) toast(errors[0], 'bad')
    },
    onError: fail,
  })

  const addVersion = useMutation({
    mutationFn: async ({ parent, file }: { parent: ProductImage; file: File }) =>
      addImage({ productId: product.id, blob: file, fileName: file.name, kind: 'gerada_editada', rights: parent.rights,
        parentImageId: parent.id, source: 'manual', sourceRef: 'Versão tratada', rightsNotes: parent.rights_notes }),
    onSuccess: () => { refresh(); toast('Versão tratada adicionada. A original foi mantida.') },
    onError: fail,
  })

  const list = images.data ?? []
  const approved = list.filter((i) => i.status === 'aprovada')
  const indexOf = new Map(list.map((i, n) => [i.id, n + 1]))

  async function zip() {
    setZipping('0')
    try {
      await downloadZip(approved.map((i) => ({ ...i, sku: product.internal_sku ?? product.supplier_sku })),
        `${product.internal_sku ?? product.supplier_sku ?? 'produto'}_imagens`, (n) => setZipping(String(n)))
    } catch (e) { fail(e as Error) } finally { setZipping(null) }
  }

  function move(i: number, dir: -1 | 1) {
    const ids = moveInList(list.map((x) => x.id), i, dir)
    act.mutate(() => reorderImages(product.id, ids))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => fileRef.current?.click()}><Upload className="size-4" aria-hidden /> Enviar imagens</Button>
        <Button onClick={() => setUrlOpen(true)}><Link2 className="size-4" aria-hidden /> Adicionar por link</Button>
        {!!crops.data?.length && (
          <Button loading={importCrops.isPending} onClick={() => importCrops.mutate()}>
            <Layers className="size-4" aria-hidden /> Trazer {crops.data.length} recorte(s) do catálogo
          </Button>
        )}
        <Button className="ml-auto" disabled={!approved.length || zipping !== null} loading={zipping !== null} onClick={zip}
          title="Baixa as imagens aprovadas num arquivo .zip para usar no Canva">
          <Download className="size-4" aria-hidden />
          {zipping !== null ? `Preparando ${zipping}/${approved.length}…` : `Baixar aprovadas (${approved.length})`}
        </Button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
          onChange={(e) => { setPendingFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <input ref={versionRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f && versionOf) addVersion.mutate({ parent: versionOf, file: f })
          }} />
      </div>

      <div className="rounded-lg border border-line bg-surface">
        {images.isPending ? <Spinner /> : images.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(images.error)} onRetry={() => images.refetch()} /></div>
        ) : list.length === 0 ? (
          <EmptyState title="Nenhuma imagem" description="Envie fotos do produto, adicione por link ou traga os recortes aprovados nos catálogos. Os arquivos originais são guardados sem alteração." />
        ) : (
          <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.map((img, i) => {
              const thumb = thumbs.data?.get(thumbOf(img.storage_path))
              return (
                <li key={img.id} className="flex flex-col overflow-hidden rounded-md border border-line">
                  <button type="button" onClick={() => setViewer(i)} className="relative flex aspect-square items-center justify-center bg-sunk"
                    aria-label={`Ampliar imagem ${i + 1}`}>
                    {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-xs text-muted">…</span>}
                    <span className="tabular absolute top-1.5 left-1.5 rounded bg-ink/70 px-1.5 text-xs text-white">{i + 1}</span>
                    {img.is_main && <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs text-white">
                      <Star className="size-3 fill-current" aria-hidden /> Principal</span>}
                  </button>
                  <div className="flex flex-1 flex-col gap-1.5 p-2 text-xs">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[img.status]}>{STATUS_LABEL[img.status]}</Badge>
                      <Badge tone={RIGHTS_TONE[img.rights]}>{RIGHTS_LABEL[img.rights]}</Badge>
                    </div>
                    <span className="font-medium">{KIND_LABEL[img.kind]}</span>
                    {img.parent_image_id && <span className="text-muted">Versão da imagem {indexOf.get(img.parent_image_id) ?? '?'}</span>}
                    {img.source_ref && <span className="truncate text-muted" title={img.source_ref}>{img.source_ref}</span>}
                    <div className="mt-auto flex flex-wrap items-center gap-0.5 pt-1">
                      {img.status !== 'aprovada' && (
                        <Button size="sm" variant="ghost" className="px-1.5" title="Aprovar" aria-label="Aprovar"
                          onClick={() => act.mutate(() => updateImage(img.id, { status: 'aprovada' }))}><Check className="size-4 text-good" /></Button>
                      )}
                      {img.status !== 'rejeitada' && !img.is_main && (
                        <Button size="sm" variant="ghost" className="px-1.5" title="Rejeitar" aria-label="Rejeitar"
                          onClick={() => act.mutate(() => updateImage(img.id, { status: 'rejeitada' }))}><X className="size-4 text-bad" /></Button>
                      )}
                      {img.status === 'aprovada' && !img.is_main && img.rights !== 'nao_autorizada' && (
                        <Button size="sm" variant="ghost" className="px-1.5" title="Definir como principal" aria-label="Definir como principal"
                          onClick={() => act.mutate(() => setMainImage(img.id))}><Star className="size-4" /></Button>
                      )}
                      <Button size="sm" variant="ghost" className="px-1.5" title="Mover para trás" aria-label="Mover para trás"
                        disabled={i === 0} onClick={() => move(i, -1)}><ArrowLeft className="size-4" /></Button>
                      <Button size="sm" variant="ghost" className="px-1.5" title="Mover para frente" aria-label="Mover para frente"
                        disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowRight className="size-4" /></Button>
                      <Button size="sm" variant="ghost" className="px-1.5" title="Detalhes e direito de uso" aria-label="Detalhes"
                        onClick={() => setEditing(img)}><Pencil className="size-4" /></Button>
                      <Button size="sm" variant="ghost" className="px-1.5" title="Enviar versão tratada (a original é mantida)" aria-label="Enviar versão tratada"
                        onClick={() => { setVersionOf(img); versionRef.current?.click() }}><Layers className="size-4" /></Button>
                      {img.status !== 'aprovada' && (
                        <Button size="sm" variant="ghost" className="ml-auto px-1.5" title="Excluir" aria-label="Excluir"
                          onClick={() => confirm('Excluir esta imagem? O arquivo será apagado.') && act.mutate(() => deleteImage(img))}>
                          <Trash2 className="size-4" /></Button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted">
        A ordem aqui é a ordem sugerida para os anúncios. A imagem principal precisa estar aprovada e com uso permitido.
        Imagens aprovadas não podem ser excluídas — rejeite primeiro.
      </p>

      <UploadModal files={pendingFiles} productId={product.id} onClose={() => setPendingFiles([])} onDone={refresh} />
      <UrlModal open={urlOpen} productId={product.id} onClose={() => setUrlOpen(false)} onDone={refresh} />
      <ImageViewer images={list} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      <ImageEditModal image={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  )
}

function ClassifyFields({ kind, setKind, rights, setRights }: {
  kind: ImageKind; setKind: (k: ImageKind) => void; rights: ImageRights; setRights: (r: ImageRights) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Tipo" htmlFor="up_kind">
        <Select id="up_kind" value={kind} onChange={(e) => setKind(e.target.value as ImageKind)}>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Direito de uso" htmlFor="up_rights">
        <Select id="up_rights" value={rights} onChange={(e) => setRights(e.target.value as ImageRights)}>
          {Object.entries(RIGHTS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </Field>
    </div>
  )
}

function UploadModal({ files, productId, onClose, onDone }: { files: File[]; productId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [kind, setKind] = useState<ImageKind>('oficial')
  const [rights, setRights] = useState<ImageRights>('a_verificar')
  const [progress, setProgress] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  async function send() {
    setErrors([]); setProgress(0)
    const errs: string[] = []
    let ok = 0
    for (const [n, f] of files.entries()) {
      try { await addImage({ productId, blob: f, fileName: f.name, kind, rights }); ok++ } catch (e) { errs.push(friendlyDbError(e as Error)) }
      setProgress(n + 1)
    }
    setProgress(null)
    onDone()
    if (ok) toast(`${ok} imagem(ns) enviada(s) para revisão.`)
    if (errs.length) setErrors(errs)
    else onClose()
  }

  return (
    <Modal open={files.length > 0} onClose={() => progress === null && (setErrors([]), onClose())} title={`Enviar ${files.length} imagem(ns)`}
      footer={<>
        <Button onClick={() => { setErrors([]); onClose() }} disabled={progress !== null}>{errors.length ? 'Fechar' : 'Cancelar'}</Button>
        {!errors.length && <Button variant="primary" loading={progress !== null} onClick={send}>
          {progress !== null ? `Enviando ${progress}/${files.length}…` : 'Enviar'}</Button>}
      </>}>
      <div className="flex flex-col gap-3">
        {errors.length > 0 && <ErrorState message={errors.join(' · ')} />}
        <ClassifyFields kind={kind} setKind={setKind} rights={rights} setRights={setRights} />
        <ul className="max-h-40 overflow-y-auto text-xs text-muted">
          {files.map((f) => <li key={f.name + f.size}>{f.name} · {(f.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB</li>)}
        </ul>
        <p className="text-xs text-muted">JPG, PNG ou WebP até 15 MB. O arquivo é guardado como enviado; a miniatura é gerada à parte.</p>
      </div>
    </Modal>
  )
}

function UrlModal({ open, productId, onClose, onDone }: { open: boolean; productId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<ImageKind>('oficial')
  const [rights, setRights] = useState<ImageRights>('a_verificar')
  const [error, setError] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: async () => {
      const bad = checkImageUrl(url)
      if (bad) throw new Error(bad)
      const { blob, finalUrl } = await fetchImageFromUrl(url.trim())
      return addImage({ productId, blob, fileName: decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || 'imagem'),
        kind, rights, source: 'manual', sourceUrl: url.trim(), sourceRef: new URL(finalUrl).hostname })
    },
    onSuccess: () => { onDone(); toast('Imagem adicionada para revisão.'); setUrl(''); setError(null); onClose() },
    onError: (e: Error) => setError(friendlyDbError(e)),
  })
  return (
    <Modal open={open} onClose={onClose} title="Adicionar imagem por link"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>Adicionar</Button></>}>
      <div className="flex flex-col gap-3">
        {error && <ErrorState message={error} />}
        <Field label="Link da imagem" htmlFor="img_url" hint="Clique com o botão direito na foto → “Copiar endereço da imagem”.">
          <Input id="img_url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/foto.jpg" autoFocus />
        </Field>
        <ClassifyFields kind={kind} setKind={setKind} rights={rights} setRights={setRights} />
        <p className="text-xs text-muted">O link fica registrado como origem. Encontrar a imagem na internet não significa autorização de uso comercial.</p>
      </div>
    </Modal>
  )
}
