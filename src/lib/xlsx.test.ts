import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { readFirstSheet } from './xlsx'

async function makeXlsx() {
  const z = new JSZip()
  z.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Vendas BR" sheetId="1" r:id="rId1"/></sheets></workbook>')
  z.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  z.file('xl/sharedStrings.xml', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>N.º de venda</t></si><si><r><t>Receita </t></r><r><t>(BRL)</t></r></si></sst>')
  z.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
    + '<row r="3"><c r="A3" t="inlineStr"><is><t>2000016285086671</t></is></c><c r="B3"><v>599.9</v></c></row>'
    + '</sheetData></worksheet>')
  return z.generateAsync({ type: 'uint8array' })
}

describe('leitor de xlsx', () => {
  it('lê textos compartilhados, texto embutido, números e linhas puladas', async () => {
    const rows = await readFirstSheet(await makeXlsx())
    expect(rows[0]).toEqual(['N.º de venda', null, 'Receita (BRL)'])
    expect(rows[1]).toEqual([])
    expect(rows[2]).toEqual(['2000016285086671', 599.9])
  })
  it('recusa arquivo que não é xlsx', async () => {
    await expect(readFirstSheet(new TextEncoder().encode('não é planilha'))).rejects.toThrow(/xlsx/)
  })
})
