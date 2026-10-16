import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

type Toast = { id: number; text: string; tone: 'good' | 'bad' }
const ToastContext = createContext<(text: string, tone?: 'good' | 'bad') => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'good' | 'bad' = 'good') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), Math.max(tone === 'bad' ? 6000 : 3000, text.length * 60))
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto rounded-md px-4 py-2 text-sm font-medium shadow-lg',
              t.tone === 'good' ? 'bg-ink text-white' : 'bg-bad text-white',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
