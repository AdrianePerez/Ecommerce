import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, ErrorState, Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { parseBrDecimal } from '@/lib/domain/numbers'
import { validateParams } from '@/lib/domain/pricing'
import { friendlyDbError } from '@/lib/supabase'
import type { MarketplaceConfig } from '@/modules/listings/api'
import { createRuleVersion, type PricingRule } from './api'

type Row = { min: string; com: string; fee: string }
type Form = {
  marketplace_id: string; name: string; tiers: Row[]; shipping_fee: string; shipping_min_price: string; extra_pct: string; tax_pct: string
  packaging_cost: string; other_fixed: string; other_pct: string; target_margin_pct: string; notes: string; checked_on: string
}
const f2 = (v: number | null | undefined) => (v == null ? '' : String(Number(v)).replace('.', ','))

/** Cria uma nova versão da regra (ou uma regra nova). A versão anterior fica guardada. */
export function RuleFormModal({ open, base, markets, onClose }: {
  open: boolean; base: PricingRule | null; markets: MarketplaceConfig[]; onClose: () => void
}) {
  const qc = useQueryClient()
  const [f, setF] = useState<Form | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setError(null)
    setF(base ? {
      marketplace_id: base.marketplace_id, name: base.name,
      tiers: base.tiers.map((t) => ({ min: f2(t.min_price), com: f2(t.commission_pct), fee: f2(t.fixed_fee) })),
      shipping_fee: f2(base.shipping_fee), shipping_min_price: f2(base.shipping_min_price), extra_pct: f2(base.extra_pct), tax_pct: f2(base.tax_pct),
      packaging_cost: f2(base.packaging_cost), other_fixed: f2(base.other_fixed), other_pct: f2(base.other_pct),
      target_margin_pct: f2(base.target_margin_pct), notes: base.notes ?? '', checked_on: base.checked_on ?? '',
    } : {
      marketplace_id: markets.find((m) => m.active)?.id ?? '', name: '', tiers: [{ min: '0', com: '', fee: '0' }],
      shipping_fee: '0', shipping_min_price: '', extra_pct: '0', tax_pct: '0', packaging_cost: '0', other_fixed: '0', other_pct: '0',
      target_margin_pct: '20', notes: '', checked_on: '',
    })
  }, [open, base, markets])

  const save = useMutation({
    mutationFn: () => {
      const num = (s: string, label: string, required = true) => {
        try {
          const d = parseBrDecimal(s)
          if (d === null) { if (required) throw new Error(); return null }
          return d.toNumber()
        } catch { throw new Error(`${label}: valor inválido.`) }
      }
      const tiers = f!.tiers.map((t, i) => ({
        min_price: num(t.min, `Faixa ${i + 1} — a partir de`)!, commission_pct: num(t.com, `Faixa ${i + 1} — comissão`)!,
        fixed_fee: num(t.fee || '0', `Faixa ${i + 1} — tarifa fixa`)!,
      })).sort((a, b) => a.min_price - b.min_price)
      const params = {
        tiers, shipping_fee: num(f!.shipping_fee || '0', 'Frete')!, shipping_min_price: num(f!.shipping_min_price, 'Frete a partir de', false),
        extra_pct: num(f!.extra_pct || '0', 'Outras taxas do canal')!, tax_pct: num(f!.tax_pct || '0', 'Impostos')!,
        packaging_cost: num(f!.packaging_cost || '0', 'Embalagem')!, other_fixed: num(f!.other_fixed || '0', 'Outros custos fixos')!,
        other_pct: num(f!.other_pct || '0', 'Outros %')!, target_margin_pct: num(f!.target_margin_pct || '0', 'Margem desejada')!,
      }
      if (!f!.marketplace_id) throw new Error('Escolha o canal.')
      if (!f!.name.trim()) throw new Error('Dê um nome à regra (ex.: Clássico).')
      const errs = validateParams(params)
      if (errs.length) throw new Error(errs.join(' '))
      return createRuleVersion({ marketplace_id: f!.marketplace_id, name: f!.name, ...params, notes: f!.notes.trim() || null, checked_on: f!.checked_on || null })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pricing-rules'] }); onClose() },
    onError: (e: Error) => setError(friendlyDbError(e)),
  })

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x))
  const setTier = (i: number, k: keyof Row, v: string) => set('tiers', f!.tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)))
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

  return (
    <Modal open={open && !!f} onClose={onClose} wide title={base ? `Nova versão — ${base.marketplace.name} · ${base.name} (atual: v${base.version})` : 'Nova regra de preço'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
        {base ? 'Salvar nova versão' : 'Criar regra'}</Button></>}>
      {f && (
        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} />}
          {base && <p className="text-xs text-muted">A versão atual continua guardada no histórico, e as simulações antigas continuam apontando para ela.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Canal" htmlFor="r_market">
              <Select id="r_market" value={f.marketplace_id} disabled={!!base} onChange={(e) => set('marketplace_id', e.target.value)}>
                <option value="">Escolha…</option>
                {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
            <Field label="Nome (modalidade)" htmlFor="r_name"><Input id="r_name" value={f.name} disabled={!!base} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Clássico" /></Field>
          </div>

          <fieldset>
            <legend className="mb-1 text-[13px] font-medium">Comissão e tarifa fixa por faixa de preço</legend>
            <p className="mb-2 text-xs text-muted">Cada faixa vale a partir do preço indicado até o início da próxima.</p>
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted">
              <span>A partir de (R$)</span><span>Comissão (%)</span><span>Tarifa fixa (R$)</span><span />
            </div>
            {f.tiers.map((t, i) => (
              <div key={i} className="mt-1 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                <Input aria-label={`Faixa ${i + 1} a partir de`} className="tabular" inputMode="decimal" value={t.min} onChange={(e) => setTier(i, 'min', e.target.value)} />
                <Input aria-label={`Faixa ${i + 1} comissão`} className="tabular" inputMode="decimal" value={t.com} onChange={(e) => setTier(i, 'com', e.target.value)} />
                <Input aria-label={`Faixa ${i + 1} tarifa fixa`} className="tabular" inputMode="decimal" value={t.fee} onChange={(e) => setTier(i, 'fee', e.target.value)} />
                <Button size="sm" variant="ghost" className="h-9" aria-label="Remover faixa" disabled={f.tiers.length === 1}
                  onClick={() => set('tiers', f.tiers.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <Button size="sm" className="mt-2" onClick={() => set('tiers', [...f.tiers, { min: '', com: f.tiers.at(-1)?.com ?? '', fee: '0' }])}>
              <Plus className="size-3.5" aria-hidden /> Faixa</Button>
          </fieldset>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Frete por sua conta (R$)" htmlFor="r_ship" hint="Valor médio por venda"><Input id="r_ship" className="tabular" inputMode="decimal" value={f.shipping_fee} onChange={(e) => set('shipping_fee', e.target.value)} /></Field>
            <Field label="Frete a partir de (R$)" htmlFor="r_shipmin" hint="Vazio = sempre"><Input id="r_shipmin" className="tabular" inputMode="decimal" value={f.shipping_min_price} onChange={(e) => set('shipping_min_price', e.target.value)} /></Field>
            <Field label="Outras taxas do canal (%)" htmlFor="r_extra"><Input id="r_extra" className="tabular" inputMode="decimal" value={f.extra_pct} onChange={(e) => set('extra_pct', e.target.value)} /></Field>
            <Field label="Impostos sobre a venda (%)" htmlFor="r_tax"><Input id="r_tax" className="tabular" inputMode="decimal" value={f.tax_pct} onChange={(e) => set('tax_pct', e.target.value)} /></Field>
            <Field label="Embalagem (R$)" htmlFor="r_pack"><Input id="r_pack" className="tabular" inputMode="decimal" value={f.packaging_cost} onChange={(e) => set('packaging_cost', e.target.value)} /></Field>
            <Field label="Outros custos fixos (R$)" htmlFor="r_ofix"><Input id="r_ofix" className="tabular" inputMode="decimal" value={f.other_fixed} onChange={(e) => set('other_fixed', e.target.value)} /></Field>
            <Field label="Outros custos (%)" htmlFor="r_opct"><Input id="r_opct" className="tabular" inputMode="decimal" value={f.other_pct} onChange={(e) => set('other_pct', e.target.value)} /></Field>
            <Field label="Margem desejada (%)" htmlFor="r_margin"><Input id="r_margin" className="tabular" inputMode="decimal" value={f.target_margin_pct} onChange={(e) => set('target_margin_pct', e.target.value)} /></Field>
          </div>
          <Field label="Observações / fonte das tarifas" htmlFor="r_notes"><Textarea id="r_notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <div className="flex items-end gap-2">
            <Field label="Tarifas conferidas em" htmlFor="r_checked"><Input id="r_checked" type="date" value={f.checked_on} onChange={(e) => set('checked_on', e.target.value)} /></Field>
            <Button size="sm" className="mb-0.5" onClick={() => set('checked_on', today)}>Conferi hoje</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
