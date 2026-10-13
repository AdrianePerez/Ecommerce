// Montagem de título, descrição e atributos do anúncio a partir do cadastro.
// Usa SOMENTE dados do cadastro mestre e atributos confirmados — nada é inventado.
import { formatGrams, formatNumber } from '@/lib/format'
import type { Product, ProductAttribute } from '@/lib/database.types'

export type ListingStatus = 'rascunho' | 'em_revisao' | 'pronto_para_publicar' | 'publicado' | 'arquivado'
export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  rascunho: 'Rascunho', em_revisao: 'Em revisão', pronto_para_publicar: 'Pronto para publicar', publicado: 'Publicado', arquivado: 'Arquivado',
}
export const LISTING_STATUS_TONE: Record<ListingStatus, 'neutral' | 'warn' | 'accent' | 'good'> = {
  rascunho: 'neutral', em_revisao: 'warn', pronto_para_publicar: 'accent', publicado: 'good', arquivado: 'neutral',
}
export const REQUIRED_FIELD_LABEL: Record<string, string> = {
  title: 'Título', description: 'Descrição', category: 'Categoria', main_image: 'Imagem principal',
  price: 'Preço', keywords: 'Palavras-chave', ean: 'EAN do produto',
}

export type TemplateProduct = Pick<Product,
  'commercial_name' | 'nf_description' | 'brand' | 'model' | 'color' | 'material' | 'capacity_value' | 'capacity_unit'
  | 'height_mm' | 'width_mm' | 'depth_mm' | 'weight_g' | 'pkg_height_mm' | 'pkg_width_mm' | 'pkg_depth_mm' | 'gross_weight_g'
  | 'ean' | 'internal_sku' | 'supplier_sku'>
export type TemplateAttr = Pick<ProductAttribute, 'attr_key' | 'label' | 'value_text' | 'value_num' | 'unit' | 'validation_status'>

const cm = (mm: number | null) => (mm == null ? null : formatNumber(mm / 10, 1))
const has = (hay: string, needle: string) =>
  hay.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(needle.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())

function confirmed(attrs: TemplateAttr[]) {
  const m = new Map<string, TemplateAttr>()
  for (const a of attrs) if (a.validation_status === 'confirmada') m.set(a.attr_key, a)
  return m
}
const attrText = (a: TemplateAttr | undefined) =>
  !a ? null : a.value_text?.trim() || (a.value_num != null ? `${formatNumber(a.value_num, 3)}${a.unit ? ` ${a.unit}` : ''}` : null)

export function dimsText(h: number | null, w: number | null, d: number | null) {
  if (h == null || w == null) return null
  return `${cm(h)} x ${cm(w)}${d != null ? ` x ${cm(d)}` : ''} cm`
}

export function capacityText(p: Pick<TemplateProduct, 'capacity_value' | 'capacity_unit'>) {
  return p.capacity_value != null && p.capacity_unit ? `${formatNumber(p.capacity_value, 3)} ${p.capacity_unit}` : null
}

/** Corta no limite sem quebrar palavra. */
export function fitWords(text: string, max: number) {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max + 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.5 ? cut.slice(0, sp) : t.slice(0, max)).trim()
}

/** Título sugerido: nome + tamanho + marca + cor, retirando os opcionais do fim se passar do limite do canal. */
export function buildTitle(p: TemplateProduct, attrs: TemplateAttr[], max: number | null) {
  const base = (p.commercial_name || p.nf_description || '').replace(/\s+/g, ' ').trim()
  const a = confirmed(attrs)
  const extras: string[] = []
  const size = attrText(a.get('tamanho'))
  for (const x of [size, p.brand, p.color]) if (x && !has(base, x) && !extras.some((e) => has(e, x))) extras.push(x.trim())
  let parts = [base, ...extras]
  if (max) while (parts.length > 1 && parts.join(' ').length > max) parts = parts.slice(0, -1)
  const title = parts.join(' ')
  return max ? fitWords(title, max) : title
}

/** Descrição em texto simples, só com informações conhecidas. */
export function buildDescription(p: TemplateProduct, attrs: TemplateAttr[]) {
  const a = confirmed(attrs)
  const name = (p.commercial_name || p.nf_description || '').trim()
  const out: string[] = [name]

  const highlights = (attrText(a.get('destaques_catalogo')) ?? '').split(';').map((s) => s.trim()).filter(Boolean)
  if (highlights.length) out.push('', 'Destaques:', ...highlights.map((h) => `- ${h}`))

  const specs: [string, string | null][] = [
    ['Marca', p.brand], ['Modelo', p.model], ['Material', p.material], ['Cor', p.color],
    ['Capacidade', capacityText(p)], ['Tamanho', attrText(a.get('tamanho'))],
    ['Dimensões (A x L x P)', dimsText(p.height_mm, p.width_mm, p.depth_mm)],
    ['Peso', p.weight_g != null ? formatGrams(p.weight_g) : null],
  ]
  const known = specs.filter(([, v]) => v)
  if (known.length) out.push('', 'Especificações:', ...known.map(([k, v]) => `- ${k}: ${v}`))
  return out.join('\n').trim()
}

/** Valores iniciais dos atributos do canal que vêm direto do cadastro. */
export function prefillAttributes(p: TemplateProduct, keys: string[]): Record<string, string> {
  const map: Record<string, string | null> = {
    marca: p.brand, modelo: p.model, gtin: p.ean, ean: p.ean, cor: p.color, material: p.material,
    peso_envio: p.gross_weight_g != null ? formatGrams(p.gross_weight_g) : p.weight_g != null ? formatGrams(p.weight_g) : null,
    dimensoes_pacote: dimsText(p.pkg_height_mm, p.pkg_width_mm, p.pkg_depth_mm),
    dimensoes: dimsText(p.height_mm, p.width_mm, p.depth_mm),
    capacidade: capacityText(p),
  }
  const out: Record<string, string> = {}
  for (const k of keys) { const v = map[k]; if (v) out[k] = v }
  return out
}

/** "mochila, escolar ,  infantil" → ['mochila','escolar','infantil'] (sem repetição) */
export function parseKeywords(raw: string) {
  const seen = new Set<string>()
  return raw.split(/[,;\n]/).map((s) => s.trim()).filter((s) => {
    const k = s.toLowerCase()
    if (!s || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Texto da ficha para colar em outro lugar. */
export function sheetText(p: TemplateProduct, attrs: TemplateAttr[]) {
  const a = confirmed(attrs)
  const rows: [string, string | null][] = [
    ['Produto', p.commercial_name || p.nf_description], ['Marca', p.brand], ['Modelo', p.model],
    ['SKU', p.internal_sku], ['Código do fornecedor', p.supplier_sku], ['EAN', p.ean],
    ['Material', p.material], ['Cor', p.color], ['Capacidade', capacityText(p)],
    ['Dimensões do produto (A x L x P)', dimsText(p.height_mm, p.width_mm, p.depth_mm)],
    ['Peso do produto', p.weight_g != null ? formatGrams(p.weight_g) : null],
    ['Dimensões da embalagem (A x L x P)', dimsText(p.pkg_height_mm, p.pkg_width_mm, p.pkg_depth_mm)],
    ['Peso bruto', p.gross_weight_g != null ? formatGrams(p.gross_weight_g) : null],
  ]
  for (const [k, at] of a) {
    if (['codigo_catalogo', 'preco_sugerido_catalogo', 'qtd_por_caixa'].includes(k)) continue
    rows.push([at.label ?? k, attrText(at)])
  }
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
}
