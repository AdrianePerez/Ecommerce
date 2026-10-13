import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileUp } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, ErrorState, Field, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { friendlyDbError } from '@/lib/supabase'
import { listSuppliers } from '@/modules/settings/api'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { createCatalog, findCatalogBySha, listUploadedPageNumbers, updateCatalog, upsertPage, uploadPageImage, type Catalog } from './api'
import { pagePath, thumbPath } from './pageModel'

type Prepared = { file: File; doc: PDFDocumentProxy; sha: string; spread: boolean; existing: Catalog | null }

export function UploadCatalogPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers() })

  const [supplierId, setSupplierId] = useState('')
  const [brand, setBrand] = useState('')
  const [name, setName] = useState('')
  const [year, setYear] = useState('')
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [split, setSplit] = useState(true)

  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string } | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => () => { cancelRef.current = true }, [])

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setPrepared(null)
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return setError('Selecione um arquivo PDF.')
    setReading(true)
    try {
      const { openPdf, firstPageIsSpread, fileSha256 } = await import('./pdfRender')
      const [doc, sha] = await Promise.all([openPdf(file), fileSha256(file)])
      const spread = await firstPageIsSpread(doc)
      const existing = await findCatalogBySha(sha)
      if (existing && existing.status !== 'enviando') {
        setError(`Este PDF já foi enviado como "${existing.name}".`)
        setPrepared({ file, doc, sha, spread, existing })
        return
      }
      if (existing) {
        // envio interrompido: retoma com os mesmos dados
        setSupplierId(existing.supplier_id ?? ''); setBrand(existing.brand ?? ''); setName(existing.name)
        setYear(existing.collection_year ? String(existing.collection_year) : ''); setReceivedAt(existing.received_at ?? '')
        setNotes(existing.notes ?? ''); setSplit(existing.split_spreads)
      } else {
        setSplit(spread)
        if (!name) setName(file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim())
        const y = file.name.match(/20\d{2}/)?.[0]
        if (y && !year) setYear(y)
      }
      setPrepared({ file, doc, sha, spread, existing })
    } catch (e) {
      setError(`Não foi possível ler o PDF: ${(e as Error).message}`)
    } finally {
      setReading(false)
    }
  }

  function onSupplier(id: string) {
    setSupplierId(id)
    const trade = suppliers.data?.find((s) => s.id === id)?.trade_name
    if (trade && !brand) setBrand(trade)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!prepared) return setError('Selecione o PDF do catálogo.')
    if (prepared.existing && prepared.existing.status !== 'enviando') return
    if (!name.trim()) return setError('Informe o nome da coleção.')
    if (year && !/^\d{4}$/.test(year)) return setError('Ano inválido.')
    setError(null)
    cancelRef.current = false

    try {
      const { planPages, renderPdfPage } = await import('./pdfRender')
      const catalog = prepared.existing ?? await createCatalog({
        supplier_id: supplierId || null, brand: brand.trim() || null, name: name.trim(),
        collection_year: year ? Number(year) : null, received_at: receivedAt || null, notes: notes.trim() || null,
        file_name: prepared.file.name, file_size: prepared.file.size, file_sha256: prepared.sha,
        pdf_page_count: prepared.doc.numPages, split_spreads: split,
      })
      setProgress({ done: 0, total: 0, stage: 'Preparando as páginas…' })
      const plan = await planPages(prepared.doc, catalog.split_spreads)
      const uploaded = await listUploadedPageNumbers(catalog.id)
      await updateCatalog(catalog.id, { page_count: plan.length })

      const pdfPages = [...new Set(plan.map((p) => p.pdfPage))]
      let done = uploaded.size
      setProgress({ done, total: plan.length, stage: 'Gerando e enviando as páginas…' })
      const inFlight = new Set<Promise<void>>()

      for (const pdfPage of pdfPages) {
        if (cancelRef.current) throw new Error('Envio interrompido. Você pode retomar selecionando o mesmo PDF.')
        const targets = plan.filter((p) => p.pdfPage === pdfPage)
        if (targets.every((t) => uploaded.has(t.pageNumber))) continue
        const slices = await renderPdfPage(prepared.doc, pdfPage, catalog.split_spreads)
        const task = (async () => {
          for (const t of targets) {
            if (uploaded.has(t.pageNumber)) continue
            const s = slices.find((x) => x.side === t.side) ?? slices[0]
            const path = pagePath(catalog.id, t.pageNumber)
            await uploadPageImage(path, s.blob)
            await uploadPageImage(thumbPath(path), s.thumb)
            await upsertPage({ catalog_id: catalog.id, page_number: t.pageNumber, pdf_page: pdfPage, side: t.side,
              image_path: path, width: s.width, height: s.height, text_content: s.text || null })
            done++
            setProgress({ done, total: plan.length, stage: 'Gerando e enviando as páginas…' })
          }
        })()
        inFlight.add(task)
        task.finally(() => inFlight.delete(task)).catch(() => {})
        if (inFlight.size >= 3) await Promise.race(inFlight)
      }
      await Promise.all(inFlight)
      await updateCatalog(catalog.id, { pages_uploaded: plan.length, status: 'aguardando_processamento', status_message: null })
      qc.invalidateQueries({ queryKey: ['catalogs'] })
      toast(`Catálogo enviado: ${plan.length} páginas.`)
      navigate(`/catalogos/${catalog.id}`)
    } catch (e) {
      setProgress(null)
      setError(friendlyDbError(e as Error))
      qc.invalidateQueries({ queryKey: ['catalogs'] })
    }
  }

  const busy = !!progress
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <>
      <Link to="/catalogos" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="size-4" aria-hidden /> Catálogos e coleções
      </Link>
      <PageHeader title="Enviar catálogo" description="O PDF é lido no seu navegador. Cada página vira uma imagem para leitura e revisão; o PDF em si não é guardado." />

      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Arquivo">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line px-4 py-8 text-center hover:border-accent">
            <FileUp className="size-7 text-accent" aria-hidden />
            <span className="font-medium">{prepared ? prepared.file.name : 'Selecione o PDF do catálogo'}</span>
            <span className="text-sm text-muted">
              {reading ? 'Lendo o PDF…' : prepared
                ? `${prepared.doc.numPages} páginas no PDF · ${(prepared.file.size / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
                : 'Arquivos grandes são aceitos: o PDF não é enviado, só as imagens das páginas.'}
            </span>
            <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy}
              onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {prepared?.existing?.status === 'enviando' && (
            <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
              Este PDF tem um envio interrompido. Ao continuar, só as páginas que faltam serão enviadas.
            </p>
          )}
          {prepared?.existing && prepared.existing.status !== 'enviando' && (
            <Button type="button" className="mt-3" onClick={() => navigate(`/catalogos/${prepared.existing!.id}`)}>Abrir o catálogo já enviado</Button>
          )}
          {error && <div className="mt-3"><ErrorState message={error} /></div>}

          {progress && (
            <div className="mt-4" role="status">
              <div className="mb-1 flex justify-between text-sm"><span>{progress.stage}</span><span className="tabular">{progress.done} / {progress.total || '…'}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-sunk"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
              <p className="mt-2 text-xs text-muted">Mantenha esta página aberta até terminar. Se fechar, selecione o mesmo PDF para continuar de onde parou.</p>
              <Button type="button" size="sm" className="mt-2" onClick={() => { cancelRef.current = true }}>Interromper</Button>
            </div>
          )}
        </Card>

        <Card title="Dados do catálogo">
          <div className="flex flex-col gap-3">
            <Field label="Fornecedor" htmlFor="cat_sup">
              <Select id="cat_sup" value={supplierId} disabled={busy || !!prepared?.existing} onChange={(e) => onSupplier(e.target.value)}>
                <option value="">—</option>
                {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Marca" htmlFor="cat_brand"><Input id="cat_brand" value={brand} disabled={busy || !!prepared?.existing} onChange={(e) => setBrand(e.target.value)} /></Field>
            <Field label="Nome da coleção" htmlFor="cat_name"><Input id="cat_name" value={name} disabled={busy || !!prepared?.existing} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Ano" htmlFor="cat_year"><Input id="cat_year" inputMode="numeric" maxLength={4} value={year} disabled={busy || !!prepared?.existing} onChange={(e) => setYear(e.target.value)} /></Field>
              <Field label="Recebido em" htmlFor="cat_recv"><Input id="cat_recv" type="date" value={receivedAt} disabled={busy || !!prepared?.existing} onChange={(e) => setReceivedAt(e.target.value)} /></Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-accent" checked={split} disabled={busy || !!prepared?.existing} onChange={(e) => setSplit(e.target.checked)} />
              <span>Dividir páginas duplas em duas{prepared?.spread ? <span className="block text-xs text-muted">Este PDF tem páginas duplas (lado a lado).</span> : null}</span>
            </label>
            <Field label="Observações" htmlFor="cat_notes"><Textarea id="cat_notes" value={notes} disabled={busy || !!prepared?.existing} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Button type="submit" variant="primary" loading={busy} disabled={!prepared || reading || (!!prepared.existing && prepared.existing.status !== 'enviando')}>
              {prepared?.existing?.status === 'enviando' ? 'Continuar envio' : 'Enviar catálogo'}
            </Button>
          </div>
        </Card>
      </form>
    </>
  )
}
