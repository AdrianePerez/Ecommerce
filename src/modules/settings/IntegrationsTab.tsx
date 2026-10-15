import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Mail } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, ErrorState, Field, Input, Spinner, Textarea } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/app/auth'
import { formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import { createIntegrationToken, listIntegrationTokens, revokeIntegrationToken } from '@/modules/invoices/api'
import { gmailScript } from './appsScript'

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/receber-xml`

export function IntegrationsTab() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()
  const toast = useToast()
  const tokens = useQuery({ queryKey: ['integration-tokens'], queryFn: listIntegrationTokens, enabled: isAdmin })
  const [name, setName] = useState('Gmail')
  const [script, setScript] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => createIntegrationToken(name.trim() || 'Gmail'),
    onSuccess: (token) => { setScript(gmailScript(ENDPOINT, token)); qc.invalidateQueries({ queryKey: ['integration-tokens'] }) },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })
  const revoke = useMutation({
    mutationFn: revokeIntegrationToken,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integration-tokens'] }); toast('Chave revogada. O script que usava essa chave para de enviar.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })

  if (!isAdmin) return <p className="text-sm text-muted">Somente administradores configuram integrações.</p>

  async function copy() {
    try { await navigator.clipboard.writeText(script!); toast('Código copiado.') } catch { toast('Selecione o texto e copie com Ctrl+C.', 'bad') }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="XML das notas pelo Gmail">
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted">
            Um pequeno script roda na <strong className="text-ink">sua conta Google</strong> a cada 15 minutos, procura e-mails com anexo <code>.xml</code> e
            envia os arquivos para a <strong className="text-ink">caixa de entrada</strong> em Entrada de mercadorias. Nada é gravado sem a sua conferência,
            e o sistema não tem acesso ao seu e-mail.
          </p>
          {!script ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Nome da chave" htmlFor="tok_name"><Input id="tok_name" className="w-56" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}><KeyRound className="size-4" aria-hidden /> Gerar chave e código</Button>
            </div>
          ) : (
            <>
              <div className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                O código abaixo contém a chave e <strong>só aparece agora</strong>. Copie e cole no Apps Script. Se perder, gere outra e revogue esta.
              </div>
              <div className="relative">
                <Textarea readOnly value={script} className="h-72 font-mono text-xs" aria-label="Código do Apps Script" onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" className="absolute top-2 right-2" onClick={copy}><Copy className="size-3.5" aria-hidden /> Copiar</Button>
              </div>
            </>
          )}
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            <li>Abra <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer" className="text-accent hover:underline">script.google.com → Novo projeto</a> com a conta do Gmail que recebe as notas.</li>
            <li>Apague o conteúdo do editor, cole o código e clique em <strong>Salvar</strong> (ícone de disquete). Dê um nome, por exemplo "Dualshop XML".</li>
            <li>No menu de funções (ao lado de "Depurar"), escolha <strong>instalar</strong> e clique em <strong>Executar</strong>.</li>
            <li>O Google vai pedir autorização: escolha a conta → "Avançado" → "Acessar Dualshop XML (não seguro)" → Permitir. O aviso aparece porque o script é seu, não publicado.</li>
            <li>Pronto: o script roda agora e depois a cada 15 minutos. Os e-mails processados ganham a etiqueta <code>dualshop-xml-enviado</code>.</li>
          </ol>
          <p className="text-xs text-muted">Busca e-mails dos últimos 60 dias. Notas já importadas aparecem como importadas e não duplicam. XML compactado (.zip) não é lido; nesse caso importe pelo botão Importar XML.</p>
        </div>
      </Card>

      <Card title="Chaves de integração">
        {tokens.isPending ? <Spinner /> : tokens.isError ? <ErrorState message={friendlyDbError(tokens.error)} /> : tokens.data.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma chave criada.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
                <div>
                  <div className="flex items-center gap-2 font-medium"><Mail className="size-3.5 text-muted" aria-hidden /> {t.name}
                    {t.revoked_at ? <Badge tone="neutral">Revogada</Badge> : <Badge tone="good">Ativa</Badge>}</div>
                  <div className="text-xs text-muted">final …{t.token_hint} · criada {formatDateTime(t.created_at)}</div>
                  <div className="text-xs text-muted">{t.last_used_at ? `último envio ${formatDateTime(t.last_used_at)}` : 'ainda não usada'}</div>
                </div>
                {!t.revoked_at && <Button size="sm" variant="ghost" onClick={() => confirm('Revogar esta chave? O script que usa essa chave para de funcionar.') && revoke.mutate(t.id)}>Revogar</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
