import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Badge, Button, Card, ErrorState, Field, Input, Spinner, Textarea } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { describeRule, type CostRule } from '@/lib/domain/cost'
import { formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { useAuth } from '@/app/auth'
import { activateCostRule, createCostRule, listCostRules } from '@/modules/invoices/api'

const FLAGS: { key: keyof Pick<CostRule, 'include_ipi' | 'include_freight' | 'include_insurance' | 'include_other' | 'include_st' | 'subtract_discount'>; label: string }[] = [
  { key: 'include_ipi', label: 'Somar IPI' },
  { key: 'include_freight', label: 'Somar frete do item' },
  { key: 'include_insurance', label: 'Somar seguro' },
  { key: 'include_other', label: 'Somar outras despesas' },
  { key: 'include_st', label: 'Somar ICMS-ST' },
  { key: 'subtract_discount', label: 'Descontar descontos' },
]

export function CostRuleTab() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()
  const toast = useToast()
  const rules = useQuery({ queryKey: ['cost-rules'], queryFn: listCostRules })
  const [form, setForm] = useState<Record<string, boolean>>({ include_ipi: true })
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cost-rules'] })
    qc.invalidateQueries({ queryKey: ['cost-rule-active'] })
  }
  const create = useMutation({
    mutationFn: () => createCostRule({
      version: Math.max(0, ...(rules.data ?? []).map((r) => r.version)) + 1,
      name: name.trim(),
      notes: notes.trim() || null,
      include_ipi: !!form.include_ipi, include_freight: !!form.include_freight, include_insurance: !!form.include_insurance,
      include_other: !!form.include_other, include_st: !!form.include_st, subtract_discount: !!form.subtract_discount,
    }),
    onSuccess: () => { invalidate(); setName(''); setNotes(''); setError(null); toast('Nova versão criada. Ative-a para passar a valer.') },
    onError: (e: Error) => setError(friendlyDbError(e)),
  })
  const activate = useMutation({
    mutationFn: activateCostRule,
    onSuccess: () => { invalidate(); toast('Regra ativada para as próximas importações.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Dê um nome à regra.')
    create.mutate()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card title="Versões da regra de custo">
        <p className="mb-4 text-sm text-muted">
          A regra define o que entra no custo de aquisição de cada item importado. Cada lançamento guarda a regra usada e
          todos os componentes (produtos, IPI, frete, ST, descontos) separadamente. Ativar outra versão vale para as
          <strong> próximas</strong> importações; as entradas já gravadas não mudam.
        </p>
        {rules.isPending ? <Spinner /> : rules.isError ? <ErrorState message={friendlyDbError(rules.error)} /> : (
          <ul className="flex flex-col gap-2">
            {rules.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">v{r.version} · {r.name} {r.is_active && <Badge tone="good">Ativa</Badge>}</div>
                  <div className="font-mono text-xs text-muted">{describeRule(r)}</div>
                  {r.notes && <div className="mt-1 text-xs text-muted">{r.notes}</div>}
                  <div className="text-xs text-muted">Criada em {formatDateTime(r.created_at)}</div>
                </div>
                {isAdmin && !r.is_active && (
                  <Button size="sm" loading={activate.isPending && activate.variables === r.id} onClick={() => activate.mutate(r.id)}>Ativar</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin ? (
        <form onSubmit={submit} className="flex flex-col gap-3 self-start rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold">Nova versão</h3>
          {error && <ErrorState message={error} />}
          <Field label="Nome" htmlFor="rule_name"><Input id="rule_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Com frete rateado" /></Field>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-[13px] font-medium">Valor dos produtos +</span>
            {FLAGS.map((f) => (
              <label key={f.key} className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-accent" checked={!!form[f.key]}
                  onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.checked }))} />
                {f.label}
              </label>
            ))}
          </div>
          <p className="font-mono text-xs text-muted">{describeRule({
            include_ipi: !!form.include_ipi, include_freight: !!form.include_freight, include_insurance: !!form.include_insurance,
            include_other: !!form.include_other, include_st: !!form.include_st, subtract_discount: !!form.subtract_discount,
          })}</p>
          <Field label="Observações" htmlFor="rule_notes"><Textarea id="rule_notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <p className="text-xs text-warn">Quais tributos compõem o custo depende do regime tributário da empresa. Confirme com a contabilidade.</p>
          <Button type="submit" variant="primary" loading={create.isPending}>Criar versão</Button>
        </form>
      ) : (
        <p className="text-sm text-muted">Somente administradores alteram a regra de custo.</p>
      )}
    </div>
  )
}
