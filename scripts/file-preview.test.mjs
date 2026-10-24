import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { filePreviewKind } from '../shared/utils/file-preview.ts'
import { readPreviewWorkbook, spreadsheetPage } from '../app/utils/spreadsheet-preview.ts'

test('Word y Excel se detectan por extensión aunque el navegador omita el MIME', () => {
  for (const name of ['Libro.XLS', 'libro.xlsx', 'libro.ods', 'datos.csv', 'datos.tsv']) assert.equal(filePreviewKind(name), 'sheet')
  assert.equal(filePreviewKind('Presupuesto.DOCX'), 'word')
  assert.equal(filePreviewKind('', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'word')
  assert.equal(filePreviewKind('', 'application/vnd.ms-excel'), 'sheet')
  assert.equal(filePreviewKind('foto.jpg'), 'image')
  assert.equal(filePreviewKind('factura.pdf'), 'pdf')
  assert.equal(filePreviewKind('comprimido.zip'), 'other')
})

for (const bookType of ['xls', 'xlsx', 'ods']) {
  test(`${bookType}: conserva hojas, valores, fechas y formatos numéricos`, () => {
    const book = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([['Importe', 'Fecha'], [1234.56, 45292]])
    sheet.A2.z = '#,##0.00 "EUR"'
    sheet.B2.z = 'dd/mm/yyyy'
    sheet.A2.w = XLSX.utils.format_cell(sheet.A2)
    sheet.B2.w = XLSX.utils.format_cell(sheet.B2)
    XLSX.utils.book_append_sheet(book, sheet, 'Presupuesto')
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Detalle']]), 'Detalle')
    const parsed = readPreviewWorkbook(XLSX.write(book, { type: 'array', bookType }), `prueba.${bookType}`)
    assert.deepEqual(parsed.SheetNames, ['Presupuesto', 'Detalle'])
    const result = spreadsheetPage(parsed, 'Presupuesto', 0)
    assert.match(result.rows[1].cells[0], /1,234.56/)
    assert.equal(result.rows[1].cells[1], '01/01/2024')
    assert.equal(spreadsheetPage(parsed, 'Detalle', 0).rows[0].cells[0], 'Detalle')
  })
}

test('paginación acotada, hojas vacías y rangos que comienzan fuera de A1', () => {
  const sheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 205 }, (_, i) => [`Fila ${i}`]), { origin: 'C4' })
  sheet['!ref'] = 'C4:C208'
  const book = { SheetNames: ['Datos', 'Vacía'], Sheets: { Datos: sheet, Vacía: {} } }
  const result = spreadsheetPage(book, 'Datos', 1)
  assert.equal(result.rows.length, 100)
  assert.equal(result.rows[0].number, 104)
  assert.equal(result.rows[0].cells[0], 'Fila 100')
  assert.deepEqual(result.columns, ['C'])
  assert.equal(spreadsheetPage(book, 'Datos', 99).rows.length, 5)
  assert.equal(spreadsheetPage(book, 'Vacía', 0).rows.length, 0)
})

test('rangos excesivos no crean millones de nodos en una página', () => {
  const result = spreadsheetPage({ Sheets: { Datos: { '!ref': 'A1:XFD1048576' } }, SheetNames: ['Datos'] }, 'Datos', 0)
  assert.equal(result.rows.length, 100)
  assert.equal(result.columns.length, 100)
  assert.equal(result.limitedColumns, true)
})

test('CSV español y texto HTML de celdas se conservan como texto', () => {
  const data = new TextEncoder().encode('Nombre;Importe\n"<script>alert(1)</script>";"1.234,56"').buffer
  const book = readPreviewWorkbook(data, 'datos.csv')
  const result = spreadsheetPage(book, book.SheetNames[0], 0)
  assert.deepEqual(result.rows[1].cells, ['<script>alert(1)</script>', '1.234,56'])
})
