import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

/** Guarda os filtros de uma tela neste navegador (o leitor pode bloquear o armazenamento; aí simplesmente não guarda). */
export function loadFilters(key: string): string {
  try { return localStorage.getItem(`filtros:${key}`) ?? '' } catch { return '' }
}

export function saveFilters(key: string, params: URLSearchParams) {
  const copy = new URLSearchParams(params)
  copy.delete('p') // página não é filtro: volta sempre para a primeira
  try {
    const s = copy.toString()
    if (s) localStorage.setItem(`filtros:${key}`, s)
    else localStorage.removeItem(`filtros:${key}`)
  } catch { /* sem armazenamento: segue sem guardar */ }
}

/**
 * Ao entrar na tela sem filtros no endereço, reabre com os últimos filtros usados.
 * Decide só na entrada: depois disso, "Limpar filtros" limpa de verdade.
 * O conteúdo só aparece quando o endereço já tem os filtros (evita a busca começar vazia).
 */
export function RestoreFilters({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const { search } = useLocation()
  const [restore] = useState(() => (search ? '' : loadFilters(storageKey)))
  const [done, setDone] = useState(false)
  useEffect(() => { if (restore && search) setDone(true) }, [restore, search])
  if (restore && !done) return search ? null : <Navigate to={`?${restore}`} replace />
  return <>{children}</>
}
