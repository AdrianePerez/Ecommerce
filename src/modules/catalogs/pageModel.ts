// Regras puras do módulo de catálogos (testadas sem navegador).

/** Página dupla (spread): bem mais larga que alta. */
export function isSpread(width: number, height: number) {
  return width / height > 1.2
}

/** Escala de renderização para a página ficar com a altura alvo em pixels. */
export function renderScale(viewHeightPt: number, targetPx = 1500) {
  return targetPx / viewHeightPt
}

export type PageSlice = { side: 'F' | 'L' | 'R'; sx: number; sw: number }

/** Como fatiar uma página renderizada: inteira, ou metade esquerda e direita. */
export function slicesFor(width: number, height: number, splitSpreads: boolean): PageSlice[] {
  if (splitSpreads && isSpread(width, height)) {
    const half = Math.floor(width / 2)
    return [{ side: 'L', sx: 0, sw: half }, { side: 'R', sx: half, sw: width - half }]
  }
  return [{ side: 'F', sx: 0, sw: width }]
}

/** Separa os textos da página entre metade esquerda e direita pela posição x. */
export function splitText(items: { str: string; x: number }[], pageWidth: number, slices: PageSlice[]) {
  if (slices.length === 1) return [items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()]
  const mid = pageWidth / 2
  const left = items.filter((i) => i.x < mid).map((i) => i.str)
  const right = items.filter((i) => i.x >= mid).map((i) => i.str)
  return [left, right].map((t) => t.join(' ').replace(/\s+/g, ' ').trim())
}

export function pagePath(catalogId: string, pageNumber: number) {
  return `${catalogId}/p${String(pageNumber).padStart(4, '0')}.jpg`
}

/** Miniatura da página (para a grade de páginas, sem baixar as imagens grandes). */
export function thumbPath(imagePath: string) {
  return imagePath.replace(/\.jpg$/, '_t.jpg')
}

// ---------------------------------------------------------------------
// Área da foto (bbox) normalizada 0–1 em relação à página
// ---------------------------------------------------------------------
export type BBox = { x: number; y: number; w: number; h: number }

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v))

/** Retângulo a partir de dois cantos (arrasto do mouse), já limitado à página. */
export function bboxFromPoints(ax: number, ay: number, bx: number, by: number): BBox {
  const x1 = clamp(Math.min(ax, bx)), y1 = clamp(Math.min(ay, by))
  const x2 = clamp(Math.max(ax, bx)), y2 = clamp(Math.max(ay, by))
  return round({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
}

/** Move ou redimensiona mantendo dentro da página e com tamanho mínimo. */
export function adjustBBox(b: BBox, handle: 'move' | 'nw' | 'ne' | 'sw' | 'se', dx: number, dy: number, min = 0.02): BBox {
  let { x, y, w, h } = b
  if (handle === 'move') {
    x = clamp(x + dx, 0, 1 - w)
    y = clamp(y + dy, 0, 1 - h)
    return round({ x, y, w, h })
  }
  let x2 = x + w, y2 = y + h
  if (handle === 'nw' || handle === 'sw') x = clamp(Math.min(x + dx, x2 - min))
  if (handle === 'ne' || handle === 'se') x2 = clamp(Math.max(x2 + dx, x + min))
  if (handle === 'nw' || handle === 'ne') y = clamp(Math.min(y + dy, y2 - min))
  if (handle === 'sw' || handle === 'se') y2 = clamp(Math.max(y2 + dy, y + min))
  return round({ x, y, w: x2 - x, h: y2 - y })
}

function round(b: BBox): BBox {
  const r = (v: number) => Math.round(v * 10000) / 10000
  return { x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) }
}

/** Retângulo em pixels para recortar a imagem da página. */
export function bboxToPixels(b: BBox, width: number, height: number) {
  const sx = Math.round(b.x * width), sy = Math.round(b.y * height)
  return { sx, sy, sw: Math.max(1, Math.min(width - sx, Math.round(b.w * width))), sh: Math.max(1, Math.min(height - sy, Math.round(b.h * height))) }
}

// ---------------------------------------------------------------------
// Leitura de medidas no formato dos catálogos: "41×31×15cm", "22 x 10 x 7 cm", "49×39cm"
// ---------------------------------------------------------------------
export function parseSize(text: string): { height_mm: number | null; width_mm: number | null; depth_mm: number | null } | null {
  const m = text.replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)(?:\s*[x×X*]\s*(\d+(?:\.\d+)?))?\s*(mm|cm)?/)
  if (!m) return null
  const f = m[4] === 'mm' ? 1 : 10
  const n = (v?: string) => (v ? Math.round(Number(v) * f * 10) / 10 : null)
  return { height_mm: n(m[1]), width_mm: n(m[2]), depth_mm: n(m[3]) }
}

/** Códigos de produto no texto da página (ex.: IS43481SR, EI43484SR). */
export function findCodes(text: string): string[] {
  return [...new Set(text.toUpperCase().match(/\b[A-Z]{2}\d{5}[A-Z]{2}\b/g) ?? [])]
}

/** Estilo CSS para mostrar só a área da foto usando a imagem da página como fundo. */
export function cropPreviewStyle(b: BBox, url: string) {
  const pos = (start: number, size: number) => (size >= 1 ? 0 : (start / (1 - size)) * 100)
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${100 / b.w}% ${100 / b.h}%`,
    backgroundPosition: `${pos(b.x, b.w)}% ${pos(b.y, b.h)}%`,
    backgroundRepeat: 'no-repeat',
    aspectRatio: `${b.w} / ${b.h}`,
  } as const
}

export type ProductValues = { height_mm: number | null; width_mm: number | null; depth_mm: number | null; weight_g: number | null; material: string | null; ean: string | null }
export type Divergence = { field: keyof ProductValues; label: string; current: string; catalog: string }

const DIV_LABELS: Record<keyof ProductValues, string> = {
  height_mm: 'Altura', width_mm: 'Largura', depth_mm: 'Profundidade', weight_g: 'Peso', material: 'Material', ean: 'EAN',
}

/** Campos em que produto e catálogo têm valores diferentes (os vazios do produto são só preenchidos). */
export function divergences(product: ProductValues, item: ProductValues): Divergence[] {
  const out: Divergence[] = []
  const show = (k: keyof ProductValues, v: number | string | null) =>
    v === null ? '—' : k.endsWith('_mm') ? `${(Number(v) / 10).toLocaleString('pt-BR')} cm` : k === 'weight_g' ? `${Number(v).toLocaleString('pt-BR')} g` : String(v)
  for (const k of Object.keys(DIV_LABELS) as (keyof ProductValues)[]) {
    const a = product[k], b = item[k]
    if (a === null || a === undefined || b === null || b === undefined || b === '') continue
    const same = typeof a === 'number' || k.endsWith('_mm') || k === 'weight_g'
      ? Number(a) === Number(b)
      : String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
    if (!same) out.push({ field: k, label: DIV_LABELS[k], current: show(k, a), catalog: show(k, b) })
  }
  return out
}
