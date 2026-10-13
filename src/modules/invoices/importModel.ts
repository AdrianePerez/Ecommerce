// Regras da tela de conferência: como cada item da nota começa (vinculado,
// conflito, sugestão, novo) e quando a nota está pronta para gravar.
import { isPackUnit, suggestConversionFactor, type NfeItem, type ParsedNfe } from '@/lib/domain/nfe'
import type { MatchMethod } from '@/lib/database.types'

export type ItemMatch = {
  item_number: number
  ean_product_id: string | null
  ean_product_name: string | null
  sku_product_id: string | null
  sku_product_name: string | null
}

export type Suggestion = { id: string; name: string; brand: string | null; supplier_sku: string | null; ean: string | null; score: number }

export type ItemStatus = 'ean' | 'supplier_sku' | 'conflito' | 'sugestao' | 'sem_cadastro' | 'manual' | 'novo' | 'ignorado'

export type ItemDecision = {
  item_number: number
  action: 'link' | 'create' | 'ignore' | null
  product_id: string | null
  product_name: string | null
  match_method: MatchMethod | null
  status: ItemStatus
  /** Explicação do vínculo para o usuário e para o registro */
  reason: string
  conversion_factor: number
  /** true quando a unidade da nota parece embalagem e o fator ainda não foi confirmado */
  factor_needs_review: boolean
  suggestions: Suggestion[]
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  ean: 'Vinculado pelo EAN',
  supplier_sku: 'Vinculado pelo código do fornecedor',
  conflito: 'Conflito: EAN e código apontam produtos diferentes',
  sugestao: 'Possível correspondência — confirme',
  sem_cadastro: 'Sem cadastro — será criado',
  manual: 'Vinculado manualmente',
  novo: 'Novo cadastro',
  ignorado: 'Ignorado (não entra no custo)',
}

export function initialDecision(item: NfeItem, match: ItemMatch | undefined, suggestions: Suggestion[]): ItemDecision {
  const factor = suggestConversionFactor(item)
  const base = {
    item_number: item.item_number,
    conversion_factor: factor,
    factor_needs_review: isPackUnit(item.unit_com) && factor === 1,
    suggestions,
  }
  const e = match?.ean_product_id ?? null
  const s = match?.sku_product_id ?? null

  if (e && s && e !== s) {
    return { ...base, action: null, product_id: null, product_name: null, match_method: null, status: 'conflito',
      reason: `O EAN aponta para "${match!.ean_product_name}" e o código do fornecedor para "${match!.sku_product_name}". Escolha o produto correto.` }
  }
  if (e) {
    return { ...base, action: 'link', product_id: e, product_name: match!.ean_product_name, match_method: 'ean', status: 'ean',
      reason: `EAN ${item.ean} já cadastrado neste produto` }
  }
  if (s) {
    return { ...base, action: 'link', product_id: s, product_name: match!.sku_product_name, match_method: 'supplier_sku', status: 'supplier_sku',
      reason: `Código ${item.supplier_code} deste fornecedor já cadastrado neste produto` }
  }
  // Sem identificador em comum: semelhança de descrição NUNCA vincula sozinha
  if (suggestions.some((x) => x.score >= 0.45)) {
    return { ...base, action: null, product_id: null, product_name: null, match_method: null, status: 'sugestao',
      reason: 'Há produtos com descrição parecida. Confirme se é um deles ou crie um novo cadastro.' }
  }
  return { ...base, action: 'create', product_id: null, product_name: null, match_method: 'novo', status: 'sem_cadastro',
    reason: 'Nenhum produto com este EAN ou código. Um novo cadastro será criado.' }
}

export function linkTo(d: ItemDecision, productId: string, productName: string, reason: string): ItemDecision {
  return { ...d, action: 'link', product_id: productId, product_name: productName, match_method: 'manual', status: 'manual', reason }
}
export function createNew(d: ItemDecision): ItemDecision {
  return { ...d, action: 'create', product_id: null, product_name: null, match_method: 'novo', status: 'novo', reason: 'Novo cadastro a partir da nota' }
}
export function ignoreItem(d: ItemDecision): ItemDecision {
  return { ...d, action: 'ignore', product_id: null, product_name: null, match_method: 'ignorado', status: 'ignorado', reason: 'Ignorado na conferência' }
}

export type ReadyCheck = { ready: boolean; problems: string[] }

export function checkReady(parsed: ParsedNfe, decisions: ItemDecision[], duplicateOf: string | null): ReadyCheck {
  const problems: string[] = []
  if (duplicateOf) problems.push('Esta nota já foi importada.')
  if (parsed.invoice.purpose !== 1) problems.push('Somente notas de finalidade normal podem ser importadas.')
  const pending = decisions.filter((d) => d.action === null)
  if (pending.length) problems.push(`${pending.length} ${pending.length === 1 ? 'item precisa' : 'itens precisam'} de decisão (vincular, criar ou ignorar).`)
  const badFactor = decisions.filter((d) => !(d.conversion_factor > 0) || !Number.isFinite(d.conversion_factor))
  if (badFactor.length) problems.push('Há fator de conversão inválido.')
  const factorReview = decisions.filter((d) => d.factor_needs_review && d.action !== 'ignore')
  if (factorReview.length) problems.push(`Confirme o fator de conversão de ${factorReview.length} ${factorReview.length === 1 ? 'item' : 'itens'} em embalagem (CX, DZ, PCT…).`)
  // Dois itens da mesma nota criando produto com o mesmo EAN gerariam conflito
  const eans = new Map<string, number>()
  for (const it of parsed.items) {
    const d = decisions.find((x) => x.item_number === it.item_number)
    if (d?.action === 'create' && it.ean) eans.set(it.ean, (eans.get(it.ean) ?? 0) + 1)
  }
  for (const [ean, n] of eans) if (n > 1) problems.push(`O EAN ${ean} aparece em ${n} itens marcados como novo cadastro. Crie em um e vincule os demais.`)
  return { ready: problems.length === 0, problems }
}

export function buildPayload(parsed: ParsedNfe, decisions: ItemDecision[], xml: { path: string; sha256: string }) {
  const byNumber = new Map(decisions.map((d) => [d.item_number, d]))
  return {
    invoice: { ...parsed.invoice, xml_path: xml.path, xml_sha256: xml.sha256 },
    items: parsed.items.map((it) => {
      const d = byNumber.get(it.item_number)!
      return {
        ...it,
        conversion_factor: d.conversion_factor,
        action: d.action,
        product_id: d.product_id,
        match_method: d.match_method,
        match_reason: d.reason,
      }
    }),
  }
}
