import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, Search, Star, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Spinner } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { friendlyDbError } from '@/lib/supabase'
import { downloadZip, listGallery, signedImageUrls, updateImages, type GalleryFilters, type GalleryImage } from './api'
import { ImageViewer } from './ImageDialogs'
import {
  KIND_LABEL, RIGHTS_LABEL, RIGHTS_TONE, STATUS_LABEL, STATUS_TONE, thumbOf, type ImageRights,
} from './imageModel'

const PAGE = 48

export function GalleryPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [filters, setFilters] = useState<GalleryFilters>({ status: 'aguardando_revisao' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Map<string, GalleryImage>>(new Map())
  const [viewer, setViewer] = useState<number | null>(null)
  const [zipping, setZipping] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => ({ ...f, search })); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const list = useQuery({ queryKey: ['gallery', filters, page], queryFn: () => listGallery(filters, page, PAGE), placeholderData: (p) => p })
  const rows = list.data?.rows ?? []
  const thumbs = useQuery({
    queryKey: ['gallery-thumbs', rows.map((r) => r.id).join(',')],
    queryFn: () => signedImageUrls(rows.map((r) => thumbOf(r.storage_path))),
    enabled: rows.length > 0, staleTime: 50 * 60 * 1000,
  })

  const bulk = useMutation({
    mutationFn: (patch: Parameters<typeof updateImages>[1]) => updateImages([...selected.keys()], patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gallery'] }); qc.invalidateQueries({ queryKey: ['product-images'] }); qc.invalidateQueries({ queryKey: ['product-thumbs'] }); setSelected(new Map()); toast('Imagens atualizadas.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  const set = (k: keyof GalleryFilters, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0) }
  const toggle = (img: GalleryImage) => setSelected((s) => {
    const n = new Map(s)
    if (n.has(img.id)) n.delete(img.id); else n.set(img.id, img)
    return n
  })
  const sel = [...selected.values()]
  const selectedMain = sel.some((i) => i.is_main)

  async function zip() {
    const approved = sel.filter((i) => i.status === 'aprovada')
    if (!approved.length) return toast('Selecione imagens aprovadas para baixar.', 'bad')
    setZipping('0')
    try {
      await downloadZip(approved.map((i) => ({ ...i, sku: i.product.internal_sku ?? i.product.supplier_sku })), 'imagens_dualshop',
        (n) => setZipping(String(n)))
    } catch (e) { toast(friendlyDbError(e as Error), 'bad') } finally { setZipping(null) }
  }

  return (
    <>
      <PageHeader title="Galeria de imagens"
        description="Todas as imagens dos produtos. Para enviar fotos, abra o produto → aba Imagens." />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
          <Input className="pl-8" placeholder="Produto, SKU ou código" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto" />
        </div>
        <Select className="w-40" aria-label="Situação" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">Todas as situações</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select className="w-44" aria-label="Tipo" value={filters.kind ?? ''} onChange={(e) => set('kind', e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select className="w-60" aria-label="Direito de uso" value={filters.rights ?? ''} onChange={(e) => set('rights', e.target.value)}>
          <option value="">Todos os direitos de uso</option>
          {Object.entries(RIGHTS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selecionada(s)</span>
          <Button size="sm" loading={bulk.isPending} onClick={() => bulk.mutate({ status: 'aprovada' })}><Check className="size-4" aria-hidden /> Aprovar</Button>
          <Button size="sm" disabled={selectedMain} title={selectedMain ? 'Há imagem principal na seleção' : undefined}
            onClick={() => bulk.mutate({ status: 'rejeitada' })}><X className="size-4" aria-hidden /> Rejeitar</Button>
          <Select className="h-8 w-52 text-[13px]" aria-label="Definir direito de uso" value=""
            onChange={(e) => e.target.value && bulk.mutate({ rights: e.target.value as ImageRights })}>
            <option value="">Definir direito de uso…</option>
            {Object.entries(RIGHTS_LABEL).filter(([k]) => !(selectedMain && k === 'nao_autorizada'))
              .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Button size="sm" loading={zipping !== null} onClick={zip}><Download className="size-4" aria-hidden />
            {zipping !== null ? `Preparando ${zipping}…` : 'Baixar aprovadas (.zip)'}</Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Map())}>Limpar seleção</Button>
        </div>
      )}

      <div className="rounded-lg border border-line bg-surface">
        {list.isPending ? <Spinner /> : list.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nenhuma imagem com estes filtros" description="As imagens entram pela aba Imagens de cada produto ou pelos recortes aprovados nos catálogos." />
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 lg:grid-cols-6">
              {rows.map((img, i) => {
                const thumb = thumbs.data?.get(thumbOf(img.storage_path))
                const name = img.product.commercial_name || img.product.nf_description
                return (
                  <li key={img.id} className={`flex flex-col overflow-hidden rounded-md border ${selected.has(img.id) ? 'border-accent ring-2 ring-accent/30' : 'border-line'}`}>
                    <div className="relative">
                      <button type="button" onClick={() => setViewer(i)} className="flex aspect-square w-full items-center justify-center bg-sunk" aria-label="Ampliar">
                        {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-xs text-muted">…</span>}
                      </button>
                      <input type="checkbox" className="absolute top-2 left-2 size-4 accent-[var(--color-accent)]" checked={selected.has(img.id)}
                        onChange={() => toggle(img)} aria-label="Selecionar imagem" />
                      {img.is_main && <Star className="absolute top-2 right-2 size-4 fill-accent text-accent" aria-label="Principal" />}
                    </div>
                    <div className="flex flex-col gap-1 p-2 text-xs">
                      <Link to={`/produtos/${img.product_id}?aba=imagens`} className="truncate font-medium hover:text-accent hover:underline" title={name ?? ''}>{name}</Link>
                      <span className="text-muted">{KIND_LABEL[img.kind]}</span>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[img.status]}>{STATUS_LABEL[img.status]}</Badge>
                        <Badge tone={RIGHTS_TONE[img.rights]}>{RIGHTS_LABEL[img.rights]}</Badge>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <Pagination page={page} pageSize={PAGE} total={list.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </div>
      <ImageViewer images={rows} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
    </>
  )
}
