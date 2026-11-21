import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, ErrorState, Spinner } from '@/components/ui'
import { ean13Modules, normalizeEan13 } from '@/lib/barcode/ean13'
import { friendlyDbError } from '@/lib/supabase'
import { LABELS_PER_SHEET, labelProducts, loadJob, type LabelProduct } from './api'

/** Folha 10×15 cm com 6 etiquetas (2 colunas × 3 linhas de 50×50 mm). Aberta numa aba própria para imprimir. */
export function LabelsPrintPage() {
  const [params] = useSearchParams()
  const job = loadJob(params.get('job') ?? '')
  const ids = job?.items.map((i) => i.id) ?? []
  const products = useQuery({ queryKey: ['label-products', ids.join(',')], queryFn: () => labelProducts(ids), enabled: ids.length > 0 })
  const [imagesReady, setImagesReady] = useState(false)

  const byId = new Map((products.data ?? []).map((p) => [p.id, p]))
  const cells: (LabelProduct | null)[] = Array(job?.skip ?? 0).fill(null)
  for (const it of job?.items ?? []) { const p = byId.get(it.id); if (p) for (let i = 0; i < it.qty; i++) cells.push(p) }
  const sheets: (LabelProduct | null)[][] = []
  for (let i = 0; i < cells.length; i += LABELS_PER_SHEET) sheets.push(cells.slice(i, i + LABELS_PER_SHEET))

  // espera as fotos carregarem antes de liberar a impressão
  useEffect(() => {
    if (!products.data) return
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.label-sheet img')]
    Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r })))).then(() => setImagesReady(true))
  }, [products.data])

  if (!job) return <div className="p-8"><ErrorState message="Etiquetas não encontradas. Volte à lista de produtos e gere de novo." /></div>
  if (products.isPending) return <Spinner label="Montando etiquetas…" />
  if (products.isError) return <div className="p-8"><ErrorState message={friendlyDbError(products.error)} /></div>

  return (
    <div className="min-h-screen bg-sunk">
      <style>{`
        @page { size: 100mm 150mm; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .label-sheets { padding: 0 !important; gap: 0 !important; }
          .label-sheet { box-shadow: none !important; }
        }
        .label-sheet { width: 100mm; height: 150mm; display: grid; grid-template-columns: 50mm 50mm; grid-template-rows: repeat(3, 50mm);
          background: #fff; color: #000; break-after: page; overflow: hidden; font-family: Arial, Helvetica, sans-serif; }
        .label-sheet:last-child { break-after: auto; }
        .label-cell { box-sizing: border-box; padding: 2.5mm; display: flex; flex-direction: column; gap: 1mm; outline: 0.1mm dashed #bbb; outline-offset: -0.05mm; overflow: hidden; }
      `}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3 text-sm">
        <strong>{cells.length - (job.skip ?? 0)} etiquetas · {sheets.length} {sheets.length === 1 ? 'folha' : 'folhas'} 10×15</strong>
        <span className="text-muted">Na impressão: papel <strong className="text-ink">100 × 150 mm</strong>, margens <strong className="text-ink">nenhuma</strong>, escala <strong className="text-ink">100%</strong> (sem "ajustar à página").</span>
        <Button className="ml-auto" variant="primary" loading={!imagesReady} onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Imprimir</Button>
      </div>
      <div className="label-sheets flex flex-col items-center gap-6 p-6">
        {sheets.map((sheet, si) => (
          <div key={si} className="label-sheet shadow-md">
            {Array.from({ length: LABELS_PER_SHEET }, (_, ci) => <Label key={ci} p={sheet[ci] ?? null} />)}
          </div>
        ))}
      </div>
    </div>
  )
}

function Label({ p }: { p: LabelProduct | null }) {
  if (!p) return <div className="label-cell" />
  const ean = normalizeEan13(p.ean)
  return (
    <div className="label-cell">
      <div style={{ display: 'flex', gap: '1.5mm', minHeight: 0, flex: 1 }}>
        {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: '17mm', height: '17mm', objectFit: 'contain', flexShrink: 0 }} />}
        <div style={{ fontSize: p.imageUrl ? '6.5pt' : '8.5pt', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical' }}>{p.name}</div>
      </div>
      {p.sku && <div style={{ fontSize: '9pt', fontWeight: 700, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden' }}>SKU {p.sku}</div>}
      {ean ? <Ean13 code={ean} /> : <div style={{ fontSize: '7pt', fontFamily: 'monospace' }}>{/\d{6,}/.test(p.ean ?? '') ? `EAN ${p.ean}` : ''}</div>}
    </div>
  )
}

/** EAN-13 em SVG: 95 módulos + zonas de silêncio; dígitos legíveis embaixo. */
function Ean13({ code }: { code: string }) {
  const bits = ean13Modules(code)
  const quiet = 9
  const width = bits.length + quiet * 2
  const guard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92
  return (
    <svg viewBox={`0 0 ${width} 34`} style={{ width: '45mm', height: '14mm', display: 'block' }} shapeRendering="crispEdges" aria-label={`EAN ${code}`}>
      {[...bits].map((b, i) => b === '1' && <rect key={i} x={quiet + i} y={0} width={1} height={guard(i) ? 29 : 26} fill="#000" />)}
      <g fontFamily="monospace" fontSize="7" textAnchor="middle" fill="#000">
        <text x={quiet - 4} y={33}>{code[0]}</text>
        <text x={quiet + 3 + 21} y={33} textLength={38} lengthAdjust="spacingAndGlyphs">{code.slice(1, 7)}</text>
        <text x={quiet + 50 + 21} y={33} textLength={38} lengthAdjust="spacingAndGlyphs">{code.slice(7)}</text>
      </g>
    </svg>
  )
}
