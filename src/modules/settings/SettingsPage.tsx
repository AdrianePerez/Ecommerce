import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { clsx } from 'clsx'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Spinner } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { formatCnpj, formatDate } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import type { Supplier, UserRole } from '@/lib/database.types'
import { useAuth } from '@/app/auth'
import { ROLE_LABEL, listProfiles, listSuppliers, saveSupplier, updateProfile } from './api'
import { SupplierFormModal } from './SupplierFormModal'
import { CostRuleTab } from './CostRuleTab'

export function SettingsPage() {
  const [tab, setTab] = useState<'fornecedores' | 'custo' | 'usuarios'>('fornecedores')
  return (
    <>
      <PageHeader title="Configurações" />
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {([['fornecedores', 'Fornecedores'], ['custo', 'Regra de custo'], ['usuarios', 'Usuários']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={clsx('-mb-px border-b-2 px-3 py-2 text-sm',
              tab === k ? 'border-accent font-medium' : 'border-transparent text-muted hover:text-ink')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'fornecedores' ? <SuppliersTab /> : tab === 'custo' ? <CostRuleTab /> : <UsersTab />}
    </>
  )
}

function SuppliersTab() {
  const qc = useQueryClient()
  const toast = useToast()
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined)
  const list = useQuery({ queryKey: ['suppliers', { archived: showArchived }], queryFn: () => listSuppliers(showArchived) })

  const archive = useMutation({
    mutationFn: (s: Supplier) => saveSupplier({ name: s.name, archived_at: s.archived_at ? null : new Date().toISOString() }, s.id),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['suppliers'] }); toast(s.archived_at ? 'Fornecedor arquivado.' : 'Fornecedor reativado.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  return (
    <Card
      title="Fornecedores"
      actions={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-accent" />
            Mostrar arquivados
          </label>
          <Button size="sm" variant="primary" onClick={() => setEditing(null)}><Plus className="size-4" aria-hidden /> Novo fornecedor</Button>
        </div>
      }
    >
      {list.isPending ? <Spinner /> : list.isError ? (
        <ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState title="Nenhum fornecedor" description="Cadastre os fornecedores. Na importação de XML, eles também serão reconhecidos pelo CNPJ." />
      ) : (
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sunk text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Razão social</th>
                <th className="px-3 py-2 font-medium">Nome fantasia</th>
                <th className="px-3 py-2 font-medium">CNPJ</th>
                <th className="px-3 py-2 font-medium">Desde</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-2">{s.name} {s.archived_at && <Badge>Arquivado</Badge>}</td>
                  <td className="px-3 py-2">{s.trade_name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatCnpj(s.cnpj)}</td>
                  <td className="px-3 py-2 text-muted">{formatDate(s.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`}><Pencil className="size-4" /></Button>
                      <Button size="sm" variant="ghost" loading={archive.isPending && archive.variables?.id === s.id} onClick={() => archive.mutate(s)}>
                        {s.archived_at ? 'Reativar' : 'Arquivar'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SupplierFormModal open={editing !== undefined} supplier={editing} onClose={() => setEditing(undefined)} />
    </Card>
  )
}

function UsersTab() {
  const { profile: me } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: ['profiles'], queryFn: listProfiles })
  const isAdmin = me?.role === 'admin'

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { role?: UserRole; active?: boolean } }) => updateProfile(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profiles'] }); toast('Usuário atualizado.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  return (
    <Card title="Usuários">
      <p className="mb-4 text-sm text-muted">
        O cadastro público fica desativado. Novos usuários são convidados pelo painel do Supabase
        (Authentication → Users → Invite user). O primeiro usuário vira administrador; os seguintes entram como operadores.
      </p>
      {list.isPending ? <Spinner /> : list.isError ? (
        <ErrorState message={friendlyDbError(list.error)} onRetry={() => list.refetch()} />
      ) : (
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sunk text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">E-mail</th>
                <th className="px-3 py-2 font-medium">Papel</th>
                <th className="px-3 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => {
                const self = p.id === me?.id
                return (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-4 py-2">{p.full_name ?? '—'} {self && <Badge tone="accent">Você</Badge>}</td>
                    <td className="px-3 py-2">{p.email}</td>
                    <td className="px-3 py-2">
                      {isAdmin && !self ? (
                        <Select className="h-8 w-40" value={p.role} aria-label={`Papel de ${p.email}`}
                          onChange={(e) => update.mutate({ id: p.id, patch: { role: e.target.value as UserRole } })}>
                          {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </Select>
                      ) : ROLE_LABEL[p.role]}
                    </td>
                    <td className="px-3 py-2">
                      {isAdmin && !self ? (
                        <Button size="sm" variant={p.active ? 'danger' : 'secondary'}
                          onClick={() => update.mutate({ id: p.id, patch: { active: !p.active } })}>
                          {p.active ? 'Desativar' : 'Reativar'}
                        </Button>
                      ) : (
                        <Badge tone={p.active ? 'good' : 'neutral'}>{p.active ? 'Ativo' : 'Inativo'}</Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
