// Renderização do PDF no navegador (pdf.js): cada página vira JPEG; páginas
// duplas são divididas em duas. O PDF em si não é enviado ao servidor.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { renderScale, slicesFor, splitText, type PageSlice } from './pageModel'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type RenderedSlice = { side: PageSlice['side']; blob: Blob; thumb: Blob; width: number; height: number; text: string }

export async function openPdf(file: File) {
  const data = new Uint8Array(await file.arrayBuffer())
  return pdfjs.getDocument({ data }).promise
}

export async function firstPageIsSpread(doc: pdfjs.PDFDocumentProxy) {
  const page = await doc.getPage(1)
  const v = page.getViewport({ scale: 1 })
  return v.width / v.height > 1.2
}

async function thumbnail(source: HTMLCanvasElement, sx: number, sw: number, height = 320) {
  const t = document.createElement('canvas')
  t.height = height
  t.width = Math.round((sw / source.height) * height)
  t.getContext('2d')!.drawImage(source, sx, 0, sw, source.height, 0, 0, t.width, t.height)
  const b = await toJpeg(t, 0.75)
  t.width = t.height = 0
  return b
}

function toJpeg(canvas: HTMLCanvasElement, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem da página'))), 'image/jpeg', quality))
}

export type PlannedPage = { pdfPage: number; side: PageSlice['side']; pageNumber: number }

/**
 * Numeração das páginas do catálogo antes de renderizar (só lê o tamanho de cada página).
 * É determinística: permite retomar um envio interrompido sem duplicar páginas.
 */
export async function planPages(doc: pdfjs.PDFDocumentProxy, splitSpreads: boolean): Promise<PlannedPage[]> {
  const out: PlannedPage[] = []
  let n = 0
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const v = page.getViewport({ scale: 1 })
    for (const s of slicesFor(v.width, v.height, splitSpreads)) out.push({ pdfPage: p, side: s.side, pageNumber: ++n })
  }
  return out
}

export async function renderPdfPage(doc: pdfjs.PDFDocumentProxy, pageNumber: number, splitSpreads: boolean, targetHeight = 1500): Promise<RenderedSlice[]> {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: renderScale(base.height, targetHeight) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise

  const slices = slicesFor(canvas.width, canvas.height, splitSpreads)
  const content = await page.getTextContent()
  const items = content.items
    .filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i)
    .map((i) => ({ str: i.str, x: i.transform[4] }))
  const texts = splitText(items, base.width, slices)

  const out: RenderedSlice[] = []
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i]
    let blob: Blob
    if (slices.length === 1) blob = await toJpeg(canvas)
    else {
      const part = document.createElement('canvas')
      part.width = s.sw
      part.height = canvas.height
      part.getContext('2d')!.drawImage(canvas, s.sx, 0, s.sw, canvas.height, 0, 0, s.sw, canvas.height)
      blob = await toJpeg(part)
      part.width = part.height = 0
    }
    out.push({ side: s.side, blob, thumb: await thumbnail(canvas, s.sx, s.sw), width: s.sw, height: canvas.height, text: texts[i] })
  }
  canvas.width = canvas.height = 0
  page.cleanup()
  return out
}

/** SHA-256 do arquivo (impressão digital usada para não enviar o mesmo catálogo duas vezes). */
export async function fileSha256(file: File) {
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
