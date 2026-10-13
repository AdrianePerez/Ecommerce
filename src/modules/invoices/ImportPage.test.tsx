// Fluxo da tela de importação com o banco simulado (as funções de api são substituídas).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import normalXml from '@/test/fixtures/nfe-proc-normal.xml?raw'
import { ToastProvider } from '@/components/ui/toast'
import * as api from './api'
import { ImportPage } from './ImportPage'

vi.mock('./api', () => ({
  getActiveCostRule: vi.fn(),
  findImportedByKeys: vi.fn(),
  matchItems: vi.fn(),
  suggestProducts: vi.fn(),
  uploadXml: vi.fn(),
  importInvoice: vi.fn(),
  duplicateIdFromError: vi.fn(() => null),
}))

const RULE = { id: 'r1', version: 1, name: 'v1', include_ipi: true, include_freight: false, include_insurance: false,
  include_other: false, include_st: false, subtract_discount: false, is_active: true, notes: null, created_at: '' }

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}><ToastProvider><MemoryRouter><ImportPage /></MemoryRouter></ToastProvider></QueryClientProvider>,
  )
}
function upload(container: HTMLElement, text: string, name = 'nota.xml') {
  const input = container.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/xml' })] } })
}

beforeEach(() => {
  vi.mocked(api.getActiveCostRule).mockResolvedValue(RULE)
  vi.mocked(api.findImportedByKeys).mockResolvedValue(new Map())
  vi.mocked(api.suggestProducts).mockResolvedValue([])
  vi.mocked(api.uploadXml).mockResolvedValue('42260912345678000199550010000123451000012341.xml')
  vi.mocked(api.importInvoice).mockResolvedValue('inv-1')
  // item 1 já existe pelo EAN; item 2 (caixa) é novo
  vi.mocked(api.matchItems).mockResolvedValue(new Map([
    [1, { item_number: 1, ean_product_id: 'p1', ean_product_name: 'Mochila 16 Rodinhas', sku_product_id: null, sku_product_name: null }],
    [2, { item_number: 2, ean_product_id: null, ean_product_name: null, sku_product_id: null, sku_product_name: null }],
  ]))
})

describe('tela de importação', () => {
  it('lê a nota, vincula pelo EAN, sugere fator da caixa, mostra custo e grava', async () => {
    const { container } = renderPage()
    upload(container, normalXml)

    expect(await screen.findByText(/NF-e 12345 · série 1/)).toBeInTheDocument()
    const rows = screen.getAllByRole('row').slice(1)
    // Item 1: vinculado pelo EAN; custo = (1078,80 + 105,18) / 12 = 98,665
    expect(within(rows[0]).getByText('Vinculado pelo EAN')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Mochila 16 Rodinhas')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/R\$\s*98,67/)).toBeInTheDocument()
    // Item 2: 2 CX com 24 UN tributáveis => fator 12, custo 441,60 / 24 = 18,40
    expect(within(rows[1]).getByText('Sem cadastro — será criado')).toBeInTheDocument()
    expect(within(rows[1]).getByLabelText(/Fator de conversão do item 2/)).toHaveValue('12')
    expect(within(rows[1]).getByText(/= 24 un/)).toBeInTheDocument()
    expect(within(rows[1]).getByText(/R\$\s*18,40/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Gravar nota' }))
    await waitFor(() => expect(api.importInvoice).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(api.importInvoice).mock.calls[0][0] as { items: { action: string; product_id: string | null; conversion_factor: number }[] }
    expect(payload.items[0]).toMatchObject({ action: 'link', product_id: 'p1', conversion_factor: 1 })
    expect(payload.items[1]).toMatchObject({ action: 'create', product_id: null, conversion_factor: 12 })
    expect(api.uploadXml).toHaveBeenCalledWith('42260912345678000199550010000123451000012341', normalXml)
    expect(await screen.findByText(/Nota gravada/)).toBeInTheDocument()
  })

  it('nota já importada não pode ser gravada de novo', async () => {
    vi.mocked(api.findImportedByKeys).mockResolvedValue(new Map([['42260912345678000199550010000123451000012341', 'inv-0']]))
    const { container } = renderPage()
    upload(container, normalXml)
    expect(await screen.findByText(/já foi importada antes/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gravar nota' })).toBeDisabled()
  })

  it('arquivo que não é XML mostra erro claro', async () => {
    const { container } = renderPage()
    upload(container, '%PDF-1.4', 'danfe.pdf')
    expect(await screen.findByText(/não o PDF da DANFE/)).toBeInTheDocument()
  })

  it('descrição parecida exige decisão antes de gravar', async () => {
    vi.mocked(api.matchItems).mockResolvedValue(new Map())
    vi.mocked(api.suggestProducts).mockResolvedValue([{ id: 'p7', name: 'Mochila escolar 16', brand: null, supplier_sku: null, ean: null, score: 0.8 }])
    const { container } = renderPage()
    upload(container, normalXml)
    expect((await screen.findAllByText('Possível correspondência — confirme')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Gravar nota' })).toBeDisabled()
    expect(screen.getByText(/precisam de decisão/)).toBeInTheDocument()
  })
})
