import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileUp, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, cn } from '@/components/ui'
import { formatBRL, formatDate, formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { listSuppliers } from '@/modules/settings/api'
import { INVOICE_PAGE_SIZE, STAGE_LABEL, listInvoiceTotals, listInvoices, type InvoiceFilters, type InvoiceStage } from './api'
import { ReceiptCell, STAGE_TONE, StageProgress } from './Receipt'
import { InboxCard, SyncEmailButton } from './InboxCard'
import { MonthlyChart } from './MonthlyChart'
import { buildMonths } from './monthly'

const KEYS = { q: 'search', nf: 'number', fornecedor: 'supplierId', emissaoDe: 'issuedFrom', emissaoAte: 'issuedTo', entradaDe: 'enteredFrom', entradaAte: 'enteredTo', estagio: 'stage' } as const
const STAGES: InvoiceStage[] = ['em_transito', 'cadastro_pendente', 'em_preparacao', 'finalizada']

const STAGE_DESC: Record<InvoiceStage, string> = {
  em_transito: 'XML recebido, mercadoria não', cadastro_pendente: 'Recebida; produto incompleto',
  em_preparacao: 'Cadastro ok; falta anúncio', finalizada: 'Todos os itens prontos',
}

export function InvoicesListPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const page = Number(params.get('p') ?? 0)
  const filters: InvoiceFilters = Object.fromEntries(Object.entries(KEYS).map(([k, f]) => [f, params.get(k) ?? ''])) as InvoiceFilters
  const [text, setText] = useState(filters.search ?? '')
  const [nfText, setNfText] = useState(filters.number ?? '')
  const [groupBy, setGroupBy] = useState<'emissao' | 'entrada'>('emissao')
  const [showTable, setShowTable] = useState(false)

  function update(patch: Partial<Record<keyof typeof KEYS, string>>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    next.delete('p')
    setParams(next, { replace: true })
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== (params.get('q') ?? '') || nfText !== (params.get('nf') ?? '')) update({ q: text, nf: nfText })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, nfText])

  const key = JSON.stringify(filters)
  const list = useQuery({ queryKey: ['invoices', key, page], queryFn: () => listInvoices(filters, page), placeholderData: keepPreviousData })
  // Totais sem o filtro de estágio: alimentam os contadores do monitor e o painel
  const keyNoStage = JSON.stringify({ ...filters, stage: '' })
  const totals = useQuery({ queryKey: ['invoice-totals', keyNoStage], queryFn: () => listInvoiceTotals({ ...filters, stage: '' }) })
  const stageCounts = useMemo(() => {
    const c: Record<InvoiceStage, number> = { em_transito: 0, cadastro_pendente: 0, em_preparacao: 0, finalizada: 0 }
    for (const r of totals.data ?? []) c[r.stage]++
    return c
  }, [totals.data])
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers() })

  const months = useMemo(() => {
    const rows = (totals.data ?? []).filter((r) => !filters.stage || r.stage === filters.stage).map((r) => ({ date: groupBy === 'emissao' ? r.issued_at : r.imported_at, total: r.total_invoice }))
    const from = groupBy === 'emissao' ? filters.issuedFrom : filters.enteredFrom
    const to = groupBy === 'emissao' ? filters.issuedTo : filters.enteredTo
    return buildMonths(rows, { from: from || undefined, to: to || undefined })
  }, [totals.data, groupBy, filters.stage, filters.issuedFrom, filters.issuedTo, filters.enteredFrom, filters.enteredTo])

  const sum = months.reduce((s, m) => s + m.total, 0)
  const count = months.reduce((s, m) => s + m.count, 0)
  const activeMonths = months.filter((m) => m.count > 0).length
  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <>
      <PageHeader
        title="Entrada de mercadorias"
        description="Notas fiscais de compra importadas. Cada nota é contada uma única vez nos custos."
        actions={<>
          <SyncEmailButton />
          <Button variant="primary" onClick={() => navigate('/entradas/importar')}><FileUp className="size-4" aria-hidden /> Importar XML</Button>
        </>}
      />

      <InboxCard />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Estágio das notas">
        {STAGES.map((st) => {
          const on = filters.stage === st
          return (
            <button key={st} type="button" aria-pressed={on} onClick={() => update({ estagio: on ? '' : st })}
              className={cn('flex items-center justify-between rounded-lg border bg-surface px-4 py-3 text-left hover:border-accent', on ? 'border-accent ring-2 ring-accent/20' : 'border-line')}>
              <span className="flex flex-col items-start gap-1">
                <span className="text-xs text-muted">{STAGE_DESC[st]}</span>
                <Badge tone={STAGE_TONE[st]}>{STAGE_LABEL[st]}</Badge>
              </span>
              <span className="tabular text-2xl font-semibold">{totals.isPending ? '…' : stageCounts[st]}</span>
            </button>
          )
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3">
        <Field label="Buscar" htmlFor="f_q" className="min-w-56 flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
            <Input id="f_q" className="pl-8" placeholder="Fornecedor, CNPJ ou chave de acesso" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </Field>
        <Field label="Número da NF" htmlFor="f_nf">
          <Input id="f_nf" className="tabular w-32" inputMode="numeric" value={nfText} onChange={(e) => setNfText(e.target.value)} placeholder="Ex.: 12345" />
        </Field>
        <Field label="Fornecedor" htmlFor="f_sup">
          <Select id="f_sup" className="w-52" value={filters.supplierId} onChange={(e) => update({ fornecedor: e.target.value })}>
            <option value="">Todos</option>
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.trade_name || s.name}</option>)}
          </Select>
        </Field>
        <DateRange label="Data de emissão" from={filters.issuedFrom ?? ''} to={filters.issuedTo ?? ''}
          onChange={(a, b) => update({ emissaoDe: a, emissaoAte: b })} id="em" />
        <DateRange label="Data de entrada" from={filters.enteredFrom ?? ''} to={filters.enteredTo ?? ''}
          onChange={(a, b) => update({ entradaDe: a, entradaAte: b })} id="en" />
        {hasFilters && (
          <Button variant="ghost" onClick={() => { setText(''); setNfText(''); setParams({}, { replace: true }) }}>Limpar filtros</Button>
        )}
      </div>

      <Card className="mb-4" title="Valor das entradas por mês" actions={
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">Agrupar pela data de</span>
          <Select className="h-8 w-32 text-[13px]" aria-label="Agrupar por" value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'emissao' | 'entrada')}>
            <option value="emissao">emissão</option>
            <option value="entrada">entrada</option>
          </Select>
        </div>
      }>
        {totals.isPending ? <Spinner /> : totals.isError ? <ErrorState message={friendlyDbError(totals.error)} onRetry={() => totals.refetch()} /> : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={`Total (${months[0]?.label} a ${months.at(-1)?.label})`} value={formatBRL(sum)} />
              <Stat label="Notas" value={count.toLocaleString('pt-BR')} />
              <Stat label="Média por nota" value={count ? formatBRL(sum / count) : '—'} />
              <Stat label="Média por mês com entrada" value={activeMonths ? formatBRL(sum / activeMonths) : '—'} />
            </div>
            <MonthlyChart data={months} />
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>Valor total das notas, como no XML, {groupBy === 'emissao' ? 'pela data de emissão' : 'pela data em que a nota foi importada'}. Respeita os filtros acima.</span>
              <button type="button" className="shrink-0 text-accent hover:underline" onClick={() => setShowTable((v) => !v)}>{showTable ? 'Ocultar tabela' : 'Ver tabela'}</button>
            </div>
            {showTable && (
              <table className="mt-2 w-full max-w-md text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-medium">Mês</th><th className="py-1 text-right font-medium">Notas</th><th className="py-1 text-right font-medium">Valor</th></tr></thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.key} className="border-t border-line"><td className="py-1">{m.label}</td><td className="tabular py-1 text-right">{m.count}</td><td className="tabular py-1 text-right">{formatBRL(m.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Card>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {list.isPending ? <Spinner /> : list.isError ? (
          <div className="p-4"><ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} /></div>
        ) : list.data.total === 0 ? (
          hasFilters ? <EmptyState title="Nenhuma nota com estes filtros" /> : (
            <EmptyState title="Nenhuma nota importada" description="Importe o XML das notas de compra para registrar os produtos e calcular o custo."
              action={<Button variant="primary" onClick={() => navigate('/entradas/importar')}>Importar XML</Button>} />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sunk text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Emissão</th>
                    <th className="px-3 py-2 font-medium">Nota</th>
                    <th className="px-3 py-2 font-medium">Fornecedor</th>
                    <th className="px-3 py-2 text-right font-medium">Itens</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Mercadoria</th>
                    <th className="px-3 py-2 font-medium">Cadastro dos produtos</th>
                    <th className="px-3 py-2 font-medium">Importada em</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className={cn(list.isPlaceholderData && 'opacity-60')}>
                  {list.data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-line hover:bg-sunk/60">
                      <td className="tabular px-4 py-2.5">{formatDate(r.issued_at)}</td>
                      <td className="px-3 py-2.5">
                        <Link to={`/entradas/${r.id}`} className="font-medium hover:text-accent hover:underline">
                          NF-e {r.number}{r.series ? `/${r.series}` : ''}
                        </Link>
                      </td>
                      <td className="max-w-56 truncate px-3 py-2.5" title={r.supplier_name ?? r.issuer_name}>{r.supplier_trade_name || r.supplier_name || r.issuer_name}</td>
                      <td className="tabular px-3 py-2.5 text-right">{r.items_total + r.items_ignored}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatBRL(r.total_invoice)}</td>
                      <td className="px-3 py-2.5"><ReceiptCell inv={r} compact /></td>
                      <td className="px-3 py-2.5"><StageProgress inv={r} /></td>
                      <td className="tabular px-3 py-2.5 whitespace-nowrap text-muted">{formatDateTime(r.imported_at)}</td>
                      <td className="px-3 py-2.5 text-right"><Link to={`/produtos?nf=${r.id}`} className="text-xs text-accent hover:underline">Ver produtos</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={INVOICE_PAGE_SIZE} total={list.data.total}
              onPage={(n) => { const next = new URLSearchParams(params); next.set('p', String(n)); setParams(next, { replace: true }) }} />
          </>
        )}
      </div>
    </>
  )
}

function DateRange({ label, from, to, onChange, id }: { label: string; from: string; to: string; onChange: (from: string, to: string) => void; id: string }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-[13px] font-medium">{label}</legend>
      <div className="flex items-center gap-1.5">
        <Input id={`${id}_de`} aria-label={`${label} de`} type="date" className="w-38" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
        <span className="text-xs text-muted">até</span>
        <Input id={`${id}_ate`} aria-label={`${label} até`} type="date" className="w-38" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
      </div>
    </fieldset>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-sunk/60 px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  )
}
