// Regras puras da galeria de imagens (sem acesso a rede).

export type ImageKind = 'oficial' | 'tecnica' | 'detalhe' | 'referencia' | 'capa' | 'gerada_editada'
export type ImageStatus = 'aguardando_revisao' | 'aprovada' | 'rejeitada'
export type ImageRights = 'a_verificar' | 'autorizada' | 'fornecedor' | 'propria' | 'nao_autorizada'
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export const KIND_LABEL: Record<ImageKind, string> = {
  oficial: 'Foto oficial', tecnica: 'Foto técnica', detalhe: 'Detalhe', referencia: 'Referência',
  capa: 'Capa comercial', gerada_editada: 'Gerada ou editada',
}
export const STATUS_LABEL: Record<ImageStatus, string> = {
  aguardando_revisao: 'A revisar', aprovada: 'Aprovada', rejeitada: 'Rejeitada',
}
export const STATUS_TONE: Record<ImageStatus, 'warn' | 'good' | 'bad'> = {
  aguardando_revisao: 'warn', aprovada: 'good', rejeitada: 'bad',
}
export const RIGHTS_LABEL: Record<ImageRights, string> = {
  a_verificar: 'Uso a verificar', autorizada: 'Uso autorizado', fornecedor: 'Material do fornecedor',
  propria: 'Foto própria', nao_autorizada: 'Uso não autorizado',
}
export const RIGHTS_TONE: Record<ImageRights, 'warn' | 'good' | 'bad' | 'neutral'> = {
  a_verificar: 'warn', autorizada: 'good', fornecedor: 'neutral', propria: 'good', nao_autorizada: 'bad',
}

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const THUMB_SIZE = 400

const EXT: Record<ImageMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Identifica o tipo real do arquivo pelos primeiros bytes (não confia na extensão). */
export function sniffImageMime(head: Uint8Array): ImageMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b)) return 'image/png'
  if (head.length >= 12 && String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP')
    return 'image/webp'
  return null
}

export function checkImageFile(size: number, mime: ImageMime | null): string | null {
  if (!mime) return 'Formato não aceito. Use JPG, PNG ou WebP.'
  if (size > MAX_IMAGE_BYTES) return `Arquivo com ${(size / 1024 / 1024).toFixed(1).replace('.', ',')} MB; o limite é 15 MB.`
  return null
}

export const imagePath = (productId: string, imageId: string, mime: ImageMime) => `${productId}/${imageId}.${EXT[mime]}`
export const thumbOf = (path: string) => path.replace(/\.(jpg|png|webp)$/, '_t.jpg')
export const extOf = (mime: string) => EXT[mime as ImageMime] ?? 'jpg'

/** Nome do arquivo no pacote para o Canva: SKU_01_foto-oficial.jpg */
export function zipEntryName(sku: string | null, index: number, kind: ImageKind, mime: string) {
  const base = (sku || 'produto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'produto'
  const k = KIND_LABEL[kind].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base}_${String(index).padStart(2, '0')}_${k}.${extOf(mime)}`
}

/** Move um item uma posição para trás (-1) ou para frente (+1). */
export function moveInList<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[index], out[j]] = [out[j], out[index]]
  return out
}

/** URL aceita para importar imagem: só http(s), sem endereço local. A checagem definitiva é no servidor. */
export function checkImageUrl(raw: string): string | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return 'Link inválido.' }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Use um link que comece com http:// ou https://.'
  if (/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[)/i.test(u.hostname)) return 'Endereços locais não são aceitos.'
  return null
}
