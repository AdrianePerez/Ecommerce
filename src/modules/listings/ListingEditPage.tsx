import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, RefreshCw, Star } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea, cn } from '@/components/ui'
import { roundUpTo90 } from '@/lib/domain/pricing'
import { lastAppliedSimulation, listPricingRules, ruleWarnings, saveSimulation, simulate } from '@/modules/pricing/api'
import { BreakdownTable, EstimateNote } from '@/modules/pricing/components'
import { useToast } from '@/components/ui/toast'
import { parseBrDecimal } from '@/lib/domain/numbers'
import { formatBRL, formatDateTime, formatNumber } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { getCostSummary } from '@/modules/invoices/api'
import { listProductImages, signedImageUrls } from '@/modules/images/api'
import { moveInList, thumbOf } from '@/modules/images/imageModel'
import { listAttributes } from '@/modules/products/api'
import {
  getListing, listListingImages, listMarketplaces, listingIssues, setListingImages, suggestionsFor, updateListing,
  type Listing, type ListingPatch, type MarketplaceConfig,
} from './api'
import { LISTING_STATUS_LABEL, LISTING_STATUS_TONE, REQUIRED_FIELD_LABEL, parseKeywords, type ListingStatus } from './listingModel'

export function ListingEditPage() {
  const { id } = useParams()
  const listing = useQuery({ queryKey: ['listing', id], queryFn: () => getListing(id!) })
  const markets = useQuery({ queryKey: ['marketplaces'], queryFn: listMarketplaces })
  const assets = useQuery({ queryKey: ['listing-images', id], queryFn: () => listListingImages(id!) })

  if (listing.isPending || markets.isPending || assets.isPending) return <Spinner />
  if (listing.isError) return <ErrorState message={friendlyDbError(listing.error)} onRetry={() => listing.refetch()} />
  if (!listing.data) return <ErrorState message="Anúncio não encontrado." />
  if (markets.isError || assets.isError) return <ErrorState message="Não foi possível carregar as regras do canal ou as imagens do anúncio." />
  const m = markets.data.find((x) => x.id === listing.data!.marketplace_id)
  if (!m) return <ErrorState message="Canal do anúncio não encontrado." />
  return <Editor key={listing.data.updated_at} listing={listing.data} market={m} assetIds={assets.data} />
}

type Form = {
  title: string; description: string; category_suggested: string; category_external_id: string; keywords: string
  price: string; rule_id: string; shipping: string; attributes: Record<string, string>; external_id: string; external_url: string; notes: string
}
const dec = (v: number | null) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','))
const toForm = (l: Listing): Form => ({
  title: l.title ?? '', description: l.description ?? '', category_suggested: l.category_suggested ?? '',
  category_external_id: l.category_external_id ?? '', keywords: l.keywords.join(', '),
  price: dec(l.suggested_price), rule_id: l.pricing_rule_id ?? '', shipping: dec(l.shipping_cost), attributes: { ...l.attributes },
  external_id: l.external_id ?? '', external_url: l.external_url ?? '', notes: l.notes ?? '',
})

function Editor({ listing, market, assetIds }: { listing: Listing; market: MarketplaceConfig; assetIds: string[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState<Form>(() => toForm(listing))
  const [mainId, setMainId] = useState<string | null>(listing.main_image_id)
  const [extra, setExtra] = useState<string[]>(assetIds)
  const [error, setError] = useState<string | null>(null)

  const initial = useMemo(() => JSON.stringify([toForm(listing), listing.main_image_id, assetIds]), [listing, assetIds])
  const [autoRule, setAutoRule] = useState<string | null>(null)
  const formForDirty = autoRule && form.rule_id === autoRule ? { ...form, rule_id: '' } : form
  const dirty = JSON.stringify([formForDirty, mainId, extra]) !== initial
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const issues = useQuery({ queryKey: ['listing-issues', listing.id, listing.updated_at], queryFn: () => listingIssues(listing.id) })
  const images = useQuery({ queryKey: ['product-images', listing.product_id], queryFn: () => listProductImages(listing.product_id) })
  const approved = (images.data ?? []).filter((i) => i.status === 'aprovada' && i.rights !== 'nao_autorizada')
  const thumbs = useQuery({
    queryKey: ['image-thumbs-listing', approved.map((i) => i.id).join(',')],
    queryFn: () => signedImageUrls(approved.map((i) => thumbOf(i.storage_path))),
    enabled: approved.length > 0, staleTime: 50 * 60 * 1000,
  })
  const cost = useQuery({ queryKey: ['cost-summary', listing.product_id], queryFn: () => getCostSummary(listing.product_id) })
  const attrs = useQuery({ queryKey: ['attributes', listing.product_id], queryFn: () => listAttributes(listing.product_id) })
  const catalogPrice = attrs.data?.find((a) => a.attr_key === 'preco_sugerido_catalogo' && a.validation_status === 'confirmada')?.value_num
  const product = useQuery({ queryKey: ['listing-suggestions', listing.id], queryFn: () => suggestionsFor(listing, market) })

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  // Precificação: regras do canal (ativas + a que o anúncio já usa)
  const rules = useQuery({ queryKey: ['pricing-rules', 'all'], queryFn: () => listPricingRules() })
  const marketRules = (rules.data ?? []).filter((r) => r.marketplace_id === listing.marketplace_id && (r.is_active || r.id === listing.pricing_rule_id))
  const rule = marketRules.find((r) => r.id === form.rule_id) ?? null
  useEffect(() => {
    if (form.rule_id || !marketRules.length) return
    const def = marketRules.find((r) => r.is_active)?.id
    if (def) { setAutoRule(def); setForm((f) => (f.rule_id ? f : { ...f, rule_id: def })) }
  }, [marketRules, form.rule_id])
  const lastApplied = useQuery({ queryKey: ['last-applied', listing.id, listing.updated_at], queryFn: () => lastAppliedSimulation(listing.id) })
  const avgCost = cost.data?.average_unit_cost ?? null
  const num = (s: string) => { try { return parseBrDecimal(s)?.toNumber() ?? null } catch { return null } }
  const priceNum = num(form.price)
  const shippingNum = form.shipping.trim() ? num(form.shipping) : null
  const sim = rule && avgCost ? simulate(rule, avgCost, priceNum && priceNum > 0 ? priceNum : 1, { shipping: shippingNum }) : null

  const save = useMutation({
    mutationFn: async (status?: ListingStatus) => {
      let price: number | null = null
      try { price = parseBrDecimal(form.price)?.toNumber() ?? null } catch { throw new Error('Preço inválido. Use o formato 159,90.') }
      if (form.external_url.trim() && !/^https?:\/\//i.test(form.external_url.trim())) throw new Error('O link do anúncio publicado precisa começar com https://.')
      const extraClean = extra.filter((x) => x !== mainId)
      if (JSON.stringify(extraClean) !== JSON.stringify(assetIds)) await setListingImages(listing.id, extraClean)
      const attributes = Object.fromEntries(Object.entries(form.attributes).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
      const patch: ListingPatch = {
        title: form.title.trim() || null, description: form.description.trim() || null,
        category_suggested: form.category_suggested.trim() || null, category_external_id: form.category_external_id.trim() || null,
        keywords: parseKeywords(form.keywords), suggested_price: price, attributes, main_image_id: mainId,
        external_id: form.external_id.trim() || null, external_url: form.external_url.trim() || null, notes: form.notes.trim() || null,
      }
      if (form.shipping.trim() && shippingNum == null) throw new Error('Frete inválido. Use o formato 18,50.')
      patch.pricing_rule_id = form.rule_id || null
      patch.shipping_cost = shippingNum
      if (status) patch.status = status
      const saved = await updateListing(listing.id, patch, listing.updated_at)
      // Registra a simulação do preço aplicado (custo e versão da regra usados)
      const changed = price !== listing.suggested_price || (form.rule_id || null) !== listing.pricing_rule_id || shippingNum !== listing.shipping_cost
        || (lastApplied.data && avgCost != null && Number(lastApplied.data.unit_cost) !== Number(avgCost))
      if (price && rule && avgCost && changed) {
        await saveSimulation({ productId: listing.product_id, listingId: listing.id, rule, cost: avgCost, costSource: 'custo_medio',
          price, shipping: shippingNum, applied: true })
      }
      return saved
    },
    onSuccess: (saved, status) => {
      setError(null)
      qc.setQueryData(['listing', listing.id], saved)
      qc.invalidateQueries({ queryKey: ['listing-images', listing.id] })
      qc.invalidateQueries({ queryKey: ['listings'] })
      qc.invalidateQueries({ queryKey: ['listing-counts'] })
      qc.invalidateQueries({ queryKey: ['product-listings', listing.product_id] })
      qc.invalidateQueries({ queryKey: ['simulations', listing.product_id] })
      qc.invalidateQueries({ queryKey: ['showcase'] })
      toast(status ? `Anúncio: ${LISTING_STATUS_LABEL[status]}.` : 'Anúncio salvo.')
    },
    onError: (e: Error) => {
      const m = e.message.match(/ANUNCIO_INCOMPLETO:(.*)/)
      setError(m ? `Para marcar como pronto, resolva: ${m[1]}.` : friendlyDbError(e))
      qc.invalidateQueries({ queryKey: ['listing-images', listing.id] })
    },
  })

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copiado.`) } catch { toast('Não foi possível copiar. Selecione o texto e use Ctrl+C.', 'bad') }
  }
  function suggest(field: 'title' | 'description') {
    const v = product.data?.[field]
    if (!v) return toast('O cadastro ainda não tem dados suficientes para sugerir.', 'bad')
    if (form[field].trim() && !confirm('Substituir o texto atual pela sugestão montada a partir do cadastro?')) return
    set(field, v)
  }
  function fillAttrs() {
    const s = product.data?.attributes ?? {}
    setForm((f) => ({ ...f, attributes: { ...s, ...Object.fromEntries(Object.entries(f.attributes).filter(([, v]) => v.trim())) } }))
  }

  const titleLen = form.title.trim().length
  const descLen = form.description.trim().length
  const kw = parseKeywords(form.keywords)
  const nImages = (mainId ? 1 : 0) + extra.filter((x) => x !== mainId).length
  const req = (k: string) => market.required_fields.includes(k)
  const s = listing.status
  const productName = product.data?.product.commercial_name || product.data?.product.nf_description || 'Produto'

  const attrText = market.attribute_fields.map((f) => form.attributes[f.key]?.trim() ? `${f.label}: ${form.attributes[f.key].trim()}` : null).filter(Boolean).join('\n')

  return (
    <>
      <Link to="/preparacao" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="size-4" aria-hidden /> Central de preparação
      </Link>
      <PageHeader
        title={`${market.name}${listing.variant_label ? ` · ${listing.variant_label}` : ''}`}
        description={<span className="flex flex-wrap items-center gap-2">
          <Badge tone={LISTING_STATUS_TONE[s]}>{LISTING_STATUS_LABEL[s]}</Badge>
          <Link to={`/produtos/${listing.product_id}?aba=anuncios`} className="hover:text-accent hover:underline">{productName}</Link>
          {listing.last_reviewed_at && <span>· revisado em {formatDateTime(listing.last_reviewed_at)}</span>}
        </span>}
        actions={<Button variant="primary" loading={save.isPending && !save.variables} disabled={!dirty} onClick={() => save.mutate(undefined)}>Salvar</Button>}
      />
      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <Card title="Texto do anúncio">
            <div className="flex flex-col gap-4">
              <Field label={`Título${req('title') ? ' *' : ''}`} htmlFor="l_title"
                hint={<Counter n={titleLen} min={market.title_min} max={market.title_max} />}>
                <Input id="l_title" value={form.title} onChange={(e) => set('title', e.target.value)}
                  aria-invalid={market.title_max != null && titleLen > market.title_max ? true : undefined} />
              </Field>
              <Actions>
                <Button size="sm" onClick={() => suggest('title')}><RefreshCw className="size-3.5" aria-hidden /> Sugerir pelo cadastro</Button>
                <Button size="sm" variant="ghost" disabled={!titleLen} onClick={() => copy(form.title.trim(), 'Título')}><Copy className="size-3.5" aria-hidden /> Copiar</Button>
              </Actions>
              <Field label={`Descrição${req('description') ? ' *' : ''}`} htmlFor="l_desc"
                hint={<>{market.description_plain_text ? 'Somente texto, sem HTML. ' : ''}<Counter n={descLen} max={market.description_max} /></>}>
                <Textarea id="l_desc" rows={14} className="min-h-72 font-[inherit]" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
              <Actions>
                <Button size="sm" onClick={() => suggest('description')}><RefreshCw className="size-3.5" aria-hidden /> Sugerir pelo cadastro</Button>
                <Button size="sm" variant="ghost" disabled={!descLen} onClick={() => copy(form.description.trim(), 'Descrição')}><Copy className="size-3.5" aria-hidden /> Copiar</Button>
              </Actions>
              <p className="text-xs text-muted">As sugestões usam apenas o cadastro mestre e os atributos confirmados. Revise antes de publicar.</p>
            </div>
          </Card>

          <Card title="Categoria e palavras-chave">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Categoria${req('category') ? ' *' : ''}`} htmlFor="l_cat" hint="Como aparece no canal (ex.: Mochilas escolares)">
                <Input id="l_cat" value={form.category_suggested} onChange={(e) => set('category_suggested', e.target.value)} />
              </Field>
              <Field label="Código da categoria no canal" htmlFor="l_catid" hint="Opcional (ex.: MLB12345)">
                <Input id="l_catid" value={form.category_external_id} onChange={(e) => set('category_external_id', e.target.value)} />
              </Field>
              <Field className="sm:col-span-2" label={`Palavras-chave${req('keywords') ? ' *' : ''}`} htmlFor="l_kw"
                hint={<>Separe por vírgula. <Counter n={kw.length} max={market.keywords_max} unit="palavra(s)" /></>}>
                <Input id="l_kw" value={form.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="mochila escolar, mochila infantil" />
              </Field>
            </div>
          </Card>

          <Card title="Atributos do canal" actions={<div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={fillAttrs}>Preencher vazios com o cadastro</Button>
            <Button size="sm" variant="ghost" disabled={!attrText} onClick={() => copy(attrText, 'Atributos')}><Copy className="size-3.5" aria-hidden /> Copiar</Button>
          </div>}>
            {market.attribute_fields.length === 0 ? <p className="text-sm text-muted">Nenhum atributo configurado para este canal (Configurações → Marketplaces).</p> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {market.attribute_fields.map((f) => (
                  <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} htmlFor={`attr_${f.key}`}>
                    <Input id={`attr_${f.key}`} value={form.attributes[f.key] ?? ''}
                      onChange={(e) => set('attributes', { ...form.attributes, [f.key]: e.target.value })} />
                  </Field>
                ))}
              </div>
            )}
          </Card>

          <Card title="Imagens do anúncio" actions={<Link to={`/produtos/${listing.product_id}?aba=imagens`} className="text-[13px] text-accent hover:underline">Imagens do produto</Link>}>
            {images.isPending ? <Spinner /> : approved.length === 0 ? (
              <p className="text-sm text-muted">Este produto ainda não tem imagens aprovadas. Aprove na aba Imagens do produto.</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted">
                  Clique para incluir ou tirar. ★ define a principal. <span className="tabular">{nImages}</span> de no máximo {market.images_max ?? '—'} · mínimo {market.images_min}.
                </p>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                  {approved.map((img) => {
                    const on = img.id === mainId || extra.includes(img.id)
                    const pos = img.id === mainId ? 1 : extra.filter((x) => x !== mainId).indexOf(img.id) + (mainId ? 2 : 1)
                    const ei = extra.indexOf(img.id)
                    return (
                      <li key={img.id} className={cn('relative overflow-hidden rounded-md border', on ? 'border-accent ring-2 ring-accent/30' : 'border-line opacity-60')}>
                        <button type="button" className="flex aspect-square w-full items-center justify-center bg-sunk"
                          aria-pressed={on} aria-label={on ? 'Tirar do anúncio' : 'Incluir no anúncio'}
                          onClick={() => {
                            if (img.id === mainId) { setMainId(null); return }
                            setExtra((x) => (x.includes(img.id) ? x.filter((y) => y !== img.id) : [...x, img.id]))
                          }}>
                          {thumbs.data?.get(thumbOf(img.storage_path))
                            ? <img src={thumbs.data.get(thumbOf(img.storage_path))} alt="" className="h-full w-full object-contain" />
                            : <span className="text-xs text-muted">…</span>}
                        </button>
                        {on && <span className="tabular absolute top-1 left-1 rounded bg-ink/70 px-1 text-[11px] text-white">{pos}</span>}
                        <div className="flex items-center justify-between bg-surface px-1 py-0.5">
                          <button type="button" title="Definir como principal" aria-label="Definir como principal"
                            onClick={() => { if (mainId && mainId !== img.id) setExtra((x) => [mainId, ...x.filter((y) => y !== img.id)]); setMainId(img.id) }}
                            className={cn('rounded p-0.5', img.id === mainId ? 'text-accent' : 'text-muted hover:text-ink')}>
                            <Star className={cn('size-3.5', img.id === mainId && 'fill-current')} />
                          </button>
                          {ei >= 0 && img.id !== mainId && (
                            <span className="flex">
                              <button type="button" aria-label="Mover para trás" className="p-0.5 text-muted hover:text-ink disabled:opacity-30" disabled={ei === 0}
                                onClick={() => setExtra((x) => moveInList(x, ei, -1))}><ArrowLeft className="size-3.5" /></button>
                              <button type="button" aria-label="Mover para frente" className="p-0.5 text-muted hover:text-ink disabled:opacity-30" disabled={ei === extra.length - 1}
                                onClick={() => setExtra((x) => moveInList(x, ei, 1))}><ArrowRight className="size-3.5" /></button>
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </Card>

          <Card title="Publicação manual">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Código do anúncio no canal" htmlFor="l_extid"><Input id="l_extid" value={form.external_id} onChange={(e) => set('external_id', e.target.value)} placeholder="Ex.: MLB1234567890" /></Field>
              <Field label="Link do anúncio publicado" htmlFor="l_exturl"><Input id="l_exturl" value={form.external_url} onChange={(e) => set('external_url', e.target.value)} placeholder="https://" /></Field>
              <Field className="sm:col-span-2" label="Observações" htmlFor="l_notes"><Textarea id="l_notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            </div>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-0 xl:self-start">
          <Card title="Preço" actions={<Link to={`/precificacao?produto=${listing.product_id}`} className="text-[13px] text-accent hover:underline">Simulador</Link>}>
            <div className="flex flex-col gap-3">
              <Field label="Regra de preço" htmlFor="l_rule">
                <Select id="l_rule" value={form.rule_id} onChange={(e) => set('rule_id', e.target.value)}>
                  {!marketRules.length && <option value="">Nenhuma regra para este canal</option>}
                  {marketRules.map((r) => <option key={r.id} value={r.id}>{r.name} (v{r.version}{r.is_active ? '' : ', antiga'})</option>)}
                </Select>
              </Field>
              {rule && ruleWarnings(rule).length > 0 && (
                <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">Regra incompleta: {ruleWarnings(rule).join(', ')}. Ajuste em Precificação → Regras por canal.</p>
              )}
              {rule?.shipping_min_price != null || rule?.shipping_fee ? (
                <Field label="Frete por sua conta neste anúncio (R$)" htmlFor="l_ship" hint={`Vazio = ${formatBRL(rule?.shipping_fee ?? 0)} da regra`}>
                  <Input id="l_ship" inputMode="decimal" className="tabular" value={form.shipping} onChange={(e) => set('shipping', e.target.value)} />
                </Field>
              ) : null}
              <Field label={`Preço de venda${req('price') ? ' *' : ''}`} htmlFor="l_price">
                <Input id="l_price" inputMode="decimal" className="tabular" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="0,00" />
              </Field>
              {sim?.min.price != null && (
                <Button size="sm" onClick={() => set('price', dec(roundUpTo90(sim.min.price!)))}>
                  Usar {formatBRL(roundUpTo90(sim.min.price))} (margem {formatNumber(sim.target, 1)}%)
                </Button>
              )}
              {sim && sim.min.price == null && <p className="text-xs text-bad">{sim.min.reason}</p>}
              {avgCost == null ? (
                <p className="text-xs text-warn">Sem custo de aquisição (nenhuma nota importada): não dá para calcular a margem.</p>
              ) : sim && priceNum ? <BreakdownTable b={sim.result} compact /> : (
                <p className="text-xs text-muted">Custo médio {formatBRL(avgCost)}. Digite o preço para ver a margem.</p>
              )}
              {lastApplied.data && avgCost != null && Number(lastApplied.data.unit_cost) !== Number(avgCost) && (
                <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                  O custo médio mudou desde o último preço ({formatBRL(lastApplied.data.unit_cost)} → {formatBRL(avgCost)}). A margem acima já usa o custo atual.
                </p>
              )}
              <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                <dt className="text-muted">Preço sugerido no catálogo</dt><dd className="tabular">{catalogPrice != null ? formatBRL(catalogPrice) : '—'}</dd>
              </dl>
              <EstimateNote />
            </div>
          </Card>

          <Card title="Verificação do canal" actions={dirty ? <Badge tone="warn">alterações não salvas</Badge> : undefined}>
            {issues.isPending ? <Spinner /> : issues.isError ? <ErrorState message={friendlyDbError(issues.error)} /> : issues.data.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-good"><Check className="size-4" aria-hidden /> Tudo que o canal exige está preenchido.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {issues.data.map((i) => <li key={i} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />{i}</li>)}
              </ul>
            )}
            {dirty && <p className="mt-2 text-xs text-muted">A verificação considera a última versão salva.</p>}
            <p className="mt-3 text-xs text-muted">
              Exigidos: {market.required_fields.map((f) => REQUIRED_FIELD_LABEL[f] ?? f).join(', ')}.
              {market.rules_notes && <> {market.rules_notes}</>}
              {market.rules_checked_on && <> Regras conferidas em {new Date(market.rules_checked_on + 'T12:00').toLocaleDateString('pt-BR')}.</>}
            </p>
          </Card>

          <Card title="Situação">
            <div className="flex flex-col gap-2">
              {(s === 'rascunho') && <Button loading={save.isPending && save.variables === 'em_revisao'} onClick={() => save.mutate('em_revisao')}>Salvar e enviar para revisão</Button>}
              {(s === 'rascunho' || s === 'em_revisao') && (
                <Button variant="primary" loading={save.isPending && save.variables === 'pronto_para_publicar'} onClick={() => save.mutate('pronto_para_publicar')}>
                  Marcar como pronto para publicar</Button>
              )}
              {s === 'pronto_para_publicar' && (
                <Button variant="primary" loading={save.isPending && save.variables === 'publicado'}
                  onClick={() => { if (!form.external_url.trim() && !form.external_id.trim() && !confirm('Marcar como publicado sem o código ou link do anúncio?')) return; save.mutate('publicado') }}>
                  Já publiquei no canal</Button>
              )}
              {(s === 'pronto_para_publicar' || s === 'publicado' || s === 'em_revisao') && (
                <Button onClick={() => save.mutate('rascunho')}>Voltar para rascunho</Button>
              )}
              {s !== 'arquivado' ? (
                <Button variant="ghost" onClick={() => confirm('Arquivar este anúncio? Ele sai das listas, mas continua guardado.') && save.mutate('arquivado')}>Arquivar</Button>
              ) : <Button onClick={() => save.mutate('rascunho')}>Reativar como rascunho</Button>}
              {listing.external_url && (
                <a href={listing.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                  Abrir anúncio publicado <ExternalLink className="size-3.5" aria-hidden /></a>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="-mt-2 flex flex-wrap gap-1">{children}</div>
}

function Counter({ n, min, max, unit = 'caracteres' }: { n: number; min?: number | null; max?: number | null; unit?: string }) {
  const over = max != null && n > max
  const under = min != null && n > 0 && n < min
  return (
    <span className={cn('tabular', (over || under) && 'font-medium text-bad')}>
      {n}{max != null ? ` / ${max}` : ''} {unit}{under ? ` (mínimo ${min})` : ''}
    </span>
  )
}
