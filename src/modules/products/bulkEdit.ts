// Alteração em massa: quais campos podem ser alterados e como validar/converter.
import { cmToMm, parseBrDecimal, toDbDecimal } from '@/lib/domain/numbers'
import { isValidCest, isValidNcm, onlyDigits } from '@/lib/domain/validators'
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL } from '@/lib/domain/product'
import { FISCAL_ORIGINS } from '@/lib/domain/validators'

export type BulkFieldKind = 'text' | 'cm' | 'g' | 'year' | 'select' | 'capacity' | 'ncm' | 'cest' | 'supplier'

export type BulkField = {
  key: string
  label: string
  kind: BulkFieldKind
  group: string
  options?: { value: string; label: string }[]
  hint?: string
}

export const BULK_FIELDS: BulkField[] = [
  { key: 'brand', label: 'Marca', kind: 'text', group: 'Classificação' },
  { key: 'model', label: 'Modelo ou referência', kind: 'text', group: 'Classificação' },
  { key: 'collection', label: 'Coleção', kind: 'text', group: 'Classificação' },
  { key: 'collection_year', label: 'Ano da coleção', kind: 'year', group: 'Classificação' },
  { key: 'main_supplier_id', label: 'Fornecedor principal', kind: 'supplier', group: 'Classificação' },
  { key: 'status', label: 'Status do cadastro', kind: 'select', group: 'Classificação',
    options: PRODUCT_STATUSES.map((s) => ({ value: s, label: PRODUCT_STATUS_LABEL[s] })),
    hint: 'O status sempre substitui o atual.' },
  { key: 'material', label: 'Material', kind: 'text', group: 'Características' },
  { key: 'color', label: 'Cor', kind: 'text', group: 'Características' },
  { key: 'capacity', label: 'Capacidade', kind: 'capacity', group: 'Características' },
  { key: 'height_mm', label: 'Altura (cm)', kind: 'cm', group: 'Medidas do produto' },
  { key: 'width_mm', label: 'Largura (cm)', kind: 'cm', group: 'Medidas do produto' },
  { key: 'depth_mm', label: 'Profundidade (cm)', kind: 'cm', group: 'Medidas do produto' },
  { key: 'weight_g', label: 'Peso (g)', kind: 'g', group: 'Medidas do produto' },
  { key: 'pkg_height_mm', label: 'Altura (cm)', kind: 'cm', group: 'Embalagem de transporte' },
  { key: 'pkg_width_mm', label: 'Largura (cm)', kind: 'cm', group: 'Embalagem de transporte' },
  { key: 'pkg_depth_mm', label: 'Profundidade (cm)', kind: 'cm', group: 'Embalagem de transporte' },
  { key: 'gross_weight_g', label: 'Peso bruto (g)', kind: 'g', group: 'Embalagem de transporte' },
  { key: 'ncm', label: 'NCM', kind: 'ncm', group: 'Dados fiscais' },
  { key: 'cest', label: 'CEST', kind: 'cest', group: 'Dados fiscais' },
  { key: 'fiscal_origin', label: 'Origem da mercadoria', kind: 'select', group: 'Dados fiscais',
    options: Object.entries(FISCAL_ORIGINS).map(([value, label]) => ({ value, label })) },
  { key: 'unit', label: 'Unidade de medida', kind: 'text', group: 'Dados fiscais' },
]

export const BULK_GROUPS = [...new Set(BULK_FIELDS.map((f) => f.group))]

/** Valores digitados: chave do campo → texto. Capacidade usa capacity_value e capacity_unit. */
export type BulkValues = Record<string, string>

export function buildBulkChanges(values: BulkValues, enabled: Set<string>) {
  const changes: Record<string, string> = {}
  const errors: Record<string, string> = {}

  for (const f of BULK_FIELDS) {
    if (!enabled.has(f.key)) continue
    const raw = (values[f.key] ?? '').trim()

    if (f.kind === 'capacity') {
      const v = (values.capacity_value ?? '').trim()
      const u = (values.capacity_unit ?? '').trim()
      if (!v || !u) { errors.capacity = 'Informe valor e unidade'; continue }
      try {
        const d = parseBrDecimal(v)
        if (!d || d.lte(0)) throw new Error()
        changes.capacity_value = d.toString()
        changes.capacity_unit = u
      } catch { errors.capacity = 'Número inválido' }
      continue
    }

    if (!raw) { errors[f.key] = 'Informe o valor ou desmarque o campo'; continue }

    try {
      switch (f.kind) {
        case 'cm': {
          const d = parseBrDecimal(raw)
          if (!d || d.lte(0)) throw new Error('Deve ser maior que zero')
          changes[f.key] = cmToMm(raw)!
          break
        }
        case 'g': {
          const d = parseBrDecimal(raw)
          if (!d || d.lte(0)) throw new Error('Deve ser maior que zero')
          changes[f.key] = toDbDecimal(raw)!
          break
        }
        case 'year':
          if (!/^\d{4}$/.test(raw) || +raw < 1990 || +raw > 2100) throw new Error('Ano inválido')
          changes[f.key] = raw
          break
        case 'ncm':
          if (!isValidNcm(raw)) throw new Error('NCM deve ter 8 dígitos')
          changes[f.key] = onlyDigits(raw)
          break
        case 'cest':
          if (!isValidCest(raw)) throw new Error('CEST deve ter 7 dígitos')
          changes[f.key] = onlyDigits(raw)
          break
        default:
          changes[f.key] = f.key === 'unit' ? raw.toUpperCase() : raw
      }
    } catch (e) {
      errors[f.key] = (e as Error).message || 'Número inválido'
    }
  }
  return { changes, errors, valid: Object.keys(errors).length === 0 && Object.keys(changes).length > 0 }
}

/** Texto legível do que será aplicado, para a confirmação. */
export function describeChanges(changes: Record<string, string>, supplierName?: (id: string) => string | undefined) {
  const out: string[] = []
  for (const f of BULK_FIELDS) {
    if (f.kind === 'capacity') {
      if (changes.capacity_value) out.push(`Capacidade: ${changes.capacity_value.replace('.', ',')} ${changes.capacity_unit}`)
      continue
    }
    const v = changes[f.key]
    if (v === undefined) continue
    const shown =
      f.kind === 'cm' ? `${(Number(v) / 10).toLocaleString('pt-BR')} cm` :
      f.kind === 'g' ? `${Number(v).toLocaleString('pt-BR')} g` :
      f.kind === 'select' ? f.options?.find((o) => o.value === v)?.label ?? v :
      f.kind === 'supplier' ? supplierName?.(v) ?? v : v
    const prefix = f.group === 'Embalagem de transporte' ? 'Embalagem · ' : ''
    out.push(`${prefix}${f.label.replace(/ \((cm|g)\)/, '')}: ${shown}`)
  }
  return out
}
