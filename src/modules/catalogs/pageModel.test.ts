import { describe, expect, it } from 'vitest'
import { adjustBBox, bboxFromPoints, bboxToPixels, findCodes, isSpread, pagePath, parseSize, slicesFor, splitText, thumbPath } from './pageModel'

describe('páginas do catálogo', () => {
  it('reconhece página dupla e divide ao meio', () => {
    expect(isSpread(2105, 1488)).toBe(true)
    expect(isSpread(1052, 1488)).toBe(false)
    expect(slicesFor(2105, 1488, true)).toEqual([{ side: 'L', sx: 0, sw: 1052 }, { side: 'R', sx: 1052, sw: 1053 }])
    expect(slicesFor(2105, 1488, false)).toEqual([{ side: 'F', sx: 0, sw: 2105 }])
    expect(slicesFor(1052, 1488, true)).toEqual([{ side: 'F', sx: 0, sw: 1052 }])
  })
  it('separa o texto entre as metades', () => {
    const items = [{ str: 'R$ 59.99', x: 100 }, { str: 'R$ 44.99', x: 600 }, { str: 'R$ 19.99', x: 200 }]
    expect(splitText(items, 842, slicesFor(2105, 1488, true))).toEqual(['R$ 59.99 R$ 19.99', 'R$ 44.99'])
  })
  it('caminho da imagem da página', () => {
    expect(pagePath('abc', 7)).toBe('abc/p0007.jpg')
    expect(thumbPath('abc/p0007.jpg')).toBe('abc/p0007_t.jpg')
  })
})

describe('área da foto', () => {
  it('cria o retângulo em qualquer direção do arrasto, dentro da página', () => {
    expect(bboxFromPoints(0.8, 0.9, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, w: 0.6, h: 0.8 })
    expect(bboxFromPoints(-0.1, 0.5, 1.3, 0.7)).toEqual({ x: 0, y: 0.5, w: 1, h: 0.2 })
  })
  it('move sem sair da página e redimensiona com tamanho mínimo', () => {
    const b = { x: 0.7, y: 0.7, w: 0.2, h: 0.2 }
    expect(adjustBBox(b, 'move', 0.5, 0.5)).toEqual({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 })
    expect(adjustBBox(b, 'se', 0.5, 0.5)).toEqual({ x: 0.7, y: 0.7, w: 0.3, h: 0.3 })
    expect(adjustBBox(b, 'nw', 0.5, 0.5).w).toBeCloseTo(0.02)
  })
  it('converte em pixels para o recorte', () => {
    expect(bboxToPixels({ x: 0.5, y: 0.25, w: 0.5, h: 0.5 }, 1000, 1400)).toEqual({ sx: 500, sy: 350, sw: 500, sh: 700 })
  })
})

describe('leitura de medidas e códigos', () => {
  it('medidas no formato do catálogo', () => {
    expect(parseSize('Size: 41×31×15cm')).toEqual({ height_mm: 410, width_mm: 310, depth_mm: 150 })
    expect(parseSize('22 x 10 x 7,5 cm')).toEqual({ height_mm: 220, width_mm: 100, depth_mm: 75 })
    expect(parseSize('49×39cm')).toEqual({ height_mm: 490, width_mm: 390, depth_mm: null })
    expect(parseSize('sem medida')).toBeNull()
  })
  it('encontra códigos de produto', () => {
    expect(findCodes('IC43482SR LA43483SR R$ 159.99 IS43481SR is43481sr')).toEqual(['IC43482SR', 'LA43483SR', 'IS43481SR'])
  })
})

import { cropPreviewStyle, divergences } from './pageModel'

describe('recorte e divergências', () => {
  it('prévia do recorte por CSS', () => {
    const s = cropPreviewStyle({ x: 0.5, y: 0.25, w: 0.5, h: 0.5 }, 'u')
    expect(s.backgroundSize).toBe('200% 200%')
    expect(s.backgroundPosition).toBe('100% 50%')
  })
  it('aponta só valores diferentes, ignorando vazios', () => {
    const d = divergences(
      { height_mm: 400, width_mm: 310, depth_mm: null, weight_g: null, material: 'nailon', ean: null },
      { height_mm: 410, width_mm: 310, depth_mm: 150, weight_g: null, material: 'Náilon', ean: null },
    )
    expect(d.map((x) => x.field)).toEqual(['height_mm', 'material'])
    expect(d[0]).toMatchObject({ current: '40 cm', catalog: '41 cm' })
  })
})
