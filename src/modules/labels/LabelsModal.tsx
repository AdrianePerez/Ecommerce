import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, ErrorState, Input, Modal, Spinner } from '@/components/ui'
import { normalizeEan13 } from '@/lib/barcode/ean13'
import { friendlyDbError } from '@/lib/supabase'
import { LABELS_PER_SHEET, labelProducts, saveJob } from './api'

const MAX_QTY = 500

/** Escolhe a quantidade de etiquetas por produto e abre a folha de impressão (10×15 cm, 6 por folha). */
export function LabelsModal({ open, ids, onClose }: { open: boolean; ids: string[]; onClose: () => void }) {
  const products = useQuery({ queryKey: ['label-products', ids.join(',')], queryFn: () => labelProducts(ids), enabled: open && ids.length > 0 })
  const [qty, setQty] = useState<Record<string, number>>({})
  const [all, setAll] = useState('1')
  const [skip, setSkip] = useState(0)
  useEffect(() => { if (open) { setQty({}); setAll('1'); setSkip(0) } }, [open])

  const rows = products.data ?? []
  const q = (id: string) => qty[id] ?? 1
  const total = rows.reduce((s, r) => s + q(r.id), 0)
  const sheets = Math.ceil((total + skip) / LABELS_PER_SHEET)
  const clamp = (v: string) => Math.max(0, Math.min(MAX_QTY, Math.floor(Number(v) || 0)))

  function print() {
    const job = saveJob({ items: rows.filter((r) => q(r.id) > 0).map((r) => ({ id: r.id, qty: q(r.id) })), skip })
    window.open(`/etiquetas?job=${job}`, '_blank')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Imprimir etiquetas de produto" wide
      footer={<>
        <span className="mr-auto text-sm text-muted">{total} {total === 1 ? 'etiqueta' : 'etiquetas'} · {sheets} {sheets === 1 ? 'folha' : 'folhas'} 10×15</span>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={!total || products.isPending} onClick={print}><Printer className="size-4" aria-hidden /> Gerar etiquetas</Button>
      </>}>
      {products.isPending ? <Spinner /> : products.isError ? <ErrorState message={friendlyDbError(products.error)} /> : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Mesma quantidade para todos</span>
              <span className="flex gap-2">
                <Input type="number" min={0} max={MAX_QTY} className="w-20" value={all} onChange={(e) => setAll(e.target.value)} />
                <Button size="sm" onClick={() => setQty(Object.fromEntries(rows.map((r) => [r.id, clamp(all)])))}>Aplicar</Button>
              </span>
            </label>
            <label className="flex flex-col gap-1" title="Para aproveitar uma folha já usada: as primeiras posições ficam em branco">
              <span className="text-xs text-muted">Pular posições na 1ª folha</span>
              <select className="h-9 rounded-md border border-line bg-surface px-2" value={skip} onChange={(e) => setSkip(Number(e.target.value))}>
                {Array.from({ length: LABELS_PER_SHEET }, (_, i) => <option key={i} value={i}>{i === 0 ? 'Nenhuma' : i}</option>)}
              </select>
            </label>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-md border border-line">
            <table className="w-full">
              <thead className="sticky top-0 bg-sunk text-left text-xs text-muted">
                <tr><th className="px-3 py-2 font-medium" /><th className="px-3 py-2 font-medium">Produto</th><th className="px-3 py-2 font-medium">SKU · EAN</th><th className="px-3 py-2 text-right font-medium">Etiquetas</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-1.5 pl-3">{r.imageUrl ? <img src={r.imageUrl} alt="" className="size-10 rounded object-contain" /> : <div className="size-10 rounded bg-sunk" />}</td>
                    <td className="max-w-72 px-3 py-1.5">{r.name || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-xs leading-5">
                      <div>{r.sku ?? <span className="text-warn">sem SKU</span>}</div>
                      <div className={normalizeEan13(r.ean) ? 'text-muted' : 'text-warn'}>{r.ean ? (normalizeEan13(r.ean) ? r.ean : `${r.ean} (inválido)`) : 'sem EAN'}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Input type="number" min={0} max={MAX_QTY} className="ml-auto w-20 text-right" aria-label={`Etiquetas de ${r.name}`}
                        value={q(r.id)} onChange={(e) => setQty((s) => ({ ...s, [r.id]: clamp(e.target.value) }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Sem foto, a etiqueta sai só com o texto. EAN ausente ou inválido sai sem código de barras.</p>
        </div>
      )}
    </Modal>
  )
}
