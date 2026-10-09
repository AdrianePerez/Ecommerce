import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { Button, ErrorState, Field, Input } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/app/auth'

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <BarChart3 className="size-6 text-accent" aria-hidden />
          <span className="font-semibold">Dualshop Intelligence</span>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6">
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  )
}

function translateAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado. Verifique sua caixa de entrada.'
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  if (/password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 8 caracteres.'
  if (/same password|different from the old/i.test(msg)) return 'A nova senha precisa ser diferente da atual.'
  if (/failed to fetch/i.test(msg)) return 'Sem conexão com o servidor.'
  return msg
}

export function LoginPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && session) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(translateAuthError(error.message))
    else navigate('/', { replace: true })
  }

  return (
    <AuthShell title="Entrar">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <ErrorState message={error} />}
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={busy}>Entrar</Button>
        <Link to="/recuperar-senha" className="text-center text-sm text-accent hover:underline">
          Esqueci minha senha
        </Link>
      </form>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    setBusy(false)
    if (error) setError(translateAuthError(error.message))
    else setSent(true)
  }

  return (
    <AuthShell title="Recuperar senha">
      {sent ? (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            Se houver um usuário com o e-mail <strong>{email}</strong>, ele receberá um link para criar uma nova senha.
          </p>
          <Link to="/login" className="text-accent hover:underline">Voltar para o login</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <ErrorState message={error} />}
          <Field label="E-mail" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={busy}>Enviar link</Button>
          <Link to="/login" className="text-center text-sm text-accent hover:underline">Voltar para o login</Link>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.')
    if (password !== confirm) return setError('As senhas não conferem.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(translateAuthError(error.message))
    else navigate('/', { replace: true })
  }

  if (loading) return null
  if (!session)
    return (
      <AuthShell title="Link inválido ou expirado">
        <p className="mb-4 text-sm text-muted">Solicite um novo link de redefinição de senha.</p>
        <Link to="/recuperar-senha" className="text-sm text-accent hover:underline">Recuperar senha</Link>
      </AuthShell>
    )

  return (
    <AuthShell title="Criar nova senha">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <ErrorState message={error} />}
        <Field label="Nova senha" htmlFor="pw" hint="Mínimo de 8 caracteres.">
          <Input id="pw" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirme a nova senha" htmlFor="pw2">
          <Input id="pw2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={busy}>Salvar senha</Button>
      </form>
    </AuthShell>
  )
}
