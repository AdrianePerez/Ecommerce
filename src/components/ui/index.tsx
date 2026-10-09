// Componentes de interface reutilizáveis.
import { clsx } from 'clsx'
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react'
import {
  forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'

// ---------------------------------------------------------------------
// Botão
// ---------------------------------------------------------------------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
}
export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-hover',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:border-accent',
        variant === 'ghost' && 'text-muted hover:bg-sunk hover:text-ink',
        variant === 'danger' && 'border border-bad/40 bg-surface text-bad hover:bg-bad-soft',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------
// Campos de formulário
// ---------------------------------------------------------------------
const fieldBase =
  'w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:bg-sunk aria-[invalid=true]:border-bad'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => <input ref={ref} {...rest} className={clsx(fieldBase, 'h-9', className)} />,
)
Input.displayName = 'Input'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...rest }, ref) => (
    <select ref={ref} {...rest} className={clsx(fieldBase, 'h-9 pr-8', className)}>
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => <textarea ref={ref} {...rest} className={clsx(fieldBase, 'min-h-20 py-2', className)} />,
)
Textarea.displayName = 'Textarea'

export function Field({
  label, htmlFor, error, hint, children, className,
}: { label: string; htmlFor?: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <span className="text-xs text-bad" role="alert">{error}</span>
      ) : hint ? (
        <span className="text-xs text-muted">{hint}</span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-lg border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-sunk text-muted',
        tone === 'good' && 'bg-accent-soft text-good',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'bad' && 'bg-bad-soft text-bad',
      )}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------
export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Inbox className="size-8 text-muted/60" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad" role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">{message}</div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Modal (diálogo nativo, acessível)
// ---------------------------------------------------------------------
export function Modal({
  open, title, onClose, children, footer, wide,
}: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      className={clsx(
        'm-auto w-[calc(100%-32px)] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/30',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <>
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-muted hover:bg-sunk" aria-label="Fechar">
              <X className="size-4" />
            </button>
          </header>
          <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
        </>
      )}
    </dialog>
  )
}

// ---------------------------------------------------------------------
// Paginação
// ---------------------------------------------------------------------
export function Pagination({
  page, pageSize, total, onPage,
}: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm text-muted">
      <span className="tabular">
        {from}–{to} de {total.toLocaleString('pt-BR')}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <span className="tabular">
          {page + 1} / {pages}
        </span>
        <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          Próxima
        </Button>
      </div>
    </div>
  )
}
