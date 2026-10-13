import { describe, expect, it } from 'vitest'
import { buildDescription, buildTitle, fitWords, parseKeywords, prefillAttributes, sheetText, type TemplateAttr, type TemplateProduct } from './listingModel'
import { checkImageFile, checkImageUrl, moveInList, sniffImageMime, thumbOf, zipEntryName } from '@/modules/images/imageModel'

const p: TemplateProduct = {
  commercial_name: 'Mochila Cinnamoroll Cetim', nf_description: 'MOCHILA CINNAMOROLL', brand: 'Luxcel', model: 'IS43531SR',
  color: 'Azul', material: 'Poliéster', capacity_value: 20, capacity_unit: 'L', height_mm: 410, width_mm: 310, depth_mm: 155,
  weight_g: 650, pkg_height_mm: 450, pkg_width_mm: 330, pkg_depth_mm: 170, gross_weight_g: 800, ean: '7891234567895',
  internal_sku: 'IS43531SR0200UN', supplier_sku: 'IS43531SR0200UN',
}
const attrs: TemplateAttr[] = [
  { attr_key: 'tamanho', label: 'Tamanho', value_text: '16"', value_num: null, unit: null, validation_status: 'confirmada' },
  { attr_key: 'destaques_catalogo', label: 'Destaques', value_text: 'Chaveiro de pelúcia; Logo aplicado', value_num: null, unit: null, validation_status: 'confirmada' },
  { attr_key: 'garantia', label: 'Garantia', value_text: '1 ano', value_num: null, unit: null, validation_status: 'aguardando_revisao' },
]

describe('título do anúncio', () => {
  it('junta nome, tamanho, marca e cor sem repetir', () => {
    expect(buildTitle(p, attrs, null)).toBe('Mochila Cinnamoroll Cetim 16" Luxcel Azul')
    expect(buildTitle({ ...p, commercial_name: 'Mochila Luxcel Azul' }, [], null)).toBe('Mochila Luxcel Azul')
  })
  it('respeita o limite tirando os opcionais do fim', () => {
    expect(buildTitle(p, attrs, 32)).toBe('Mochila Cinnamoroll Cetim 16"')
    expect(buildTitle(p, attrs, 20)).toBe('Mochila Cinnamoroll')
    expect(fitWords('abc defgh', 5)).toBe('abc')
  })
})

describe('descrição', () => {
  it('usa só dados confirmados e o cadastro', () => {
    const d = buildDescription(p, attrs)
    expect(d).toContain('- Chaveiro de pelúcia')
    expect(d).toContain('- Dimensões (A x L x P): 41 x 31 x 15,5 cm')
    expect(d).toContain('- Capacidade: 20 L')
    expect(d).not.toContain('Garantia')
    expect(d).not.toMatch(/<[a-z]/i)
  })
  it('omite o que não existe', () => {
    const d = buildDescription({ ...p, material: null, height_mm: null, capacity_value: null, capacity_unit: null }, [])
    expect(d).not.toContain('Material')
    expect(d).not.toContain('Dimensões')
    expect(d).not.toContain('Destaques')
  })
})

describe('atributos e palavras-chave', () => {
  it('preenche atributos do canal a partir do cadastro', () => {
    expect(prefillAttributes(p, ['marca', 'modelo', 'gtin', 'peso_envio', 'dimensoes_pacote', 'personagem'])).toEqual({
      marca: 'Luxcel', modelo: 'IS43531SR', gtin: '7891234567895', peso_envio: '800 g', dimensoes_pacote: '45 x 33 x 17 cm',
    })
  })
  it('separa palavras-chave sem repetir', () => {
    expect(parseKeywords('mochila, Escolar ;mochila\n infantil ,')).toEqual(['mochila', 'Escolar', 'infantil'])
  })
  it('ficha comercial em texto', () => {
    const s = sheetText(p, attrs)
    expect(s).toContain('SKU: IS43531SR0200UN')
    expect(s).toContain('Tamanho: 16"')
    expect(s).not.toContain('Garantia')
  })
})

describe('galeria de imagens', () => {
  it('reconhece o tipo pelo conteúdo', () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(sniffImageMime(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffImageMime(new TextEncoder().encode('<html>'))).toBeNull()
  })
  it('limites e caminhos', () => {
    expect(checkImageFile(16 * 1024 * 1024, 'image/jpeg')).toMatch(/15 MB/)
    expect(checkImageFile(100, null)).toMatch(/Formato/)
    expect(thumbOf('p/abc.png')).toBe('p/abc_t.jpg')
    expect(zipEntryName('IS43531SR0200UN', 3, 'oficial', 'image/png')).toBe('IS43531SR0200UN_03_foto-oficial.png')
    expect(checkImageUrl('ftp://x/y.jpg')).toMatch(/http/)
    expect(checkImageUrl('http://192.168.0.1/a.jpg')).toMatch(/locais/)
    expect(checkImageUrl('https://luxcel.com.br/a.jpg')).toBeNull()
  })
  it('reordena', () => {
    expect(moveInList(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveInList(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
  })
})
