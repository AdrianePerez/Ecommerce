import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation, useSearchParams } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { RestoreFilters, saveFilters } from './savedFilters'

function Page() {
  const [params, setParams] = useSearchParams()
  const { search } = useLocation()
  useEffect(() => { saveFilters('t', params) }, [params])
  return (
    <>
      <span data-testid="search">{search}</span>
      <button onClick={() => setParams(new URLSearchParams({ q: 'gabby', p: '3' }))}>filtrar</button>
      <button onClick={() => setParams(new URLSearchParams())}>limpar</button>
    </>
  )
}
const app = (url: string) => render(<MemoryRouter initialEntries={[url]}><RestoreFilters storageKey="t"><Page /></RestoreFilters></MemoryRouter>)

describe('RestoreFilters', () => {
  beforeEach(() => localStorage.clear())

  it('guarda os filtros (sem a página) e reabre com eles', async () => {
    const first = app('/produtos')
    fireEvent.click(screen.getByText('filtrar'))
    expect(localStorage.getItem('filtros:t')).toBe('q=gabby')
    first.unmount()
    app('/produtos')
    await act(async () => {})
    expect(screen.getByTestId('search').textContent).toBe('?q=gabby')
  })

  it('limpar filtros não traz os antigos de volta', async () => {
    localStorage.setItem('filtros:t', 'q=gabby')
    app('/produtos')
    await act(async () => {})
    fireEvent.click(screen.getByText('limpar'))
    await act(async () => {})
    expect(screen.getByTestId('search').textContent).toBe('')
    expect(localStorage.getItem('filtros:t')).toBeNull()
  })

  it('endereço com filtros (link do dashboard) tem prioridade', async () => {
    localStorage.setItem('filtros:t', 'q=gabby')
    app('/produtos?status=pronto')
    await act(async () => {})
    expect(screen.getByTestId('search').textContent).toBe('?status=pronto')
  })
})
