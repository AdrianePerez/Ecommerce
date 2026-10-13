import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, FileUp, Link2, Plus, Trash2, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, Card, ErrorState, Input, PageHeader, Spinner, cn } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { NfeError, parseNfe, sha256Hex, type NfeItem, type ParsedNfe } from '@/lib/domain/nfe'
import { describeRule, unitCost, type CostRule } from '@/lib/domain/cost'
import { formatBRL, formatCnpj, formatDateTime, formatNumber } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import {
  duplicateIdFromError, findImportedByKeys, getActiveCostRule, importInvoice, matchItems, suggestProducts, uploadXml,
} from './api'
import {
  STATUS_LABEL, buildPayload, checkReady, createNew, ignoreItem, initialDecision, linkTo, type ItemDecision,
} from './importModel'
import { ProductPicker } from './ProductPicker'

type Entry = {
  id: string
  fileName: string
  xmlText: string
  state: 'lendo' | 'erro' | 'conferencia' | 'gravando' | 'gravada'
  error?: string
  parsed?: ParsedNfe
  decisions?: ItemDecision[]
  duplicateOf?: string | null
  savedId?: string
}

const MAX_FILE_BYTES = 5 * 1024 * 1024

export function ImportPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rule = useQuery({ queryKey: ['cost-rule-active'], queryFn: getActiveCostRule })
  const navigate = useNavigate()

  const update = (id: string, patch: Partial<Entry> | ((e: Entry) => Partial<Entry>)) =>
    setEntries((all) => all.map((e) => (e.id === id ? { ...e, ...(typeof patch === 'function' ? patch(e) : patch) } : e)))

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files)
    const fresh: Entry[] = list.map((f) => ({ id: crypto.randomUUID(), fileName: f.name, xmlText: '', state: 'lendo' }))
    setEntries((all) => [...fresh, ...all])

    await Promise.all(list.map(async (file, i) => {
      const id = fresh[i].id
      try {
        if (!/\.xml$/i.test(file.name)) throw new NfeError('Selecione o arquivo .xml da nota (não o PDF da DANFE).')
        if (file.size > MAX_FILE_BYTES) throw new NfeError('Arquivo grande demais para um XML de NF-e (mais de 5 MB).')
        const xmlText = await file.text()
        const parsed = parseNfe(xmlText)
        const [dups, matches] = await Promise.all([
          findImportedByKeys([parsed.invoice.access_key]),
          matchItems(parsed.invoice.issuer_cnpj, parsed.items),
        ])
        // Sugestões por descrição só para itens sem EAN/código conhecidos
        const decisions = await Promise.all(parsed.items.map(async (it) => {
          const m = matches.get(it.item_number)
          const known = m?.ean_product_id || m?.sku_product_id
          const sugg = known ? [] : await suggestProducts(it.description, 5)
          return initialDecision(it, m, sugg)
        }))
        update(id, { xmlText, parsed, decisions, duplicateOf: dups.get(parsed.invoice.access_key) ?? null, state: 'conferencia' })
      } catch (e) {
        update(id, { state: 'erro', error: e instanceof NfeError ? e.message : friendlyDbError(e as Error) })
      }
    }))
  }

  // A mesma nota selecionada duas vezes
  const keyCount = new Map<string, number>()
  for (const e of entries) if (e.parsed && e.state !== 'gravada') keyCount.set(e.parsed.invoice.access_key, (keyCount.get(e.parsed.invoice.access_key) ?? 0) + 1)

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  return (
    <>
      <Link to="/entradas" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="size-4" aria-hidden /> Entrada de mercadorias
      </Link>
      <PageHeader
        title="Importar XML de NF-e"
        description={rule.data ? <>Regra de custo em uso: <strong>v{rule.data.version}</strong> · {describeRule(rule.data)}</> : undefined}
      />

      {rule.isSuccess && !rule.data && <div className="mb-4"><ErrorState message="Não há regra de custo ativa. Configure em Configurações → Regra de custo." /></div>}

      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'mb-5 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed bg-surface px-4 py-8 text-center transition-colors focus-within:outline-2 focus-within:outline-accent',
          dragOver ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent',
        )}
      >
        <FileUp className="size-7 text-accent" aria-hidden />
        <span className="font-medium">Selecione ou arraste os arquivos XML das notas</span>
        <span className="text-sm text-muted">Pode escolher várias de uma vez. Cada nota é conferida antes de ser gravada.</span>
        <input ref={inputRef} type="file" accept=".xml,text/xml,application/xml" multiple className="sr-only"
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }} />
      </label>

      <div className="flex flex-col gap-5">
        {entries.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            rule={rule.data ?? null}
            repeatedInSelection={!!e.parsed && (keyCount.get(e.parsed.invoice.access_key) ?? 0) > 1}
            onChange={(patch) => update(e.id, patch)}
            onRemove={() => setEntries((all) => all.filter((x) => x.id !== e.id))}
            onOpen={(id) => navigate(`/entradas/${id}`)}
          />
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------
// Uma nota
// ---------------------------------------------------------------------
function EntryCard({
  entry, rule, repeatedInSelection, onChange, onRemove, onOpen,
}: {
  entry: Entry
  rule: CostRule | null
  repeatedInSelection: boolean
  onChange: (p: Partial<Entry> | ((e: Entry) => Partial<Entry>)) => void
  onRemove: () => void
  onOpen: (invoiceId: string) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [picking, setPicking] = useState<number | null>(null)

  if (entry.state === 'lendo') {
    return <Card title={entry.fileName}><Spinner label="Lendo a nota e procurando os produtos…" /></Card>
  }
  if (entry.state === 'erro') {
    return (
      <Card title={entry.fileName} actions={<Button size="sm" variant="ghost" onClick={onRemove} aria-label="Remover"><X className="size-4" /></Button>}>
        <ErrorState message={entry.error ?? 'Erro ao ler o arquivo.'} />
      </Card>
    )
  }

  const { parsed, decisions = [] } = entry as Required<Pick<Entry, 'parsed'>> & Entry
  const inv = parsed!.invoice
  const ready = checkReady(parsed!, decisions, entry.duplicateOf ?? null)
  if (repeatedInSelection) { ready.ready = false; ready.problems.unshift('Esta mesma nota foi selecionada mais de uma vez.') }
  const saving = entry.state === 'gravando'
  const saved = entry.state === 'gravada'

  const setDecision = (n: number, fn: (d: ItemDecision) => ItemDecision) =>
    onChange((e) => ({ decisions: e.decisions!.map((d) => (d.item_number === n ? fn(d) : d)) }))

  async function save() {
    if (!ready.ready || !parsed) return
    onChange({ state: 'gravando', error: undefined })
    try {
      const path = await uploadXml(inv.access_key, entry.xmlText)
      const sha = await sha256Hex(entry.xmlText)
      const id = await importInvoice(buildPayload(parsed, decisions, { path, sha256: sha }))
      onChange({ state: 'gravada', savedId: id })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      toast(`NF-e ${inv.number} gravada.`)
    } catch (e) {
      const dup = duplicateIdFromError(e)
      onChange({ state: 'conferencia', duplicateOf: dup ?? entry.duplicateOf, error: friendlyDbError(e as Error) })
    }
  }

  const pickingItem = picking !== null ? parsed!.items.find((i) => i.item_number === picking) : undefined
  const pickingDecision = picking !== null ? decisions.find((d) => d.item_number === picking) : undefined

  return (
    <Card
      title={`NF-e ${inv.number}${inv.series ? ` · série ${inv.series}` : ''} — ${inv.issuer_trade_name || inv.issuer_name}`}
      actions={!saved && !saving && <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 className="size-4" aria-hidden /> Remover da lista</Button>}
    >
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Info label="Fornecedor" value={<>{inv.issuer_name}<div className="font-mono text-xs text-muted">{formatCnpj(inv.issuer_cnpj)}</div></>} />
        <Info label="Emissão" value={formatDateTime(inv.issued_at)} />
        <Info label="Total da nota" value={<span className="tabular">{formatBRL(inv.totals.invoice)}</span>} />
        <Info label="Produtos · IPI" value={<span className="tabular">{formatBRL(inv.totals.products)} · {formatBRL(inv.totals.ipi)}</span>} />
        <Info label="Frete · Desconto" value={<span className="tabular">{formatBRL(inv.totals.freight)} · {formatBRL(inv.totals.discount)}</span>} />
        <Info label="ICMS-ST" value={<span className="tabular">{formatBRL(inv.totals.st)}</span>} />
        <Info label="Chave de acesso" className="col-span-2" value={<span className="font-mono text-xs break-all">{inv.access_key}</span>} />
      </dl>

      {saved ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-accent-soft px-4 py-3 text-sm text-good">
          <span className="flex items-center gap-2"><CheckCircle2 className="size-4" aria-hidden /> Nota gravada. Custos atualizados.</span>
          <Button size="sm" onClick={() => onOpen(entry.savedId!)}>Ver nota</Button>
        </div>
      ) : (
        <>
          {entry.duplicateOf && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-warn-soft px-4 py-2.5 text-sm text-warn">
              Esta nota já foi importada antes. Ela não será contada de novo nos custos.
              <Button size="sm" onClick={() => onOpen(entry.duplicateOf!)}>Abrir importação anterior</Button>
            </div>
          )}
          {parsed!.warnings.length > 0 && (
            <ul className="mb-3 flex flex-col gap-1 rounded-md bg-warn-soft px-4 py-2.5 text-sm text-warn">
              {parsed!.warnings.map((w) => <li key={w}>• {w}</li>)}
            </ul>
          )}
          {entry.error && <div className="mb-3"><ErrorState message={entry.error} /></div>}

          <div className="-mx-4 overflow-x-auto border-y border-line">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-sunk text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Código / EAN</th>
                  <th className="px-3 py-2 font-medium">Descrição · NCM</th>
                  <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                  <th className="px-3 py-2 text-right font-medium">Valor unit.</th>
                  <th className="px-3 py-2 text-right font-medium">IPI</th>
                  <th className="px-3 py-2 text-right font-medium">Fator</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Custo unit.</th>
                  <th className="px-3 py-2 font-medium">Produto do cadastro</th>
                </tr>
              </thead>
              <tbody>
                {parsed!.items.map((it) => {
                  const d = decisions.find((x) => x.item_number === it.item_number)!
                  return (
                    <ItemRow key={it.item_number} item={it} d={d} rule={rule} disabled={saving}
                      onFactor={(f) => setDecision(it.item_number, (x) => ({ ...x, conversion_factor: f, factor_needs_review: false }))}
                      onCreate={() => setDecision(it.item_number, createNew)}
                      onIgnore={() => setDecision(it.item_number, ignoreItem)}
                      onPick={() => setPicking(it.item_number)} />
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            {ready.problems.length > 0 ? (
              <ul className="text-sm text-warn">{ready.problems.map((p) => <li key={p}>• {p}</li>)}</ul>
            ) : (
              <p className="text-sm text-muted">Tudo conferido. Ao gravar, a nota, os itens e os custos são salvos juntos.</p>
            )}
            <Button variant="primary" disabled={!ready.ready || !rule} loading={saving} onClick={save}>Gravar nota</Button>
          </div>
        </>
      )}

      <ProductPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        itemLabel={pickingItem ? `${pickingItem.supplier_code} · ${pickingItem.description}` : ''}
        suggestions={pickingDecision?.suggestions ?? []}
        onPick={(p, reason) => {
          if (p && picking !== null) setDecision(picking, (d) => linkTo(d, p.id, p.name, reason))
          setPicking(null)
        }}
      />
    </Card>
  )
}

function Info({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  )
}

const STATUS_TONE: Record<ItemDecision['status'], 'good' | 'warn' | 'bad' | 'neutral' | 'accent'> = {
  ean: 'good', supplier_sku: 'good', manual: 'good', novo: 'accent', sem_cadastro: 'accent',
  conflito: 'bad', sugestao: 'warn', ignorado: 'neutral',
}

function ItemRow({
  item, d, rule, disabled, onFactor, onCreate, onIgnore, onPick,
}: {
  item: NfeItem
  d: ItemDecision
  rule: CostRule | null
  disabled: boolean
  onFactor: (f: number) => void
  onCreate: () => void
  onIgnore: () => void
  onPick: () => void
}) {
  const [factorText, setFactorText] = useState(String(d.conversion_factor))
  const factorValid = Number(factorText.replace(',', '.')) > 0
  let cost: string = '—'
  try {
    if (rule && d.conversion_factor > 0) cost = formatBRL(unitCost(item, item.qty_com, d.conversion_factor, rule).toNumber())
  } catch { /* fator inválido */ }
  const baseQty = Number(item.qty_com) * d.conversion_factor

  return (
    <tr className={cn('border-t border-line align-top', d.action === 'ignore' && 'text-muted')}>
      <td className="px-3 py-2.5 tabular">{item.item_number}</td>
      <td className="px-3 py-2.5 font-mono text-xs leading-5">
        <div>{item.supplier_code}</div>
        <div className="text-muted">{item.ean ?? 'sem EAN'}</div>
      </td>
      <td className="max-w-72 px-3 py-2.5">
        <div>{item.description}</div>
        <div className="font-mono text-xs text-muted">NCM {item.ncm ?? '—'}{item.cfop ? ` · CFOP ${item.cfop}` : ''}</div>
      </td>
      <td className="tabular px-3 py-2.5 text-right whitespace-nowrap">
        {formatNumber(item.qty_com, 4)} {item.unit_com}
        {d.conversion_factor !== 1 && <div className="text-xs text-muted">= {formatNumber(baseQty, 4)} un</div>}
      </td>
      <td className="tabular px-3 py-2.5 text-right">{formatBRL(item.unit_price_com)}</td>
      <td className="tabular px-3 py-2.5 text-right whitespace-nowrap">
        {formatBRL(item.ipi_value)}
        {item.ipi_rate && <div className="text-xs text-muted">{formatNumber(item.ipi_rate, 2)}%</div>}
      </td>
      <td className="px-3 py-2.5 text-right">
        <Input
          aria-label={`Fator de conversão do item ${item.item_number}`}
          inputMode="decimal"
          disabled={disabled || d.action === 'ignore'}
          value={factorText}
          aria-invalid={!factorValid || undefined}
          onChange={(e) => setFactorText(e.target.value)}
          onBlur={() => factorValid && onFactor(Number(factorText.replace(',', '.')))}
          className={cn('tabular h-8 w-16 text-right', d.factor_needs_review && d.action !== 'ignore' && 'border-warn bg-warn-soft')}
          title="Unidades do produto em cada unidade da nota (ex.: caixa com 12 = 12)"
        />
        {d.factor_needs_review && d.action !== 'ignore' && (
          <button className="mt-1 text-xs text-accent hover:underline" onClick={() => onFactor(d.conversion_factor)} disabled={disabled}>
            Confirmar {d.conversion_factor}
          </button>
        )}
      </td>
      <td className="tabular px-3 py-2.5 text-right font-medium">{d.action === 'ignore' ? '—' : cost}</td>
      <td className="min-w-64 px-3 py-2.5">
        <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
        {d.product_name && (
          <div className="mt-1 font-medium">
            {d.product_id ? <Link to={`/produtos/${d.product_id}`} target="_blank" className="hover:text-accent hover:underline">{d.product_name}</Link> : d.product_name}
          </div>
        )}
        {(d.status === 'conflito' || d.status === 'sugestao') && <div className="mt-1 text-xs text-muted">{d.reason}</div>}
        {!disabled && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onPick}><Link2 className="size-3.5" aria-hidden /> {d.action === 'link' ? 'Trocar' : 'Vincular'}</Button>
            {d.action !== 'create' && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCreate}><Plus className="size-3.5" aria-hidden /> Novo cadastro</Button>}
            {d.action !== 'ignore' && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onIgnore}>Ignorar</Button>}
          </div>
        )}
      </td>
    </tr>
  )
}
