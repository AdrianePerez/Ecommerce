import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, FileSpreadsheet, ImageOff, Link2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Spinner, cn } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatBRL, formatDate, formatDateTime } from '@/lib/format'
import { RestoreFilters, saveFilters } from '@/lib/savedFilters'
import { friendlyDbError } from '@/lib/supabase'
import { readFirstSheet } from '@/lib/xlsx'
import { MonthlyChart } from '@/modules/invoices/MonthlyChart'
import { ProductPicker } from '@/modules/invoices/ProductPicker'
import { CHANNEL_LABEL, importSales, linkSku, listImports, listSales, productInfo, type Channel } from './api'
import { parseMlSales, type ParseResult } from './mlReport'
import { monthlyGross, summarize, type ProductLine } from './summary'

export function SalesPage() {
  return <RestoreFilters storageKey="vendas"><Sales /></RestoreFilters>
}

// ---- período -------------------------------------------------------------
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
function presetRange(p: string): [string, string] {
  const t = today(); const [y, m] = t.split('-').map(Number)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const minus = (days: number) => iso(new Date(new Date(`${t}T12:00:00Z`).getTime() - days * 86400_000))
  switch (p) {
    case 'mes': return [`${t.slice(0, 7)}-01`, t]
    case 'mes_passado': { const d = new Date(Date.UTC(y, m - 2, 1)); const e = new Date(Date.UTC(y, m - 1, 0)); return [iso(d), iso(e)] }
    case '30d': return [minus(29), t]
    case '90d': return [minus(89), t]
    case 'ano': return [`${y}-01-01`, t]
    default: return ['', '']
  }
}
const PRESETS: [string, string][] = [['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['30d', 'Últimos 30 dias'], ['90d', 'Últimos 90 dias'], ['ano', 'Este ano'], ['tudo', 'Tudo'], ['personalizado', 'Personalizado']]

type SortKey = 'units' | 'gross' | 'net' | 'margin' | 'marginPct' | 'returned'
const pctOf = (a: number | null, b: number) => (a === null || b <= 0 ? null : (a / b) * 100)
const pctText = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`)

function Sales() {
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  useEffect(() => { saveFilters('vendas', params) }, [params])
  const preset = params.get('periodo') ?? 'ano'
  const [pf, pt] = presetRange(preset)
  const from = preset === 'personalizado' ? params.get('de') ?? '' : pf
  const to = preset === 'personalizado' ? params.get('ate') ?? '' : pt
  const channel = (params.get('canal') ?? '') as Channel | ''
  const sort = (params.get('ord') ?? 'units') as SortKey
  const set = (patch: Record<string, string>) => setParams((p) => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) }
    return n
  }, { replace: true })

  const sales = useQuery({ queryKey: ['sales', from, to, channel], queryFn: () => listSales({ from, to, channel }) })
  const productIds = useMemo(() => [...new Set((sales.data ?? []).map((s) => s.product_id).filter(Boolean) as string[])].sort(), [sales.data])
  const info = useQuery({ queryKey: ['sales-products', productIds.join(',')], queryFn: () => productInfo(productIds), enabled: productIds.length > 0 })
  const imports = useQuery({ queryKey: ['sales-imports'], queryFn: listImports })

  const costMap = useMemo(() => new Map([...(info.data?.values() ?? [])].filter((p) => p.unitCost !== null).map((p) => [p.id, p.unitCost as number])), [info.data])
  const summary = useMemo(() => summarize(sales.data ?? [], costMap), [sales.data, costMap])
  const months = useMemo(() => monthlyGross(sales.data ?? []), [sales.data])
  const lines = useMemo(() => {
    const v = (l: ProductLine) => sort === 'marginPct' ? pctOf(l.margin, l.gross) ?? -Infinity : sort === 'margin' ? l.margin ?? -Infinity : l[sort]
    return [...summary.lines].sort((a, b) => v(b) - v(a) || b.gross - a.gross)
  }, [summary.lines, sort])
  const unlinked = summary.lines.filter((l) => !l.productId && l.sku)

  // ---- importação ----
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ name: string; result: ParseResult } | null>(null)
  const [reading, setReading] = useState(false)
  async function onFile(f: File | undefined) {
    if (!f) return
    setReading(true)
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error('Arquivo grande demais (máx. 20 MB).')
      const result = parseMlSales(await readFirstSheet(await f.arrayBuffer()))
      if (!result.rows.length) throw new Error('Nenhuma venda encontrada no arquivo.')
      setPreview({ name: f.name, result })
    } catch (e) { toast((e as Error).message, 'bad') } finally { setReading(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const doImport = useMutation({
    mutationFn: () => importSales('mercado_livre', preview!.name, preview!.result.rows),
    onSuccess: (r) => {
      setPreview(null)
      qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['sales-imports'] })
      toast(`Importado: ${r.novas} ${r.novas === 1 ? 'venda nova' : 'vendas novas'}, ${r.atualizadas} ${r.atualizadas === 1 ? 'atualizada' : 'atualizadas'}.`
        + (r.sem_produto ? ` ${r.sem_produto} SKU(s) sem produto — vincule na lista.` : ''))
    },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  // ---- vínculo de SKU ----
  const [linking, setLinking] = useState<ProductLine | null>(null)
  const link = useMutation({
    mutationFn: ({ sku, productId }: { sku: string; productId: string }) => linkSku(sku, productId),
    onSuccess: (n) => { setLinking(null); qc.invalidateQueries({ queryKey: ['sales'] }); toast(`SKU vinculado (${n} ${n === 1 ? 'venda' : 'vendas'}). As próximas importações já vêm ligadas.`) },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  const t = summary.totals
  const marginPct = pctOf(t.margin, t.costCoveredGross)

  return (
    <div>
      <PageHeader title="Vendas" description="Quanto vendeu de cada produto, com o líquido repassado pelo marketplace e a margem sobre o custo médio."
        actions={<>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <Button variant="primary" loading={reading} onClick={() => fileRef.current?.click()}><Upload className="size-4" aria-hidden /> Importar relatório do Mercado Livre</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Select aria-label="Período" className="w-48" value={preset} onChange={(e) => {
          const v = e.target.value
          if (v === 'personalizado') { const [a, b] = presetRange(preset); set({ periodo: v, de: a || from, ate: b || to || today() }) } else set({ periodo: v, de: '', ate: '' })
        }}>
          {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        {preset === 'personalizado' && <>
          <Input type="date" aria-label="De" className="w-40" value={from} onChange={(e) => set({ de: e.target.value })} />
          <Input type="date" aria-label="Até" className="w-40" value={to} onChange={(e) => set({ ate: e.target.value })} />
        </>}
        <Select aria-label="Canal" className="w-48" value={channel} onChange={(e) => set({ canal: e.target.value })}>
          <option value="">Todos os canais</option>
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </Select>
        <span className="pb-2 text-xs text-muted">{from || to ? `${from ? formatDate(`${from}T12:00:00`) : 'início'} a ${to ? formatDate(`${to}T12:00:00`) : 'hoje'}` : 'Todo o período importado'}</span>
      </div>

      {sales.isPending ? <Spinner /> : sales.isError ? <ErrorState message={friendlyDbError(sales.error)} onRetry={() => sales.refetch()} /> : !sales.data.length ? (
        <EmptyState title={imports.data?.length ? 'Nenhuma venda neste período' : 'Nenhuma venda importada ainda'}
          description={imports.data?.length ? 'Escolha outro período ou importe um relatório mais recente.'
            : <>No Mercado Livre: <strong>Vendas → Baixar relatório</strong> (Excel). Depois clique em <strong>Importar relatório</strong> aqui. Dados pessoais dos compradores não são enviados ao sistema.</>}
          action={<Button variant="primary" onClick={() => fileRef.current?.click()}><Upload className="size-4" aria-hidden /> Importar relatório</Button>} />
      ) : (
        <>
          {unlinked.length > 0 && (
            <div className="mb-4 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm text-warn">
              <strong>{unlinked.length} {unlinked.length === 1 ? 'SKU vendido não está ligado' : 'SKUs vendidos não estão ligados'} a um produto</strong> — sem o vínculo, ficam sem foto, custo e margem.
              Use <strong>Vincular</strong> na lista abaixo; vale para as próximas importações.
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Unidades vendidas" value={t.units.toLocaleString('pt-BR')} hint={`${t.orders} ${t.orders === 1 ? 'pedido' : 'pedidos'}`} />
            <Kpi label="Faturamento bruto" value={formatBRL(t.gross)} hint={t.orders ? `ticket médio ${formatBRL(t.gross / t.orders)}` : undefined} />
            <Kpi label="Líquido recebido" value={formatBRL(t.net)} hint={t.gross > 0 ? `${pctText((t.net / t.gross) * 100)} do bruto` : undefined}
              title="O que o marketplace repassa: bruto − tarifas − frete − reembolsos + bônus" />
            <Kpi label="Tarifas e frete" value={formatBRL(t.fees + t.shipping)} hint={`tarifas ${formatBRL(t.fees)} · frete ${formatBRL(t.shipping)}`} />
            <Kpi label="Margem estimada" value={t.margin === null ? '—' : formatBRL(t.margin)} tone={t.margin === null ? undefined : t.margin >= 0 ? 'good' : 'bad'}
              hint={t.margin === null ? 'sem custo dos produtos' : `${pctText(marginPct)} do bruto${t.unitsWithoutCost ? ` · ${t.unitsWithoutCost} un. sem custo` : ''}`}
              title="Líquido recebido − custo médio atual × unidades. Não inclui imposto sobre a venda nem embalagem." />
            <Kpi label="Devoluções" value={t.returned.toLocaleString('pt-BR')} hint={t.cancelled ? `${t.cancelled} un. canceladas (fora das contas)` : 'unidades devolvidas'} />
          </div>

          {months.length > 1 && (
            <Card title="Faturamento bruto por mês" className="mb-4">
              <MonthlyChart data={months} height={180} what="Faturamento bruto" countLabel={(n) => `${n} ${n === 1 ? 'unidade' : 'unidades'}`} />
            </Card>
          )}

          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-sunk text-left text-xs text-muted">
                <tr>
                  <th className="w-14 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">Produto · SKU</th>
                  <SortTh k="units" sort={sort} set={set}>Unidades</SortTh>
                  <SortTh k="returned" sort={sort} set={set}>Devolvidas</SortTh>
                  <SortTh k="gross" sort={sort} set={set}>Faturamento</SortTh>
                  <th className="px-3 py-2 text-right font-medium">Preço médio</th>
                  <SortTh k="net" sort={sort} set={set}>Líquido</SortTh>
                  <th className="px-3 py-2 text-right font-medium" title="Custo médio atual por unidade">Custo un.</th>
                  <SortTh k="margin" sort={sort} set={set}>Margem</SortTh>
                  <SortTh k="marginPct" sort={sort} set={set}>Margem %</SortTh>
                  <th className="px-3 py-2 text-right font-medium" title="Participação no faturamento do período">% fat.</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const p = l.productId ? info.data?.get(l.productId) : undefined
                  const mp = pctOf(l.margin, l.gross)
                  return (
                    <tr key={l.key} className="border-t border-line hover:bg-sunk/60">
                      <td className="py-1.5 pl-3">
                        {p?.thumb ? <img src={p.thumb} alt="" className="size-10 rounded border border-line object-contain" />
                          : <div className="grid size-10 place-items-center rounded border border-dashed border-line text-muted"><ImageOff className="size-4" aria-hidden /></div>}
                      </td>
                      <td className="max-w-96 px-3 py-2">
                        {l.productId ? (
                          <Link to={`/produtos/${l.productId}`} className="font-medium text-ink hover:text-accent hover:underline">{p?.name || l.title}</Link>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="line-clamp-2 font-medium" title={l.title ?? ''}>{l.title}</span>
                            {l.sku && <Button size="sm" onClick={() => setLinking(l)}><Link2 className="size-3.5" aria-hidden /> Vincular</Button>}
                          </div>
                        )}
                        <div className="font-mono text-xs text-muted">{l.sku ?? 'sem SKU no anúncio'}{p?.sku && p.sku !== l.sku ? ` · ${p.sku}` : ''}</div>
                      </td>
                      <td className="tabular px-3 py-2 text-right font-semibold">{l.units.toLocaleString('pt-BR')}</td>
                      <td className={cn('tabular px-3 py-2 text-right', l.returned ? 'text-bad' : 'text-muted')}>{l.returned || '—'}</td>
                      <td className="tabular px-3 py-2 text-right">{formatBRL(l.gross)}</td>
                      <td className="tabular px-3 py-2 text-right text-muted">{l.units ? formatBRL(l.gross / l.units) : '—'}</td>
                      <td className="tabular px-3 py-2 text-right">{formatBRL(l.net)}</td>
                      <td className="tabular px-3 py-2 text-right text-muted">{l.unitCost === null ? (l.productId ? <span title="Produto sem entrada de nota">sem custo</span> : '—') : formatBRL(l.unitCost)}</td>
                      <td className={cn('tabular px-3 py-2 text-right', l.margin !== null && (l.margin >= 0 ? 'text-good' : 'text-bad'))}>{l.margin === null ? '—' : formatBRL(l.margin)}</td>
                      <td className="tabular px-3 py-2 text-right">{pctText(mp)}</td>
                      <td className="tabular px-3 py-2 text-right text-muted">{pctText(pctOf(l.gross, t.gross))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            Canceladas não entram. Devolvidas contam à parte; o que o marketplace cobrou nelas entra no líquido. Custo = custo médio atual do produto (notas de entrada) × unidades vendidas.
            A margem ainda não desconta imposto sobre a venda nem embalagem.
          </p>
        </>
      )}

      {!!imports.data?.length && (
        <Card title="Últimas importações" className="mt-6">
          <ul className="flex flex-col gap-1.5 text-sm">
            {imports.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <FileSpreadsheet className="size-4 text-muted" aria-hidden />
                <span className="max-w-96 truncate font-medium" title={i.file_name}>{i.file_name}</span>
                <Badge>{CHANNEL_LABEL[i.channel]}</Badge>
                <span className="text-xs text-muted">{formatDateTime(i.imported_at)} · {i.rows_new} novas, {i.rows_updated} atualizadas
                  {i.period_start && ` · vendas de ${formatDate(i.period_start)} a ${formatDate(i.period_end)}`}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ImportPreview preview={preview} loading={doImport.isPending} onCancel={() => setPreview(null)} onConfirm={() => doImport.mutate()} />
      <ProductPicker open={!!linking} onClose={() => setLinking(null)} reasonRequired={false} title="Vincular SKU a um produto"
        itemPrefix="SKU do anúncio" itemLabel={linking ? `${linking.sku} — ${linking.title ?? ''}` : ''}
        onPick={(p) => { if (p && linking?.sku) link.mutate({ sku: linking.sku, productId: p.id }) }} />
    </div>
  )
}

function Kpi({ label, value, hint, tone, title }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad'; title?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3" title={title}>
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('tabular mt-0.5 text-xl font-semibold', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  )
}

function SortTh({ k, sort, set, children }: { k: SortKey; sort: SortKey; set: (p: Record<string, string>) => void; children: React.ReactNode }) {
  const on = sort === k
  return (
    <th className="px-3 py-2 text-right font-medium">
      <button className={cn('inline-flex items-center gap-1 hover:text-ink', on && 'text-ink')} onClick={() => set({ ord: k === 'units' ? '' : k })} aria-sort={on ? 'descending' : undefined}>
        {children}{on ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3 opacity-0" aria-hidden />}
      </button>
    </th>
  )
}

function ImportPreview({ preview, loading, onCancel, onConfirm }: { preview: { name: string; result: ParseResult } | null; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
  const rows = preview?.result.rows ?? []
  const active = rows.filter((r) => r.status_group === 'ativa')
  const dates = rows.map((r) => r.sold_at).sort()
  const sum = (k: 'gross_revenue' | 'net_total' | 'units') => active.reduce((a, r) => a + r[k], 0)
  return (
    <Modal open={!!preview} onClose={onCancel} title="Conferir importação"
      footer={<><Button variant="ghost" onClick={onCancel}>Cancelar</Button><Button variant="primary" loading={loading} onClick={onConfirm}>Importar {rows.length} {rows.length === 1 ? 'item' : 'itens'}</Button></>}>
      {preview && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium">{preview.name}</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <dt className="text-muted">Período</dt><dd>{formatDate(dates[0])} a {formatDate(dates[dates.length - 1])}</dd>
            <dt className="text-muted">Itens vendidos</dt><dd>{rows.length} ({active.length} ativos)</dd>
            <dt className="text-muted">Unidades</dt><dd className="tabular">{sum('units').toLocaleString('pt-BR')}</dd>
            <dt className="text-muted">Faturamento bruto</dt><dd className="tabular">{formatBRL(sum('gross_revenue'))}</dd>
            <dt className="text-muted">Líquido</dt><dd className="tabular">{formatBRL(sum('net_total'))}</dd>
            <dt className="text-muted">Devolvidas / canceladas</dt><dd>{rows.filter((r) => r.status_group === 'devolvida').length} / {rows.filter((r) => r.status_group === 'cancelada').length}</dd>
          </dl>
          {preview.result.warnings.map((w) => <p key={w} className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">{w}</p>)}
          <p className="text-xs text-muted">Pacotes e kits viram um item por produto, com os valores rateados pelo preço de cada um. Vendas já importadas são atualizadas (status, devoluções), sem duplicar.
            Nome, CPF e endereço dos compradores <strong>não</strong> são enviados — só a UF de destino.</p>
        </div>
      )}
    </Modal>
  )
}
