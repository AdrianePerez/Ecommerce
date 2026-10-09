import { z } from 'zod'
import { cmToMm, mmToCmInput, parseBrDecimal, toDbDecimal, toInputText } from './numbers'
import { isValidCest, isValidGtin, isValidNcm, onlyDigits } from './validators'
import type { Product, ProductInsert, ProductStatus } from '@/lib/database.types'

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  novo: 'Novo produto',
  cadastro_fiscal_pendente: 'Cadastro fiscal pendente',
  pesquisando: 'Pesquisando informações',
  aguardando_revisao: 'Aguardando revisão',
  em_preparacao: 'Em preparação',
  pronto: 'Pronto para publicar',
  publicado: 'Publicado',
  arquivado: 'Arquivado',
}

export const PRODUCT_STATUSES = Object.keys(PRODUCT_STATUS_LABEL) as ProductStatus[]

export const CAPACITY_UNITS = ['L', 'mL', 'kg', 'g', 'un'] as const

// ---------------------------------------------------------------------
// Completude: o que falta no cadastro mestre.
// Mantido em paralelo à view product_overview (missing_count) — os testes
// garantem que os mesmos critérios sejam usados.
// ---------------------------------------------------------------------
export type MissingItem = { key: string; label: string }

export function missingFields(p: Pick<Product,
  'commercial_name' | 'brand' | 'ean' | 'supplier_sku' | 'ncm' |
  'height_mm' | 'width_mm' | 'depth_mm' | 'weight_g'>): MissingItem[] {
  const out: MissingItem[] = []
  if (!p.commercial_name?.trim()) out.push({ key: 'commercial_name', label: 'Nome comercial' })
  if (!p.brand) out.push({ key: 'brand', label: 'Marca' })
  if (!p.ean && !p.supplier_sku) out.push({ key: 'identifier', label: 'EAN ou código do fornecedor' })
  if (!p.ncm) out.push({ key: 'ncm', label: 'NCM' })
  if (p.height_mm == null || p.width_mm == null || p.depth_mm == null)
    out.push({ key: 'dimensions', label: 'Dimensões do produto' })
  if (p.weight_g == null) out.push({ key: 'weight', label: 'Peso do produto' })
  return out
}

// ---------------------------------------------------------------------
// Formulário
// Medidas digitadas em cm e g (padrão brasileiro, vírgula decimal);
// gravadas em mm e g.
// ---------------------------------------------------------------------
const optionalText = z.string().trim().transform((v) => (v === '' ? null : v))

const decimalText = (label: string, opts: { positive?: boolean } = { positive: true }) =>
  z.string().trim().superRefine((v, ctx) => {
    if (v === '') return
    try {
      const d = parseBrDecimal(v)
      if (d && opts.positive && d.lte(0)) ctx.addIssue({ code: 'custom', message: `${label} deve ser maior que zero` })
    } catch {
      ctx.addIssue({ code: 'custom', message: `${label}: número inválido` })
    }
  })

export const productFormSchema = z
  .object({
    commercial_name: z.string().trim(),
    nf_description: z.string().trim(),
    internal_sku: z.string().trim(),
    supplier_sku: z.string().trim(),
    ean: z.string().trim().refine((v) => v === '' || isValidGtin(v), 'EAN/GTIN inválido (confira os dígitos)'),
    brand: z.string().trim(),
    model: z.string().trim(),
    collection: z.string().trim(),
    collection_year: z
      .string()
      .trim()
      .refine((v) => v === '' || (/^\d{4}$/.test(v) && +v >= 1990 && +v <= 2100), 'Ano inválido'),
    main_supplier_id: z.string(),
    ncm: z.string().trim().refine((v) => v === '' || isValidNcm(v), 'NCM deve ter 8 dígitos'),
    cest: z.string().trim().refine((v) => v === '' || isValidCest(v), 'CEST deve ter 7 dígitos'),
    fiscal_origin: z.string(),
    unit: z.string().trim(),
    material: z.string().trim(),
    color: z.string().trim(),
    capacity_value: decimalText('Capacidade'),
    capacity_unit: z.string(),
    height_cm: decimalText('Altura'),
    width_cm: decimalText('Largura'),
    depth_cm: decimalText('Profundidade'),
    weight_g: decimalText('Peso'),
    pkg_height_cm: decimalText('Altura da embalagem'),
    pkg_width_cm: decimalText('Largura da embalagem'),
    pkg_depth_cm: decimalText('Profundidade da embalagem'),
    gross_weight_g: decimalText('Peso bruto'),
    notes: z.string(),
    status: z.enum(PRODUCT_STATUSES as [ProductStatus, ...ProductStatus[]]),
  })
  .superRefine((v, ctx) => {
    if (!v.commercial_name && !v.nf_description) {
      ctx.addIssue({ code: 'custom', path: ['commercial_name'], message: 'Informe o nome comercial ou a descrição da nota' })
    }
    if ((v.capacity_value === '') !== (v.capacity_unit === '')) {
      ctx.addIssue({ code: 'custom', path: ['capacity_unit'], message: 'Informe valor e unidade da capacidade' })
    }
    if (v.supplier_sku && !v.main_supplier_id) {
      ctx.addIssue({ code: 'custom', path: ['main_supplier_id'], message: 'Selecione o fornecedor do código informado' })
    }
  })

export type ProductFormValues = z.input<typeof productFormSchema>

export const emptyProductForm: ProductFormValues = {
  commercial_name: '', nf_description: '', internal_sku: '', supplier_sku: '', ean: '',
  brand: '', model: '', collection: '', collection_year: '', main_supplier_id: '',
  ncm: '', cest: '', fiscal_origin: '', unit: '', material: '', color: '',
  capacity_value: '', capacity_unit: '', height_cm: '', width_cm: '', depth_cm: '', weight_g: '',
  pkg_height_cm: '', pkg_width_cm: '', pkg_depth_cm: '', gross_weight_g: '', notes: '', status: 'novo',
}

export function productToForm(p: Product): ProductFormValues {
  const s = (v: string | number | null) => (v === null || v === undefined ? '' : String(v))
  return {
    commercial_name: s(p.commercial_name), nf_description: s(p.nf_description),
    internal_sku: s(p.internal_sku), supplier_sku: s(p.supplier_sku), ean: s(p.ean),
    brand: s(p.brand), model: s(p.model), collection: s(p.collection),
    collection_year: s(p.collection_year), main_supplier_id: s(p.main_supplier_id),
    ncm: s(p.ncm), cest: s(p.cest), fiscal_origin: s(p.fiscal_origin), unit: s(p.unit),
    material: s(p.material), color: s(p.color),
    capacity_value: toInputText(p.capacity_value), capacity_unit: s(p.capacity_unit),
    height_cm: mmToCmInput(p.height_mm), width_cm: mmToCmInput(p.width_mm), depth_cm: mmToCmInput(p.depth_mm),
    weight_g: toInputText(p.weight_g),
    pkg_height_cm: mmToCmInput(p.pkg_height_mm), pkg_width_cm: mmToCmInput(p.pkg_width_mm),
    pkg_depth_cm: mmToCmInput(p.pkg_depth_mm), gross_weight_g: toInputText(p.gross_weight_g),
    notes: s(p.notes), status: p.status,
  }
}

/**
 * Converte o formulário validado no registro do banco.
 * `previous` permite preservar a origem fiscal quando os dados fiscais não mudaram
 * (ex.: NCM vindo da nota fiscal continua com origem "nfe").
 */
export function formToProduct(
  raw: ProductFormValues,
  previous?: Pick<Product, 'ncm' | 'cest' | 'fiscal_origin' | 'fiscal_source'> | null,
): ProductInsert {
  const v = productFormSchema.parse(raw)
  const t = (x: string) => optionalText.parse(x)
  const ncm = v.ncm ? onlyDigits(v.ncm) : null
  const cest = v.cest ? onlyDigits(v.cest) : null
  const fiscal_origin = v.fiscal_origin === '' ? null : Number(v.fiscal_origin)
  const hasFiscal = ncm !== null || cest !== null || fiscal_origin !== null
  const fiscalUnchanged =
    previous && previous.ncm === ncm && previous.cest === cest && previous.fiscal_origin === fiscal_origin

  return {
    commercial_name: t(v.commercial_name),
    nf_description: t(v.nf_description),
    internal_sku: t(v.internal_sku),
    supplier_sku: t(v.supplier_sku),
    ean: t(v.ean),
    brand: t(v.brand),
    model: t(v.model),
    collection: t(v.collection),
    collection_year: v.collection_year ? Number(v.collection_year) : null,
    main_supplier_id: v.main_supplier_id || null,
    ncm,
    cest,
    fiscal_origin,
    fiscal_source: !hasFiscal ? null : fiscalUnchanged ? previous!.fiscal_source : 'manual',
    unit: t(v.unit),
    material: t(v.material),
    color: t(v.color),
    capacity_value: toDbDecimal(v.capacity_value),
    capacity_unit: (v.capacity_unit || null) as ProductInsert['capacity_unit'],
    height_mm: cmToMm(v.height_cm),
    width_mm: cmToMm(v.width_cm),
    depth_mm: cmToMm(v.depth_cm),
    weight_g: toDbDecimal(v.weight_g),
    pkg_height_mm: cmToMm(v.pkg_height_cm),
    pkg_width_mm: cmToMm(v.pkg_width_cm),
    pkg_depth_mm: cmToMm(v.pkg_depth_cm),
    gross_weight_g: toDbDecimal(v.gross_weight_g),
    notes: t(v.notes),
    status: v.status,
  }
}
