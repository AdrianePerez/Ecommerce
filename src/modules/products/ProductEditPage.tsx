import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
import { useToast } from '@/components/ui/toast'
import {
  CAPACITY_UNITS, PRODUCT_STATUSES, PRODUCT_STATUS_LABEL, emptyProductForm, formToProduct, missingFields,
  productFormSchema, productToForm, type ProductFormValues,
} from '@/lib/domain/product'
import { FISCAL_ORIGINS } from '@/lib/domain/validators'
import { formatDateTime } from '@/lib/format'
import { friendlyDbError } from '@/lib/supabase'
import type { Product } from '@/lib/database.types'
import { listSuppliers } from '@/modules/settings/api'
import { SupplierFormModal } from '@/modules/settings/SupplierFormModal'
import { createProduct, getProduct, updateProduct } from './api'
import { StatusBadge } from './StatusBadge'
import { IdentifiersPanel } from './IdentifiersPanel'
import { AttributesPanel } from './AttributesPanel'
import { HistoryPanel } from './HistoryPanel'
import { CostHistoryPanel, CostSummaryCard } from './CostPanel'
import { SourcesPanel } from './SourcesPanel'
import { ProductImagesPanel } from '@/modules/images/ProductImagesPanel'
import { CommercialSheetPanel, ProductListingsPanel } from '@/modules/listings/ProductPanels'

const TABS = [
  ['custos', 'Custos e compras'],
  ['imagens', 'Imagens'],
  ['ficha', 'Ficha comercial'],
  ['anuncios', 'Anúncios'],
  ['atributos', 'Atributos adicionais'],
  ['fontes', 'Fontes'],
  ['identificadores', 'Identificadores'],
  ['historico', 'Histórico de alterações'],
] as const
type Tab = (typeof TABS)[number][0]

const SOURCE_LABEL: Record<string, string> = {
  manual: 'digitado manualmente', nfe: 'nota fiscal (XML)', catalogo: 'catálogo do fornecedor', pesquisa: 'pesquisa',
}

export function ProductEditPage() {
  const { id } = useParams()
  const isNew = !id
  const product = useQuery({ queryKey: ['product', id], queryFn: () => getProduct(id!), enabled: !isNew })

  if (!isNew && product.isPending) return <Spinner />
  if (!isNew && product.isError) return <ErrorState message={friendlyDbError(product.error)} onRetry={() => product.refetch()} />
  if (!isNew && !product.data)
    return <ErrorState message="Produto não encontrado ou você não tem acesso a ele." />

  return <ProductEditor key={product.data?.updated_at ?? 'novo'} product={product.data ?? null} />
}

function ProductEditor({ product }: { product: Product | null }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS.find(([k]) => k === params.get('aba'))?.[0]) ?? 'custos'
  const setTab = (k: Tab) => setParams((p) => { p.set('aba', k); return p }, { replace: true })
  const [supplierModal, setSupplierModal] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers() })

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: product ? productToForm(product) : emptyProductForm,
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, watch, setValue, setError } = form
  const errors = formState.errors

  // Avisa ao sair com alterações não salvas
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (formState.isDirty) e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [formState.isDirty])

  const values = watch()
  const missing = useMemo(() => {
    try {
      return missingFields(formToProduct(values) as Product)
    } catch {
      return null // formulário com valores inválidos no momento
    }
  }, [values])

  const save = useMutation({
    mutationFn: async (v: ProductFormValues) => {
      const row = formToProduct(v, product)
      if ((row.status === 'pronto' || row.status === 'publicado')) {
        const m = missingFields(row as Product)
        if (m.length) throw new Error(`Para marcar como "${PRODUCT_STATUS_LABEL[row.status]}", complete: ${m.map((x) => x.label).join(', ')}.`)
      }
      return product ? updateProduct(product.id, row, product) : createProduct(row)
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['product-filter-options'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.setQueryData(['product', saved.id], saved)
      toast(product ? 'Produto atualizado.' : 'Produto cadastrado.')
      setSaveError(null)
      if (!product) navigate(`/produtos/${saved.id}`, { replace: true })
    },
    onError: (e: Error) => {
      const msg = friendlyDbError(e)
      if (/SKU interno/.test(msg)) setError('internal_sku', { message: msg })
      else if (/EAN/.test(msg)) setError('ean', { message: msg })
      else if (/código/.test(msg)) setError('supplier_sku', { message: msg })
      setSaveError(msg)
    },
  })

  const title = product ? product.commercial_name || product.nf_description || 'Produto' : 'Novo produto'
  const fieldProps = (name: keyof ProductFormValues) => ({
    id: name,
    'aria-invalid': errors[name] ? true : undefined,
    ...register(name),
  })

  return (
    <>
      <Link to="/produtos" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="size-4" aria-hidden /> Produtos
      </Link>
      <PageHeader
        title={title}
        description={
          product ? (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={product.status} />
              <span>Atualizado em {formatDateTime(product.updated_at)}</span>
            </span>
          ) : 'Preencha o que souber agora; o restante pode ser completado depois.'
        }
        actions={
          <>
            {formState.isDirty && <span className="text-xs text-warn">Alterações não salvas</span>}
            <Button variant="primary" loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>
              {product ? 'Salvar alterações' : 'Cadastrar produto'}
            </Button>
          </>
        }
      />

      {saveError && <div className="mb-4"><ErrorState message={saveError} /></div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
          <Card title="Identificação">
            <Grid>
              <Field label="Nome comercial" htmlFor="commercial_name" error={errors.commercial_name?.message} className="sm:col-span-2">
                <Input {...fieldProps('commercial_name')} placeholder="Como o produto será apresentado ao cliente" />
              </Field>
              <Field label="Descrição original da nota fiscal" htmlFor="nf_description" error={errors.nf_description?.message} className="sm:col-span-2"
                hint={product?.nf_description ? 'Preservada como veio do fornecedor.' : undefined}>
                <Input {...fieldProps('nf_description')} />
              </Field>
              <Field label="SKU interno" htmlFor="internal_sku" error={errors.internal_sku?.message} hint="Único. Se ficar vazio, usa o código do fornecedor.">
                <Input {...fieldProps('internal_sku')} className="font-mono" />
              </Field>
              <Field label="EAN / GTIN" htmlFor="ean" error={errors.ean?.message}>
                <Input {...fieldProps('ean')} inputMode="numeric" className="font-mono" />
              </Field>
              <Field label="Fornecedor principal" htmlFor="main_supplier_id" error={errors.main_supplier_id?.message}>
                <div className="flex gap-2">
                  <Select {...fieldProps('main_supplier_id')} className="flex-1"
                    onChange={(e) => {
                      fieldProps('main_supplier_id').onChange(e)
                      const trade = suppliers.data?.find((x) => x.id === e.target.value)?.trade_name?.trim()
                      if (trade && !form.getValues('brand').trim()) setValue('brand', trade, { shouldDirty: true })
                    }}>
                    <option value="">—</option>
                    {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                  <Button type="button" variant="secondary" onClick={() => setSupplierModal(true)} aria-label="Cadastrar fornecedor" title="Cadastrar fornecedor">
                    <Plus className="size-4" />
                  </Button>
                </div>
              </Field>
              <Field label="Código do fornecedor (SKU)" htmlFor="supplier_sku" error={errors.supplier_sku?.message}>
                <Input {...fieldProps('supplier_sku')} className="font-mono"
                  onBlur={(e) => {
                    fieldProps('supplier_sku').onBlur(e)
                    const code = e.target.value.trim()
                    if (code && !form.getValues('internal_sku').trim()) setValue('internal_sku', code, { shouldDirty: true })
                  }} />
              </Field>
            </Grid>
          </Card>

          <Card title="Classificação">
            <Grid>
              <Field label="Marca" htmlFor="brand" hint="Se ficar vazia, usa o nome fantasia do fornecedor."><Input {...fieldProps('brand')} /></Field>
              <Field label="Modelo ou referência" htmlFor="model"><Input {...fieldProps('model')} /></Field>
              <Field label="Coleção" htmlFor="collection"><Input {...fieldProps('collection')} /></Field>
              <Field label="Ano da coleção" htmlFor="collection_year" error={errors.collection_year?.message}>
                <Input {...fieldProps('collection_year')} inputMode="numeric" maxLength={4} />
              </Field>
              <Field label="Status do cadastro" htmlFor="status" error={errors.status?.message}>
                <Select {...fieldProps('status')}>
                  {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{PRODUCT_STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
            </Grid>
          </Card>

          <Card title="Dados fiscais">
            <Grid>
              <Field label="NCM" htmlFor="ncm" error={errors.ncm?.message}>
                <Input {...fieldProps('ncm')} inputMode="numeric" className="font-mono" placeholder="00000000" />
              </Field>
              <Field label="CEST" htmlFor="cest" error={errors.cest?.message}>
                <Input {...fieldProps('cest')} inputMode="numeric" className="font-mono" />
              </Field>
              <Field label="Origem da mercadoria" htmlFor="fiscal_origin" className="sm:col-span-2">
                <Select {...fieldProps('fiscal_origin')}>
                  <option value="">—</option>
                  {Object.entries(FISCAL_ORIGINS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Unidade de medida" htmlFor="unit" hint="Ex.: UN, PC, CX">
                <Input {...fieldProps('unit')} className="uppercase" />
              </Field>
            </Grid>
            {product?.fiscal_source && (
              <p className="mt-3 text-xs text-muted">
                Origem dos dados fiscais: <strong>{SOURCE_LABEL[product.fiscal_source] ?? product.fiscal_source}</strong>.
                Alterar NCM, CEST ou origem registra os dados como digitados manualmente.
              </p>
            )}
          </Card>

          <Card title="Características">
            <Grid>
              <Field label="Material" htmlFor="material"><Input {...fieldProps('material')} /></Field>
              <Field label="Cor" htmlFor="color"><Input {...fieldProps('color')} /></Field>
              <Field label="Capacidade" htmlFor="capacity_value" error={errors.capacity_value?.message ?? errors.capacity_unit?.message}>
                <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                  <Input {...fieldProps('capacity_value')} inputMode="decimal" className="tabular" placeholder="Ex.: 20" />
                  <Select {...register('capacity_unit')} aria-label="Unidade da capacidade">
                    <option value="">—</option>
                    {CAPACITY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </div>
              </Field>
            </Grid>
          </Card>

          <Card title="Medidas">
            <p className="mb-3 text-xs text-muted">
              Use vírgula para decimais. Medidas do <strong>produto</strong> e da <strong>embalagem de transporte</strong> são guardadas separadamente.
            </p>
            <h3 className="mb-2 text-[13px] font-semibold">Produto</h3>
            <Grid cols={4}>
              <Field label="Altura (cm)" htmlFor="height_cm" error={errors.height_cm?.message}><Input {...fieldProps('height_cm')} inputMode="decimal" className="tabular" /></Field>
              <Field label="Largura (cm)" htmlFor="width_cm" error={errors.width_cm?.message}><Input {...fieldProps('width_cm')} inputMode="decimal" className="tabular" /></Field>
              <Field label="Profundidade (cm)" htmlFor="depth_cm" error={errors.depth_cm?.message}><Input {...fieldProps('depth_cm')} inputMode="decimal" className="tabular" /></Field>
              <Field label="Peso (g)" htmlFor="weight_g" error={errors.weight_g?.message}><Input {...fieldProps('weight_g')} inputMode="decimal" className="tabular" /></Field>
            </Grid>
            <h3 className="mt-4 mb-2 text-[13px] font-semibold">Embalagem de transporte</h3>
            <Grid cols={4}>
              <Field label="Altura (cm)" htmlFor="pkg_height_cm" error={errors.pkg_height_cm?.message}><Input {...fieldProps('pkg_height_cm')} inputMode="decimal" className="tabular" /></Field>
              <Field label="Largura (cm)" htmlFor="pkg_width_cm" error={errors.pkg_width_cm?.message}><Input {...fieldProps('pkg_width_cm')} inputMode="decimal" className="tabular" /></Field>
              <Field label="Profundidade (cm)" htmlFor="pkg_depth_cm" error={errors.pkg_depth_cm?.message}><Input {...fieldProps('pkg_depth_cm')} inputMode="decimal" className="tabular" /></Field>
              <Field label="Peso bruto (g)" htmlFor="gross_weight_g" error={errors.gross_weight_g?.message}><Input {...fieldProps('gross_weight_g')} inputMode="decimal" className="tabular" /></Field>
            </Grid>
          </Card>

          <Card title="Observações">
            <Textarea {...fieldProps('notes')} aria-label="Observações" />
          </Card>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={save.isPending}>
              {product ? 'Salvar alterações' : 'Cadastrar produto'}
            </Button>
          </div>
        </form>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-0 xl:self-start">
          {product && <Card title="Custo de aquisição"><CostSummaryCard productId={product.id} /></Card>}
          <Card title="O que falta">
            {missing === null ? (
              <p className="text-sm text-muted">Corrija os campos destacados para calcular.</p>
            ) : missing.length === 0 ? (
              <Badge tone="good">Cadastro mestre completo</Badge>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {missing.map((m) => (
                  <li key={m.key} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-warn" aria-hidden /> {m.label}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">Fotos, textos e anúncios ficam nas abas abaixo.</p>
          </Card>
        </aside>
      </div>

      {product && (
        <section className="mt-6">
          <div className="mb-3 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
            {TABS.map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={clsx(
                  '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap',
                  tab === k ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          {tab === 'custos' && <CostHistoryPanel productId={product.id} />}
          {tab === 'identificadores' && <IdentifiersPanel productId={product.id} />}
          {tab === 'atributos' && <AttributesPanel productId={product.id} />}
          {tab === 'historico' && <HistoryPanel productId={product.id} />}
          {tab === 'imagens' && <ProductImagesPanel product={product} />}
          {tab === 'ficha' && <CommercialSheetPanel product={product} />}
          {tab === 'anuncios' && <ProductListingsPanel product={product} />}
          {tab === 'fontes' && <SourcesPanel productId={product.id} />}
        </section>
      )}

      <SupplierFormModal
        open={supplierModal}
        onClose={() => setSupplierModal(false)}
        onSaved={(s) => {
          setValue('main_supplier_id', s.id, { shouldDirty: true })
          if (s.trade_name && !form.getValues('brand').trim()) setValue('brand', s.trade_name, { shouldDirty: true })
        }}
      />
    </>
  )
}

function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 4 }) {
  return <div className={clsx('grid gap-3', cols === 2 ? 'sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}>{children}</div>
}
