import { useState } from 'react'
import { cn } from '@/components/ui'
import { formatBRL } from '@/lib/format'

export interface MonthPoint { key: string; label: string; total: number; count: number }

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

/** Escala "redonda" para o eixo (0, 25 mil, 50 mil…). */
export function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

/** Barras por mês, uma série (o título nomeia a medida). Passe o mouse para ver o valor. */
export function MonthlyChart({ data, height = 220 }: { data: MonthPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...data.map((d) => d.total)))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const best = data.reduce((b, d, i) => (d.total > (data[b]?.total ?? -1) ? i : b), 0)

  return (
    <div className="flex gap-2" role="img" aria-label={`Valor das entradas por mês: ${data.map((d) => `${d.label} ${formatBRL(d.total)}`).join('; ')}`}>
      {/* eixo de valores */}
      <div className="relative w-20 shrink-0 text-right text-[11px] whitespace-nowrap text-muted" style={{ height }}>
        {ticks.map((t) => (
          <span key={t} className="tabular absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / max) * 100}%` }}>
            {t === 0 ? '0' : `R$ ${compact.format(t)}`}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
          {/* grade discreta */}
          {ticks.map((t) => (
            <div key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-line' : 'border-line/50 border-dashed')}
              style={{ top: `${(1 - t / max) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => {
              const h = (d.total / max) * 100
              return (
                <div key={d.key} className="relative flex h-full flex-1 items-end justify-center"
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
                  aria-label={`${d.label}: ${formatBRL(d.total)}, ${d.count} nota(s)`}>
                  <div className={cn('w-full max-w-10 rounded-t-[4px] transition-opacity', hover !== null && hover !== i ? 'opacity-45' : '')}
                    style={{ height: `${h}%`, minHeight: d.total > 0 ? 2 : 0, background: 'var(--color-accent)' }} />
                  {i === best && d.total > 0 && hover === null && (
                    <span className="tabular pointer-events-none absolute -translate-y-1 text-[11px] font-medium whitespace-nowrap text-ink" style={{ bottom: `${h}%` }}>
                      {formatBRL(d.total)}
                    </span>
                  )}
                  {hover === i && (
                    <div className="pointer-events-none absolute z-10 -translate-y-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
                      style={{ bottom: `${Math.min(h, 80)}%`, ...(i > data.length / 2 ? { right: 0 } : { left: 0 }) }}>
                      <div className="font-medium">{d.label}</div>
                      <div className="tabular">{formatBRL(d.total)}</div>
                      <div className="text-muted">{d.count} nota(s)</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {/* meses */}
        <div className="mt-1.5 flex gap-[2px] text-[11px] text-muted">
          {data.map((d, i) => (
            <span key={d.key} className={cn('flex-1 truncate text-center', data.length > 14 && i % 2 === 1 && 'invisible')}>{d.label}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
