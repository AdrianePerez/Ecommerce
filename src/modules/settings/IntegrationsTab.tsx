import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Mail, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, ErrorState, Field, Input, Spinner, Textarea, cn } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/app/auth'
import { formatCnpj, formatDateTime } from '@/lib/format'
import { listSuppliers } from './api'
import { friendlyDbError } from '@/lib/supabase'
import { createIntegrationToken, describeSync, getSyncSettings, listIntegrationTokens, revokeIntegrationToken, saveSetting, syncGmail } from '@/modules/invoices/api'
import { gmailScript } from './appsScript'

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/receber-xml`

export function IntegrationsTab() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()
  const toast = useToast()
  const tokens = useQuery({ queryKey: ['integration-tokens'], queryFn: listIntegrationTokens, enabled: isAdmin })
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers() })
  const sync = useQuery({ queryKey: ['sync-settings'], queryFn: getSyncSettings })
  const [name, setName] = useState('Gmail')
  const [script, setScript] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const urlValue = url ?? sync.data?.url ?? ''

  const create = useMutation({
    mutationFn: async () => {
      // segredo novo a cada código gerado: o script só roda quando o sistema manda este segredo
      const bytes = crypto.getRandomValues(new Uint8Array(24))
      const secret = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
      const token = await createIntegrationToken(name.trim() || 'Gmail')
      await saveSetting('gmail_sync_secret', secret)
      return gmailScript(ENDPOINT, token, secret)
    },
    onSuccess: (code) => { setScript(code); qc.invalidateQueries({ queryKey: ['integration-tokens'] }); qc.invalidateQueries({ queryKey: ['sync-settings'] }) },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })
  const saveUrl = useMutation({
    mutationFn: () => saveSetting('gmail_sync_url', urlValue.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sync-settings'] }); setUrl(null); toast('Endereço salvo. Agora clique em Testar sincronização.') },
    onError: (e: Error) => toast(friendlyDbError(e), 'bad'),
  })
  const test = useMutation({
    mutationFn: async () => syncGmail(await getSyncSettings()),
    onSuccess: (r) => { setResult(describeSync(r)); qc.invalidateQueries({ queryKey: ['nfe-inbox'] }); qc.invalidateQueries({ queryKey: ['integration-tokens'] }) },
    onError: (e: Error) => setResult(e.message),
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
            Um pequeno script fica na <strong className="text-ink">sua conta Google</strong> e só roda quando você clica em <strong className="text-ink">Sincronizar e-mail</strong>
            {' '}(em Entrada de mercadorias). Ele procura em todo o Gmail — caixa de entrada, marcadores/pastas e arquivados — os e-mails com anexo <code>.xml</code> ou <code>.zip</code>
            {' '}e envia os XMLs para a <strong className="text-ink">caixa de entrada</strong> do sistema. Nada é gravado sem a sua conferência, e o sistema não tem acesso ao seu e-mail.
          </p>
          <p className="rounded-md bg-sunk px-3 py-2 text-muted">
            <strong className="text-ink">Só entram notas de fornecedores cadastrados</strong> (pelo CNPJ do emitente). XMLs de outras empresas são descartados na hora,
            sem guardar nada. Fornecedor novo: cadastre o CNPJ em Configurações → Fornecedores (ou importe a primeira nota pelo botão Importar XML).
          </p>

          <h3 className="font-semibold">1. Gerar o código</h3>
          {!script ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Nome da chave" htmlFor="tok_name"><Input id="tok_name" className="w-56" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}><KeyRound className="size-4" aria-hidden /> Gerar chave e código</Button>
            </div>
          ) : (
            <>
              <div className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                O código contém a chave e <strong>só aparece agora</strong>. Copie e cole no Apps Script. Se perder, gere outro (e revogue a chave antiga ao lado).
              </div>
              <div className="relative">
                <Textarea readOnly value={script} className="h-60 font-mono text-xs" aria-label="Código do Apps Script" onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" className="absolute top-2 right-2" onClick={copy}><Copy className="size-3.5" aria-hidden /> Copiar</Button>
              </div>
            </>
          )}

          <h3 className="font-semibold">2. Colar no Apps Script</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li>Abra o projeto que você já criou em <a href="https://script.google.com/home" target="_blank" rel="noreferrer" className="text-accent hover:underline">script.google.com</a> (ou crie um novo, com a conta do Gmail que recebe as notas).</li>
            <li>Apague todo o código antigo, cole o novo e clique em <strong>Salvar</strong>.</li>
            <li>Na lista de funções (ao lado de "Depurar"), escolha <strong>configurar</strong> e clique em <strong>Executar</strong>. Autorize se o Google pedir
              (conta → "Avançado" → "Acessar … (não seguro)" → Permitir). Isso desliga a execução automática da versão anterior e faz uma primeira leitura;
              o resultado aparece no "Registro de execução".</li>
          </ol>

          <h3 className="font-semibold">3. Publicar como app da Web (para o botão funcionar)</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li>No Apps Script, clique em <strong>Implantar → Nova implantação</strong>.</li>
            <li>Na engrenagem "Selecione o tipo", escolha <strong>App da Web</strong>. Em <strong>Executar como</strong>, deixe <strong>Eu</strong> (seu e-mail). Em <strong>Quem pode acessar</strong>, escolha <strong>Qualquer pessoa</strong>.</li>
            <li>Clique em <strong>Implantar</strong> e copie o <strong>URL do app da Web</strong> (termina em <code>/exec</code>). Cole abaixo e salve.</li>
          </ol>
          <p className="text-xs text-muted">"Qualquer pessoa" é necessário para o sistema conseguir chamar o script, mas ele só roda se receber o segredo que está no código — quem tiver só o endereço não consegue disparar nada.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="URL do app da Web" htmlFor="sync_url" className="min-w-80 flex-1">
              <Input id="sync_url" value={urlValue} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
            </Field>
            <Button loading={saveUrl.isPending} disabled={!urlValue.trim() || urlValue === sync.data?.url} onClick={() => saveUrl.mutate()}>Salvar endereço</Button>
          </div>

          <h3 className="font-semibold">4. Testar</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!sync.data?.url || !sync.data?.secret} loading={test.isPending} onClick={() => { setResult(null); test.mutate() }}>
              <RefreshCw className="size-4" aria-hidden /> Testar sincronização
            </Button>
            {test.isPending && <span className="text-xs text-muted">Lendo o e-mail… pode levar alguns minutos na primeira vez.</span>}
          </div>
          {result && <p className={cn('rounded-md px-3 py-2', test.isError ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-ink')}>{result}</p>}
          <p className="text-xs text-muted">Lê e-mails dos últimos 90 dias (fora spam e lixeira). E-mails já lidos ganham o marcador <code>dualshop-xml-enviado</code> e não são lidos de novo;
            se cadastrar um fornecedor depois, tire esse marcador do e-mail e sincronize. Notas já importadas não duplicam.</p>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
      <Card title="Fornecedores aceitos">
        {suppliers.isPending ? <Spinner /> : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {(suppliers.data ?? []).filter((x) => !x.archived_at).map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{x.trade_name || x.name}</span>
                {x.cnpj ? <span className="font-mono text-xs text-muted">{formatCnpj(x.cnpj)}</span> : <Badge tone="warn">sem CNPJ</Badge>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Fornecedor sem CNPJ não recebe notas automaticamente.</p>
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
    </div>
  )
}
