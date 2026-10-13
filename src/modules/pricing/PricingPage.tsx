import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, History, Plus } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Spinner, cn } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/app/auth'
import { parseBrDecimal } from '@/lib/domain/numbers'
import { roundUpTo90 } from '@/lib/domain/pricing'
import { formatBRL, formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { friendlyDbError, supabase } from '@/lib/supabase'
import { ProductList } from './ProductList'
import { getCostSummary } from '@/modules/invoices/api'
import { listMarketplaces, listProductListings } from '@/modules/listings/api'
import {
  applyPriceToListing, chargesShipping, listPricingRules, shippingMissing, listSimulations, ruleLabel, ruleWarnings, saveSimulation, simulate, type PricingRule,
} from './api'
import { BreakdownTable, EstimateNote, marginTone, pct } from './components'
import { RuleFormModal } from './RuleFormModal'

const parse = (s: string) => { try { return parseBrDecimal(s)?.toNumber() ?? null } catch { return null } }
const show = (v: number | null | undefined) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','))

export function PricingPage() {
  const [tab, setTab] = useState<'simulador' | 'regras'>('simulador')
  return (
    <>
      <PageHeader title="Precificação" description="Preço de venda e margem estimados por canal, com as regras cadastradas. Nada é alterado nos canais." />
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {([['simulador', 'Simulador'], ['regras', 'Regras por canal']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === k ? 'border-accent font-medium' : 'border-transparent text-muted hover:text-ink')}>{l}</button>
        ))}
      </div>
      {tab === 'simulador' ? <Simulator /> : <RulesTab />}
    </>
  )
}

// ---------------------------------------------------------------------
// Simulador
// ---------------------------------------------------------------------
function Simulator() {
  const [params, setParams] = useSearchParams()
  const productId = params.get('produto')
  const select = useCallback((id: string) => setParams({ produto: id }, { replace: true }), [setParams])
  const [manualCost, setManualCost] = useState('')
  const [target, setTarget] = useState('')

  const product = useQuery({
    queryKey: ['pricing-product', productId], enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id, commercial_name, nf_description, internal_sku').eq('id', productId!).maybeSingle()
      if (error) throw error
      return data as { id: string; commercial_name: string | null; nf_description: string | null; internal_sku: string | null } | null
    },
  })
  const cost = useQuery({ queryKey: ['cost-summary', productId], queryFn: () => getCostSummary(productId!), enabled: !!productId })
  const rules = useQuery({ queryKey: ['pricing-rules', 'active'], queryFn: () => listPricingRules({ activeOnly: true }) })
  const listings = useQuery({ queryKey: ['product-listings', productId], queryFn: () => listProductListings(productId!), enabled: !!productId })

  useEffect(() => { setManualCost(''); setTarget('') }, [productId])

  const avg = cost.data?.average_unit_cost ?? null
  const manual = parse(manualCost)
  const usedCost = manual ?? avg
  const costSource: 'custo_medio' | 'manual' = manual != null ? 'manual' : 'custo_medio'

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
    <ProductList selectedId={productId} onSelect={select} />
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Produto" className="min-w-60 flex-1">
            <div className="flex h-9 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {product.data ? <Link to={`/produtos/${product.data.id}`} className="font-medium hover:text-accent hover:underline">
                  {product.data.commercial_name || product.data.nf_description}</Link> : <span className="text-muted">Escolha na lista ao lado</span>}
                {product.data?.internal_sku && <span className="ml-2 font-mono text-xs text-muted">{product.data.internal_sku}</span>}
              </span>
            </div>
          </Field>
          {productId && (<>
            <Field label="Custo médio de aquisição">
              <div className="tabular flex h-9 items-center text-sm font-medium">{cost.isPending ? '…' : avg != null ? formatBRL(avg) : <Badge tone="warn">sem compras registradas</Badge>}</div>
            </Field>
            <Field label="Simular com outro custo (R$)" htmlFor="s_cost" hint="Opcional; não muda o cadastro">
              <Input id="s_cost" className="tabular w-36" inputMode="decimal" value={manualCost} onChange={(e) => setManualCost(e.target.value)} placeholder={avg != null ? show(avg) : ''} />
            </Field>
            <Field label="Margem desejada (%)" htmlFor="s_target" hint="Vazio = a da regra">
              <Input id="s_target" className="tabular w-28" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </Field>
          </>)}
        </div>
      </Card>

      {!productId ? (
        <EmptyState title="Escolha um produto para simular" description="Clique num produto da lista. O custo médio vem das notas importadas. Cada canal mostra o preço mínimo para a margem desejada e o resultado de um preço que você digitar." />
      ) : rules.isPending ? <Spinner /> : rules.isError ? <ErrorState message={friendlyDbError(rules.error)} /> : usedCost == null ? (
        <ErrorState message="Este produto ainda não tem custo de aquisição (nenhuma nota importada). Informe um custo para simular." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-sunk text-left text-xs text-muted">
                <tr>
                  <th className="w-8" />
                  <th className="px-3 py-2 font-medium">Canal · regra</th>
                  <th className="px-3 py-2 text-right font-medium">Preço mínimo p/ margem</th>
                  <th className="px-3 py-2 font-medium">Frete (R$)</th>
                  <th className="px-3 py-2 font-medium">Preço simulado</th>
                  <th className="px-3 py-2 text-right font-medium">Lucro</th>
                  <th className="px-3 py-2 text-right font-medium">Margem</th>
                  <th className="px-3 py-2 text-right font-medium">Markup</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.data.map((r) => (
                  <RuleRow key={r.id} rule={r} productId={productId} cost={usedCost} costSource={costSource} target={parse(target)}
                    listing={listings.data?.find((l) => l.marketplace_id === r.marketplace_id && l.status !== 'arquivado' && (!l.pricing_rule_id || l.pricing_rule_id === r.id))} />
                ))}
              </tbody>
            </table>
          </div>
          <EstimateNote />
          <SimulationHistory productId={productId} />
        </>
      )}
    </div>
    </div>
  )
}

function RuleRow({ rule, productId, cost, costSource, target, listing }: {
  rule: PricingRule; productId: string; cost: number; costSource: 'custo_medio' | 'manual'; target: number | null
  listing?: { id: string; suggested_price: number | null; shipping_cost: number | null; title: string | null }
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [ship, setShip] = useState('')
  useEffect(() => { setShip(listing?.shipping_cost != null ? show(listing.shipping_cost) : '') }, [listing?.shipping_cost])
  const shipping = ship.trim() ? parse(ship) : null
  const base = simulate(rule, cost, 1, { shipping, target: target ?? undefined })
  const min = base.min.price
  const [price, setPrice] = useState('')
  useEffect(() => { setPrice(show(listing?.suggested_price ?? (min != null ? roundUpTo90(min) : null))) }, [listing?.suggested_price, min])
  const p = parse(price)
  const sim = p && p > 0 ? simulate(rule, cost, p, { shipping, target: target ?? undefined }) : null
  const warns = ruleWarnings(rule)

  const save = useMutation({
    mutationFn: (apply: boolean) => apply
      ? applyPriceToListing({ listingId: listing!.id, productId, rule, cost, price: p!, shipping, target: target ?? undefined })
      : saveSimulation({ productId, rule, cost, costSource, price: p!, shipping, target: target ?? undefined }),
    onSuccess: (_, apply) => {
      qc.invalidateQueries({ queryKey: ['simulations', productId] })
      if (apply) { qc.invalidateQueries({ queryKey: ['product-listings', productId] }); qc.invalidateQueries({ queryKey: ['listing'] }); qc.invalidateQueries({ queryKey: ['showcase'] }) }
      toast(apply ? 'Preço aplicado no anúncio (só aqui; nada muda no canal).' : 'Simulação registrada.')
    },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  return (
    <Fragment>
      <tr className="border-t border-line align-top">
        <td className="py-2.5 pl-3">
          <button type="button" aria-label={open ? 'Fechar detalhamento' : 'Ver detalhamento'} onClick={() => setOpen((o) => !o)} className="text-muted hover:text-ink">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </td>
        <td className="px-3 py-2.5">
          <div className="font-medium">{ruleLabel(rule)}</div>
          {warns.length > 0 && <div className="text-xs text-warn">Regra incompleta: {warns.join(', ')}</div>}
          {listing && <div className="text-xs text-muted">Anúncio: {listing.suggested_price != null ? formatBRL(listing.suggested_price) : 'sem preço'}</div>}
        </td>
        <td className="tabular px-3 py-2.5 text-right">
          {min != null ? (
            <button type="button" className="hover:text-accent hover:underline" title="Usar este preço (arredondado para ,90)" onClick={() => setPrice(show(roundUpTo90(min)))}>
              {formatBRL(min)}
            </button>
          ) : <span className="text-xs text-bad">{base.min.reason}</span>}
          <div className="text-xs text-muted">margem {pct(base.target)}</div>
        </td>
        <td className="px-3 py-2.5">
          <Input aria-label={`Frete ${ruleLabel(rule)}`} className="tabular h-8 w-24" inputMode="decimal" value={ship} onChange={(e) => setShip(e.target.value)}
            placeholder={Number(rule.shipping_fee) > 0 ? show(rule.shipping_fee) : '0,00'} />
          {shippingMissing(rule, shipping, p) && <div className="mt-0.5 text-xs text-warn">informe o frete</div>}
          {ship.trim() && shipping == null && <div className="mt-0.5 text-xs text-bad">valor inválido</div>}
        </td>
        <td className="px-3 py-2.5"><Input aria-label={`Preço simulado ${ruleLabel(rule)}`} className="tabular h-8 w-28" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></td>
        <td className={cn('tabular px-3 py-2.5 text-right', sim && sim.result.profit < 0 && 'text-bad')}>{sim ? formatBRL(sim.result.profit) : '—'}</td>
        <td className={cn('tabular px-3 py-2.5 text-right font-medium', marginTone(sim?.result.marginPct, base.target))}>{sim ? pct(sim.result.marginPct) : '—'}</td>
        <td className="tabular px-3 py-2.5 text-right">{sim?.result.markup != null ? `${formatNumber(sim.result.markup, 2)}×` : '—'}</td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap">
          <Button size="sm" variant="ghost" disabled={!sim} loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>Registrar</Button>
          {listing && costSource === 'custo_medio' && (
            <Button size="sm" disabled={!sim} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>Aplicar no anúncio</Button>
          )}
        </td>
      </tr>
      {open && sim && (
        <tr className="bg-sunk/40">
          <td />
          <td colSpan={8} className="px-3 py-3">
            <div className="grid gap-4 md:grid-cols-[320px_1fr]">
              <BreakdownTable b={sim.result} compact />
              <div className="text-xs text-muted">
                <p>Regra v{rule.version}{rule.checked_on && `, tarifas conferidas em ${formatDate(rule.checked_on + 'T12:00')}`}.</p>
                {rule.notes && <p className="mt-1">{rule.notes}</p>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function SimulationHistory({ productId }: { productId: string }) {
  const list = useQuery({ queryKey: ['simulations', productId], queryFn: () => listSimulations(productId) })
  if (list.isPending || !list.data?.length) return null
  return (
    <Card title="Histórico de simulações" actions={<History className="size-4 text-muted" aria-hidden />}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr><th className="py-1 font-medium">Data</th><th className="py-1 font-medium">Regra</th><th className="py-1 text-right font-medium">Custo usado</th>
            <th className="py-1 text-right font-medium">Preço</th><th className="py-1 text-right font-medium">Lucro</th><th className="py-1 text-right font-medium">Margem</th><th /></tr>
        </thead>
        <tbody>
          {list.data.map((s) => (
            <tr key={s.id} className="border-t border-line">
              <td className="tabular py-1.5">{formatDateTime(s.created_at)}</td>
              <td className="py-1.5">{s.rule ? `${s.rule.marketplace.name} · ${s.rule.name} v${s.rule.version}` : '—'}</td>
              <td className="tabular py-1.5 text-right">{formatBRL(s.unit_cost)}{s.cost_source === 'manual' && <span className="text-xs text-muted"> (manual)</span>}</td>
              <td className="tabular py-1.5 text-right">{formatBRL(s.price)}</td>
              <td className="tabular py-1.5 text-right">{formatBRL(s.profit)}</td>
              <td className="tabular py-1.5 text-right">{pct(s.margin_pct)}</td>
              <td className="py-1.5 text-right">{s.applied && <Badge tone="accent">aplicado</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// ---------------------------------------------------------------------
// Regras por canal
// ---------------------------------------------------------------------
function RulesTab() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const rules = useQuery({ queryKey: ['pricing-rules', 'all'], queryFn: () => listPricingRules() })
  const markets = useQuery({ queryKey: ['marketplaces'], queryFn: listMarketplaces })
  const [editing, setEditing] = useState<PricingRule | 'nova' | null>(null)
  const [showOld, setShowOld] = useState(false)
  const visible = useMemo(() => (rules.data ?? []).filter((r) => showOld || r.is_active), [rules.data, showOld])

  if (rules.isPending) return <Spinner />
  if (rules.isError) return <ErrorState message={friendlyDbError(rules.error)} onRetry={() => rules.refetch()} />

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted">
          Tarifas e custos usados no cálculo. Mudar uma regra cria uma nova versão; as simulações antigas continuam ligadas à versão que usaram.
          {!isAdmin && ' Somente administradores alteram.'}
        </p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Mostrar versões antigas</label>
        {isAdmin && <Button variant="primary" onClick={() => setEditing('nova')}><Plus className="size-4" aria-hidden /> Nova regra</Button>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((r) => {
          const warns = ruleWarnings(r)
          return (
            <Card key={r.id} title={`${ruleLabel(r)} · v${r.version}`}
              actions={<div className="flex items-center gap-2">
                {r.is_active ? <Badge tone="good">Ativa</Badge> : <Badge>Antiga</Badge>}
                {isAdmin && r.is_active && <Button size="sm" onClick={() => setEditing(r)}>Alterar</Button>}
              </div>}>
              <table className="mb-3 w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="font-medium">Preço a partir de</th><th className="text-right font-medium">Comissão</th><th className="text-right font-medium">Tarifa fixa</th></tr></thead>
                <tbody>
                  {[...r.tiers].sort((a, b) => a.min_price - b.min_price).map((t) => (
                    <tr key={t.min_price} className="border-t border-line"><td className="tabular py-1">{formatBRL(t.min_price)}</td>
                      <td className="tabular py-1 text-right">{pct(t.commission_pct)}</td><td className="tabular py-1 text-right">{formatBRL(t.fixed_fee)}</td></tr>
                  ))}
                </tbody>
              </table>
              <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 text-sm">
                <dt className="text-muted">Frete por sua conta</dt><dd className="tabular">{chargesShipping(r)
                  ? `informado por produto${r.shipping_min_price != null ? `, a partir de ${formatBRL(r.shipping_min_price)}` : ''}${Number(r.shipping_fee) > 0 ? ` (padrão ${formatBRL(r.shipping_fee)})` : ''}`
                  : 'não cobrado'}</dd>
                <dt className="text-muted">Outras taxas do canal</dt><dd className="tabular">{pct(r.extra_pct)}</dd>
                <dt className="text-muted">Impostos sobre a venda</dt><dd className="tabular">{pct(r.tax_pct)}</dd>
                <dt className="text-muted">Embalagem</dt><dd className="tabular">{formatBRL(r.packaging_cost)}</dd>
                <dt className="text-muted">Outros custos</dt><dd className="tabular">{formatBRL(r.other_fixed)} + {pct(r.other_pct)}</dd>
                <dt className="text-muted">Margem desejada</dt><dd className="tabular">{pct(r.target_margin_pct)}</dd>
              </dl>
              {warns.length > 0 && <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">A preencher: {warns.join(', ')}.</p>}
              {r.notes && <p className="mt-2 text-xs text-muted">{r.notes}</p>}
              <p className="mt-1 text-xs text-muted">{r.checked_on ? `Tarifas conferidas em ${formatDate(r.checked_on + 'T12:00')}.` : 'Tarifas nunca conferidas.'} Criada em {formatDateTime(r.created_at)}.</p>
            </Card>
          )
        })}
      </div>
      <RuleFormModal open={!!editing} base={editing === 'nova' ? null : editing} markets={markets.data ?? []} onClose={() => setEditing(null)} />
    </div>
  )
}
