import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, MousePointerSquareDashed, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, ErrorState, Field, Input, Spinner, Textarea, cn } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { parseBrDecimal } from '@/lib/domain/numbers'
import { isValidGtin } from '@/lib/domain/validators'
import { formatBRL } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { ProductPicker } from '@/modules/invoices/ProductPicker'
import {
  approveItem, deleteItem, getCatalog, getProductBasics, listItems, listPages, matchCode, saveItem, setItemStatus, signedUrls,
  type CatalogItem, type CatalogItemInput, type CatalogPage,
} from './api'
import { cropImage } from './cropImage'
import { adjustBBox, bboxFromPoints, cropPreviewStyle, divergences, findCodes, parseSize, type BBox } from './pageModel'

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'
type Drag = { kind: 'new'; ax: number; ay: number } | { kind: 'adjust'; handle: Handle; px: number; py: number; start: BBox }

type FormState = {
  code: string; ean: string; name: string; size: string; weight_g: string; material: string; capacity_text: string
  size_label: string; color_code: string; box_qty: string; suggested_price: string; features: string; description: string
}
const EMPTY_FORM: FormState = { code: '', ean: '', name: '', size: '', weight_g: '', material: '', capacity_text: '', size_label: '',
  color_code: '', box_qty: '', suggested_price: '', features: '', description: '' }

const cm = (mm: number | null) => (mm == null ? '' : String(Number(mm) / 10).replace('.', ','))
function itemToForm(it: CatalogItem): FormState {
  const dims = [it.height_mm, it.width_mm, it.depth_mm].filter((v) => v != null).map(cm)
  return {
    code: it.code ?? '', ean: it.ean ?? '', name: it.name ?? '', size: dims.length ? `${dims.join(' × ')} cm` : '',
    weight_g: it.weight_g != null ? String(it.weight_g).replace('.', ',') : '', material: it.material ?? '',
    capacity_text: it.capacity_text ?? '', size_label: it.size_label ?? '', color_code: it.color_code ?? '',
    box_qty: it.box_qty != null ? String(it.box_qty) : '', suggested_price: it.suggested_price != null ? String(it.suggested_price).replace('.', ',') : '',
    features: (it.features ?? []).join('; '), description: it.description ?? '',
  }
}

function formToInput(f: FormState): { input: Omit<CatalogItemInput, 'catalog_id' | 'page_id'>; error: string | null } {
  const code = f.code.trim().toUpperCase()
  if (!code && !f.name.trim()) return { input: {}, error: 'Informe o código ou o nome do produto.' }
  if (f.ean.trim() && !isValidGtin(f.ean.trim())) return { input: {}, error: 'EAN inválido.' }
  const size = f.size.trim() ? parseSize(f.size) : null
  if (f.size.trim() && !size) return { input: {}, error: 'Medidas: use o formato 41 × 31 × 15 cm.' }
  let weight: number | null = null, price: number | null = null, box: number | null = null
  try {
    weight = parseBrDecimal(f.weight_g)?.toNumber() ?? null
    price = parseBrDecimal(f.suggested_price)?.toNumber() ?? null
    box = f.box_qty.trim() ? Number(f.box_qty.trim()) : null
    if (box !== null && (!Number.isInteger(box) || box <= 0)) throw new Error()
  } catch { return { input: {}, error: 'Peso, preço ou quantidade por caixa inválidos.' } }
  return {
    error: null,
    input: {
      code: code || null, ean: f.ean.trim() || null, name: f.name.trim() || null, description: f.description.trim() || null,
      height_mm: size?.height_mm ?? null, width_mm: size?.width_mm ?? null, depth_mm: size?.depth_mm ?? null,
      weight_g: weight, material: f.material.trim() || null, capacity_text: f.capacity_text.trim() || null,
      size_label: f.size_label.trim() || null, color_code: f.color_code.trim() || null, box_qty: box, suggested_price: price,
      features: f.features.split(/[;\n]/).map((s) => s.trim()).filter(Boolean),
    },
  }
}

export function PageReviewPage() {
  const { id, n } = useParams()
  const pageNumber = Number(n)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const catalog = useQuery({ queryKey: ['catalog', id], queryFn: () => getCatalog(id!) })
  const pages = useQuery({ queryKey: ['catalog-pages', id], queryFn: () => listPages(id!) })
  const page: CatalogPage | undefined = pages.data?.find((p) => p.page_number === pageNumber)
  const items = useQuery({ queryKey: ['catalog-items', id, page?.id], queryFn: () => listItems(id!, page!.id), enabled: !!page })
  const image = useQuery({
    queryKey: ['catalog-page-url', page?.image_path],
    queryFn: async () => (await signedUrls([page!.image_path])).get(page!.image_path) ?? null,
    enabled: !!page, staleTime: 50 * 60 * 1000,
  })

  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [bbox, setBbox] = useState<BBox | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [drawMode, setDrawMode] = useState(true)
  const drag = useRef<Drag | null>(null)
  const [draft, setDraft] = useState<BBox | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)

  const selected = selectedId && selectedId !== 'new' ? items.data?.find((i) => i.id === selectedId) ?? null : null
  const readOnly = selected?.status === 'aprovado'

  // Troca de página: limpa a seleção
  useEffect(() => { setSelectedId(null); setBbox(null); setForm(EMPTY_FORM); setFormError(null) }, [pageNumber])

  const select = useCallback((it: CatalogItem | null) => {
    setFormError(null)
    if (!it) { setSelectedId(null); setBbox(null); setForm(EMPTY_FORM); return }
    setSelectedId(it.id); setBbox(it.bbox); setForm(itemToForm(it))
  }, [])

  const go = useCallback((delta: number) => {
    const total = catalog.data?.page_count ?? 0
    const next = pageNumber + delta
    if (next >= 1 && next <= total) navigate(`/catalogos/${id}/paginas/${next}`)
  }, [catalog.data?.page_count, pageNumber, id, navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'Escape') select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, select])

  // ---------------- desenho e ajuste do retângulo ----------------
  const point = (e: RPointerEvent) => {
    const r = areaRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  function onAreaDown(e: RPointerEvent) {
    if (!drawMode || readOnly || e.button !== 0) return
    const p = point(e)
    drag.current = { kind: 'new', ax: p.x, ay: p.y }
    areaRef.current!.setPointerCapture(e.pointerId)
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  function onHandleDown(e: RPointerEvent, handle: Handle) {
    if (readOnly || !bbox) return
    e.stopPropagation()
    const p = point(e)
    drag.current = { kind: 'adjust', handle, px: p.x, py: p.y, start: bbox }
    areaRef.current!.setPointerCapture(e.pointerId)
  }
  function onAreaMove(e: RPointerEvent) {
    const d = drag.current
    if (!d) return
    const p = point(e)
    if (d.kind === 'new') setDraft(bboxFromPoints(d.ax, d.ay, p.x, p.y))
    else setBbox(adjustBBox(d.start, d.handle, p.x - d.px, p.y - d.py))
  }
  function onAreaUp(e: RPointerEvent) {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'new') {
      const p = point(e)
      const b = bboxFromPoints(d.ax, d.ay, p.x, p.y)
      setDraft(null)
      if (b.w < 0.02 || b.h < 0.02) return
      if (selectedId && selectedId !== 'new' && !readOnly) { setBbox(b); return }  // redesenha a foto do item selecionado
      setSelectedId('new'); setBbox(b); setFormError(null)
      // Sugestão: se houver só um código livre no texto da página, já preenche
      const used = new Set((items.data ?? []).map((i) => (i.code ?? '').toUpperCase()))
      const free = findCodes(page?.text_content ?? '').filter((c) => !used.has(c))
      setForm({ ...EMPTY_FORM, code: free.length === 1 ? free[0] : '' })
    }
  }

  // ---------------- gravação ----------------
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['catalog-items', id] })
    qc.invalidateQueries({ queryKey: ['catalog', id] })
    qc.invalidateQueries({ queryKey: ['catalogs'] })
  }
  const save = useMutation({
    mutationFn: async () => {
      const { input, error } = formToInput(form)
      if (error) throw new Error(error)
      return saveItem({ ...input, bbox, catalog_id: id!, page_id: page!.id }, selectedId !== 'new' ? selectedId! : undefined)
    },
    onSuccess: (it) => { invalidate(); select(it); toast('Produto salvo nesta página.') },
    onError: (e: Error) => setFormError(friendlyDbError(e)),
  })
  const reject = useMutation({
    mutationFn: (it: CatalogItem) => setItemStatus(it.id, it.status === 'rejeitado' ? 'aguardando_revisao' : 'rejeitado'),
    onSuccess: () => { invalidate(); toast('Situação atualizada.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })
  const remove = useMutation({
    mutationFn: (it: CatalogItem) => deleteItem(it.id),
    onSuccess: () => { invalidate(); select(null); toast('Marcação removida.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  if (catalog.isPending || pages.isPending) return <Spinner />
  if (catalog.isError || pages.isError) return <ErrorState message={friendlyDbError((catalog.error ?? pages.error) as Error)} />
  if (!catalog.data || !page) return <ErrorState message="Página não encontrada." />

  const total = catalog.data.page_count
  const shownItems = items.data ?? []
  const activeBox = draft ?? null

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link to={`/catalogos/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
          <ArrowLeft className="size-4" aria-hidden /> {catalog.data.name}
        </Link>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pageNumber <= 1} onClick={() => go(-1)} aria-label="Página anterior"><ChevronLeft className="size-4" /></Button>
          <span className="tabular text-sm">Página {pageNumber} de {total} <span className="text-muted">· PDF {page.pdf_page}{page.side === 'L' ? ' esq.' : page.side === 'R' ? ' dir.' : ''}</span></span>
          <Button size="sm" disabled={pageNumber >= total} onClick={() => go(1)} aria-label="Próxima página"><ChevronRight className="size-4" /></Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Página */}
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-accent" checked={drawMode} onChange={(e) => setDrawMode(e.target.checked)} />
              <MousePointerSquareDashed className="size-4 text-accent" aria-hidden /> Arraste sobre a foto para marcar um produto
            </label>
            <span className="text-xs text-muted">← → troca de página · Esc limpa a seleção</span>
          </div>
          {image.isPending ? <Spinner label="Carregando a página…" /> : !image.data ? <ErrorState message="Não foi possível carregar a imagem da página." /> : (
            <div className="mx-auto" style={{ maxWidth: `min(100%, calc((100vh - 180px) * ${page.width / page.height}))` }}>
              <div
                ref={areaRef}
                className={cn('relative w-full touch-none select-none', drawMode && !readOnly && 'cursor-crosshair')}
                style={{ aspectRatio: `${page.width} / ${page.height}` }}
                onPointerDown={onAreaDown} onPointerMove={onAreaMove} onPointerUp={onAreaUp}
              >
                <img src={image.data} alt={`Página ${pageNumber}`} className="pointer-events-none absolute inset-0 h-full w-full" draggable={false} />
                {shownItems.filter((it) => it.bbox && it.id !== selectedId).map((it) => (
                  <button key={it.id} type="button" title={it.code ?? it.name ?? ''}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => select(it)}
                    className={cn('absolute border-2 text-left',
                      it.status === 'aprovado' ? 'border-good/80 bg-good/5' : it.status === 'rejeitado' ? 'border-bad/50 bg-bad/5' : 'border-warn bg-warn/5')}
                    style={boxStyle(it.bbox!)}>
                    <span className={cn('absolute -top-5 left-0 rounded px-1 text-[11px] font-medium text-white',
                      it.status === 'aprovado' ? 'bg-good' : it.status === 'rejeitado' ? 'bg-bad' : 'bg-warn')}>{it.code ?? it.name}</span>
                  </button>
                ))}
                {bbox && selectedId && (
                  <div className="absolute border-2 border-accent bg-accent/10" style={boxStyle(bbox)}
                    onPointerDown={(e) => onHandleDown(e, 'move')}>
                    {!readOnly && (['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                      <span key={h} onPointerDown={(e) => onHandleDown(e, h)}
                        className={cn('absolute size-3 rounded-sm border border-white bg-accent',
                          h === 'nw' && '-top-1.5 -left-1.5 cursor-nwse-resize', h === 'ne' && '-top-1.5 -right-1.5 cursor-nesw-resize',
                          h === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize', h === 'se' && '-right-1.5 -bottom-1.5 cursor-nwse-resize')} />
                    ))}
                  </div>
                )}
                {activeBox && <div className="absolute border-2 border-dashed border-accent" style={boxStyle(activeBox)} />}
              </div>
            </div>
          )}
          {page.text_content && <p className="mt-2 text-xs text-muted">Texto da página: {page.text_content}</p>}
        </div>

        {/* Painel lateral */}
        <div className="flex flex-col gap-3 xl:sticky xl:top-0 xl:self-start">
          <div className="rounded-lg border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-sm font-semibold">Produtos nesta página</h2>
              <span className="text-xs text-muted">{shownItems.length}</span>
            </div>
            {shownItems.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">Nenhum produto marcado. Arraste sobre a foto de um produto para começar.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto">
                {shownItems.map((it) => (
                  <li key={it.id}>
                    <button onClick={() => select(it)}
                      className={cn('flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-sunk', selectedId === it.id && 'bg-accent-soft')}>
                      <span className="truncate"><span className="font-mono text-xs">{it.code ?? '—'}</span> {it.name}</span>
                      <Badge tone={it.status === 'aprovado' ? 'good' : it.status === 'rejeitado' ? 'bad' : 'warn'}>
                        {it.status === 'aprovado' ? 'Aprovado' : it.status === 'rejeitado' ? 'Rejeitado' : 'A revisar'}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedId && (
            <ItemPanel
              key={selectedId}
              isNew={selectedId === 'new'}
              item={selected}
              form={form}
              setForm={setForm}
              bbox={bbox}
              imageUrl={image.data ?? null}
              formError={formError}
              saving={save.isPending}
              onSave={() => save.mutate()}
              onCancel={() => select(null)}
              onReject={() => selected && reject.mutate(selected)}
              onDelete={() => selected && confirm('Remover esta marcação?') && remove.mutate(selected)}
              onApproved={() => { invalidate(); qc.invalidateQueries({ queryKey: ['products'] }) }}
            />
          )}
        </div>
      </div>
    </>
  )
}

function boxStyle(b: BBox) {
  return { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }
}

// ---------------------------------------------------------------------
// Formulário e aprovação do item
// ---------------------------------------------------------------------
function ItemPanel({
  isNew, item, form, setForm, bbox, imageUrl, formError, saving, onSave, onCancel, onReject, onDelete, onApproved,
}: {
  isNew: boolean
  item: CatalogItem | null
  form: FormState
  setForm: (f: FormState) => void
  bbox: BBox | null
  imageUrl: string | null
  formError: string | null
  saving: boolean
  onSave: () => void
  onCancel: () => void
  onReject: () => void
  onDelete: () => void
  onApproved: () => void
}) {
  const toast = useToast()
  const approved = item?.status === 'aprovado'
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const dirty = !item || JSON.stringify(itemToForm(item)) !== JSON.stringify(form) || JSON.stringify(item.bbox) !== JSON.stringify(bbox)

  const [target, setTarget] = useState<{ id: string; name: string } | null>(null)
  const [picker, setPicker] = useState(false)
  const [useCatalog, setUseCatalog] = useState<Set<string>>(new Set())

  const matches = useQuery({
    queryKey: ['catalog-match', item?.code, item?.ean],
    queryFn: () => matchCode(item!.code ?? '', item!.ean),
    enabled: !!item && !approved && (!!item.code || !!item.ean),
  })
  useEffect(() => {
    if (!target && matches.data?.length === 1) setTarget({ id: matches.data[0].product_id, name: matches.data[0].name })
  }, [matches.data, target])

  const product = useQuery({ queryKey: ['product-basics', target?.id], queryFn: () => getProductBasics(target!.id), enabled: !!target })
  const divs = product.data && item ? divergences(product.data, item) : []

  const approve = useMutation({
    mutationFn: async () => {
      if (!item || !target) throw new Error('Escolha o produto do cadastro.')
      const crop = item.bbox && imageUrl ? await cropImage(imageUrl, item.bbox) : null
      return approveItem(item, target.id, [...useCatalog], crop)
    },
    onSuccess: (r) => {
      onApproved()
      toast('Aprovado. Dados aplicados no produto (somente campos vazios e as substituições escolhidas); o recorte foi para a galeria do produto.')
      if (r.galleryWarning) toast(r.galleryWarning, 'bad')
    },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{isNew ? 'Novo produto marcado' : approved ? 'Produto aprovado' : 'Revisar produto'}</h2>
        <button onClick={onCancel} className="rounded p-1 text-muted hover:bg-sunk" aria-label="Fechar"><X className="size-4" /></button>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {bbox && imageUrl && (
          <div className="mx-auto w-40 rounded border border-line bg-white" style={cropPreviewStyle(bbox, imageUrl)} role="img" aria-label="Recorte da foto" />
        )}
        {!bbox && <p className="text-xs text-warn">Sem foto marcada. Arraste sobre a foto do produto na página.</p>}

        {formError && <ErrorState message={formError} />}
        <fieldset disabled={approved} className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Código" htmlFor="ci_code"><Input id="ci_code" className="font-mono uppercase" value={form.code} onChange={set('code')} /></Field>
            <Field label="EAN" htmlFor="ci_ean"><Input id="ci_ean" className="font-mono" inputMode="numeric" value={form.ean} onChange={set('ean')} /></Field>
          </div>
          <Field label="Nome" htmlFor="ci_name"><Input id="ci_name" value={form.name} onChange={set('name')} placeholder="Ex.: Mochila Cinnamoroll 16" /></Field>
          <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
            <Field label="Medidas (A × L × P)" htmlFor="ci_size" hint="Como no catálogo: 41×31×15cm">
              <Input id="ci_size" value={form.size} onChange={set('size')} />
            </Field>
            <Field label="Peso (g)" htmlFor="ci_w"><Input id="ci_w" inputMode="decimal" value={form.weight_g} onChange={set('weight_g')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Material" htmlFor="ci_mat"><Input id="ci_mat" value={form.material} onChange={set('material')} /></Field>
            <Field label="Tamanho" htmlFor="ci_sz" hint='Ex.: 16"'><Input id="ci_sz" value={form.size_label} onChange={set('size_label')} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Preço sugerido" htmlFor="ci_price"><Input id="ci_price" inputMode="decimal" value={form.suggested_price} onChange={set('suggested_price')} /></Field>
            <Field label="Qtd. caixa" htmlFor="ci_box"><Input id="ci_box" inputMode="numeric" value={form.box_qty} onChange={set('box_qty')} /></Field>
            <Field label="Cor" htmlFor="ci_color"><Input id="ci_color" value={form.color_code} onChange={set('color_code')} /></Field>
          </div>
          <Field label="Capacidade" htmlFor="ci_cap"><Input id="ci_cap" value={form.capacity_text} onChange={set('capacity_text')} /></Field>
          <Field label="Destaques" htmlFor="ci_feat" hint="Separe com ponto e vírgula: chaveiro de pelúcia; paetê mágico">
            <Textarea id="ci_feat" className="min-h-14" value={form.features} onChange={set('features')} />
          </Field>
        </fieldset>

        {!approved && (
          <div className="flex flex-wrap gap-2">
            <Button variant={dirty ? 'primary' : 'secondary'} loading={saving} disabled={!dirty} onClick={onSave}>{isNew ? 'Salvar marcação' : 'Salvar alterações'}</Button>
            {item && <Button onClick={onReject}>{item.status === 'rejeitado' ? 'Voltar para revisão' : 'Rejeitar'}</Button>}
            {item && <Button variant="ghost" onClick={onDelete} aria-label="Remover marcação"><Trash2 className="size-4" /></Button>}
          </div>
        )}

        {/* Aprovação */}
        {item && !approved && item.status !== 'rejeitado' && (
          <div className="mt-1 flex flex-col gap-2 border-t border-line pt-3">
            <h3 className="text-[13px] font-semibold">Aplicar no cadastro</h3>
            {dirty && <p className="text-xs text-warn">Salve as alterações antes de aprovar.</p>}
            {matches.isPending && (item.code || item.ean) ? <Spinner label="Procurando o produto…" /> : (
              <>
                {(matches.data ?? []).length > 0 && (
                  <div className="flex flex-col gap-1">
                    {matches.data!.map((m) => (
                      <label key={m.product_id} className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm',
                        target?.id === m.product_id ? 'border-accent bg-accent-soft' : 'border-line')}>
                        <input type="radio" name="target" className="mt-1 accent-accent" checked={target?.id === m.product_id}
                          onChange={() => { setTarget({ id: m.product_id, name: m.name }); setUseCatalog(new Set()) }} />
                        <span><span className="font-medium">{m.name}</span>
                          <span className="block font-mono text-xs text-muted">{m.supplier_sku}</span>
                          <span className="block text-xs text-muted">{m.match_reason}</span></span>
                      </label>
                    ))}
                  </div>
                )}
                {matches.data?.length === 0 && <p className="text-xs text-muted">Nenhum produto do cadastro com este código. Busque manualmente ou importe a nota de compra primeiro.</p>}
                {target && !matches.data?.some((m) => m.product_id === target.id) && (
                  <p className="text-sm">Produto escolhido: <strong>{target.name}</strong></p>
                )}
                <Button size="sm" variant="ghost" className="self-start" onClick={() => setPicker(true)}>Buscar outro produto…</Button>
              </>
            )}

            {divs.length > 0 && (
              <div className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                <p className="mb-1 font-medium">O produto já tem valores diferentes do catálogo. Marque os que devem ser substituídos:</p>
                {divs.map((d) => (
                  <label key={d.field} className="flex items-center gap-2 py-0.5 text-ink">
                    <input type="checkbox" className="accent-accent" checked={useCatalog.has(d.field)}
                      onChange={(e) => setUseCatalog((s) => { const n = new Set(s); if (e.target.checked) n.add(d.field); else n.delete(d.field); return n })} />
                    {d.label}: atual <strong>{d.current}</strong> → catálogo <strong>{d.catalog}</strong>
                  </label>
                ))}
              </div>
            )}
            {item.suggested_price != null && <p className="text-xs text-muted">O preço sugerido ({formatBRL(item.suggested_price)}) fica como atributo de referência para a precificação.</p>}
            <Button variant="primary" disabled={!target || dirty} loading={approve.isPending} onClick={() => approve.mutate()}>
              <Check className="size-4" aria-hidden /> Aprovar e aplicar no produto
            </Button>
          </div>
        )}
        {approved && <p className="text-sm text-good">Aprovado e aplicado no produto. <Link to={`/produtos/${item!.product_id}`} className="underline">Abrir produto</Link></p>}
      </div>

      <ProductPicker open={picker} onClose={() => setPicker(false)} reasonRequired={false} confirmLabel="Escolher" title="Escolher produto" itemPrefix="Item do catálogo"
        itemLabel={`${item?.code ?? ''} ${item?.name ?? ''}`}
        onPick={(p) => { if (p) { setTarget(p); setUseCatalog(new Set()) } setPicker(false) }} />
    </div>
  )
}
