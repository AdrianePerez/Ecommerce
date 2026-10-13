import { cn } from '@/components/ui'
import { formatBRL, formatNumber } from '@/lib/format'
import type { Breakdown } from '@/lib/domain/pricing'

export const pct = (v: number | null | undefined) => (v == null ? '—' : `${formatNumber(v, 2)}%`)

export function marginTone(m: number | null | undefined, target?: number) {
  if (m == null) return 'text-muted'
  if (m < 0) return 'text-bad'
  if (target != null && m < target) return 'text-warn'
  return 'text-good'
}

/** Detalhamento do preço: de onde vem cada real. */
export function BreakdownTable({ b, compact }: { b: Breakdown; compact?: boolean }) {
  const rows: [string, number, string?][] = [
    ['Custo de aquisição', b.cost],
    [`Comissão (${formatNumber(b.commissionPct, 2)}%)`, b.commission],
    ['Tarifa fixa do canal', b.fixedFee],
    ['Frete por sua conta', b.shipping],
    ['Outras taxas do canal', b.extra],
    ['Impostos sobre a venda', b.tax],
    ['Embalagem', b.packaging],
    ['Outros custos', b.otherFixed + b.otherPct],
  ]
  return (
    <dl className={cn('grid grid-cols-[1fr_auto] gap-x-4 text-sm', compact ? 'gap-y-0.5' : 'gap-y-1')}>
      <dt className="font-medium">Preço de venda</dt><dd className="tabular font-medium">{formatBRL(b.price)}</dd>
      {rows.filter(([, v], i) => i < 2 || v !== 0).map(([k, v]) => (
        <div key={k} className="contents text-muted"><dt>− {k}</dt><dd className="tabular">{formatBRL(v)}</dd></div>
      ))}
      <dt className="mt-1 border-t border-line pt-1 font-medium">Lucro estimado</dt>
      <dd className={cn('tabular mt-1 border-t border-line pt-1 font-medium', b.profit < 0 ? 'text-bad' : '')}>{formatBRL(b.profit)}</dd>
      <dt className="text-muted">Margem sobre a venda</dt><dd className={cn('tabular', marginTone(b.marginPct))}>{pct(b.marginPct)}</dd>
      <dt className="text-muted">Markup sobre o custo</dt><dd className="tabular">{b.markup == null ? '—' : `${formatNumber(b.markup, 2)}×`}</dd>
    </dl>
  )
}

export function EstimateNote() {
  return <p className="text-xs text-muted">Valores estimados com as regras cadastradas. Não são o resultado contábil nem o lucro real da venda.</p>
}
