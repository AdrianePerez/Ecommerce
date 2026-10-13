import { bboxToPixels, type BBox } from './pageModel'

/** Recorta a área da foto da imagem da página e devolve um JPEG. */
export async function cropImage(url: string, b: BBox, quality = 0.9): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Não foi possível baixar a imagem da página para recortar.')
  const bitmap = await createImageBitmap(await res.blob())
  const { sx, sy, sw, sh } = bboxToPixels(b, bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sw, sh)
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar o recorte'))), 'image/jpeg', quality))
}
