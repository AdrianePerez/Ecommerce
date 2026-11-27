// Leitor mínimo de .xlsx (primeira planilha) usando o jszip que o projeto já tem.
// Devolve as linhas como listas de células (texto ou número), na posição da coluna.
import JSZip from 'jszip'

export type Cell = string | number | null

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+/g, '')
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
const textOf = (el: Element | null) => (el ? [...el.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('') : '')

export async function readFirstSheet(data: ArrayBuffer | Uint8Array): Promise<Cell[][]> {
  let zip: JSZip
  try { zip = await JSZip.loadAsync(data) } catch { throw new Error('Arquivo não é uma planilha .xlsx válida.') }
  const xml = async (path: string) => {
    const f = zip.file(path)
    return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null
  }
  const wb = await xml('xl/workbook.xml')
  const rels = await xml('xl/_rels/workbook.xml.rels')
  if (!wb || !rels) throw new Error('Arquivo não é uma planilha .xlsx válida.')
  const sheet = wb.getElementsByTagName('sheet')[0]
  const rid = sheet?.getAttribute('r:id') ?? sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const rel = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)
  let target = rel?.getAttribute('Target') ?? 'worksheets/sheet1.xml'
  target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const ws = await xml(target)
  if (!ws) throw new Error('Planilha vazia ou corrompida.')
  const ssDoc = await xml('xl/sharedStrings.xml')
  const shared = ssDoc ? [...ssDoc.getElementsByTagName('si')].map((si) => textOf(si)) : []

  const out: Cell[][] = []
  for (const row of ws.getElementsByTagName('row')) {
    const r = Number(row.getAttribute('r') ?? out.length + 1) - 1
    const cells: Cell[] = []
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r')
      const i = ref ? colIndex(ref) : cells.length
      const t = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? null
      let val: Cell = null
      if (t === 's') val = v === null ? null : shared[Number(v)] ?? null
      else if (t === 'inlineStr') val = textOf(c.getElementsByTagName('is')[0] ?? null)
      else if (t === 'str' || t === 'e') val = v
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE'
      else val = v === null || v === '' ? null : Number(v)
      cells[i] = val
    }
    for (let k = 0; k < cells.length; k++) if (cells[k] === undefined) cells[k] = null
    out[r] = cells
  }
  for (let k = 0; k < out.length; k++) if (!out[k]) out[k] = []
  return out
}
