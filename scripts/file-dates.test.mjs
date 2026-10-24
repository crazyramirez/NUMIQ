import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { PDFDocument, PDFName } from 'pdf-lib'
import { zipSync, strToU8 } from 'fflate'
import { resolveDocumentDate, validDocumentDate } from '../shared/utils/source-date.ts'
import * as tax from '../shared/utils/tax.ts'
import * as nif from '../shared/utils/nif.ts'

// Nitro resuelve imports TypeScript sin extensión. Hacer lo mismo en estas pruebas de Node.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context) }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context)
    throw error
  }
} })
const { resolveFileDate, timestampFileDate, zipEntryDates } = await import('../server/utils/file-date.ts')
const extraction = await import('../server/utils/extract.ts')
const { sheetRecords } = await import('../server/utils/sheet-import.ts')
const docRead = await import('../server/utils/doc-read.ts')
Object.assign(globalThis, tax, nif, extraction, docRead)

const fallback = { date: '2022-07-15', source: 'created' }
const originalModified = Date.parse('2021-05-04T10:00:00Z')
const uploadedAt = new Date('2026-10-23T10:00:00Z')
const asBuffer = bytes => Buffer.from(bytes)

test('la fecha del documento prevalece sobre los metadatos', () => {
  assert.deepEqual(resolveDocumentDate('2020-01-02', fallback), { date: '2020-01-02', fallback: null, warning: null })
})

test('fecha ausente o inválida usa automáticamente la alternativa con aviso de origen', () => {
  for (const value of [null, undefined, '', '2022-02-30', 'ilegible']) {
    const result = resolveDocumentDate(value, fallback)
    assert.equal(result.date, fallback.date)
    assert.equal(result.fallback.source, 'created')
    assert.match(result.warning, /creación del archivo/)
  }
  assert.equal(validDocumentDate('2024-02-29'), '2024-02-29')
  assert.equal(resolveDocumentDate(null, { ...fallback, date: '2023-02-29' }).date, null)
})

test('PDF: lee creación incluso en objetos comprimidos y la prioriza sobre modificación', async () => {
  const pdf = await PDFDocument.create()
  pdf.setCreationDate(new Date('2020-03-04T11:00:00Z'))
  pdf.setModificationDate(new Date('2025-08-09T11:00:00Z'))
  assert.deepEqual(await resolveFileDate(asBuffer(await pdf.save()), 'pdf', { lastModified: originalModified }), { date: '2020-03-04', source: 'created' })
})

test('PDF sin propiedades no recibe una creación inventada por la librería', async () => {
  const pdf = await PDFDocument.create()
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info)
  info.delete(PDFName.of('CreationDate'))
  info.delete(PDFName.of('ModDate'))
  assert.deepEqual(await resolveFileDate(asBuffer(await pdf.save()), 'pdf', { lastModified: originalModified }), { date: '2021-05-04', source: 'modified' })
})

test('PDF: recupera creación del XMP comprimido cuando no existe CreationDate', async () => {
  const pdf = await PDFDocument.create()
  pdf.context.lookup(pdf.context.trailerInfo.Info).delete(PDFName.of('CreationDate'))
  const stream = pdf.context.flateStream(strToU8('<rdf:Description xmp:CreateDate="2017-08-09T12:00:00Z" />'), { Type: 'Metadata', Subtype: 'XML' })
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(stream))
  assert.deepEqual(await resolveFileDate(asBuffer(await pdf.save()), 'pdf'), { date: '2017-08-09', source: 'created' })
})

for (const ext of ['docx', 'xlsx']) {
  test(`${ext}: usa creación de las propiedades originales de Office`, async () => {
    const zip = zipSync({ 'docProps/core.xml': strToU8('<cp:coreProperties><dcterms:created xsi:type="dcterms:W3CDTF">2019-12-31T23:59:00-03:00</dcterms:created><dcterms:modified>2025-01-01T12:00:00Z</dcterms:modified></cp:coreProperties>') })
    assert.deepEqual(await resolveFileDate(asBuffer(zip), ext, { lastModified: originalModified }), { date: '2019-12-31', source: 'created' })
  })
}

test('OpenDocument: reconoce meta:creation-date', async () => {
  const zip = zipSync({ 'meta.xml': strToU8('<office:meta><meta:creation-date>2020-02-29T08:00:00</meta:creation-date></office:meta>') })
  assert.deepEqual(await resolveFileDate(asBuffer(zip), 'odt'), { date: '2020-02-29', source: 'created' })
})

test('JPEG: usa la fecha EXIF original de la fotografía', async () => {
  const tiff = Buffer.alloc(64)
  tiff.write('II', 0); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x8769, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18)
  tiff.writeUInt16LE(1, 26); tiff.writeUInt16LE(0x9003, 28); tiff.writeUInt16LE(2, 30); tiff.writeUInt32LE(20, 32); tiff.writeUInt32LE(44, 36)
  tiff.write('2021:06:07 12:00:00\0', 44)
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0])
  header.writeUInt16BE(exif.length + 2, 4)
  const jpeg = Buffer.concat([header, exif, Buffer.from([0xff, 0xd9])])
  assert.deepEqual(await resolveFileDate(jpeg, 'jpg'), { date: '2021-06-07', source: 'created' })
})

test('metadatos dañados no impiden usar la modificación original', async () => {
  assert.deepEqual(await resolveFileDate(Buffer.from('malformado'), 'pdf', { lastModified: String(originalModified) }), { date: '2021-05-04', source: 'modified' })
})

test('sin creación ni modificación usa subida y la identifica correctamente', async () => {
  const date = await resolveFileDate(Buffer.from('a,b'), 'csv', { uploadedAt })
  assert.deepEqual(date, { date: '2026-10-23', source: 'uploaded' })
  assert.match(resolveDocumentDate(null, date).warning, /no constan su creación ni su modificación original/)
  assert.equal(timestampFileDate('NaN'), null)
  assert.equal(timestampFileDate(0), null)
  assert.equal(timestampFileDate(Date.parse('2022-10-30T23:30:00Z')), '2022-10-31')
})

test('ZIP: conserva la fecha de cada archivo y de los ZIP anidados', () => {
  const nested = zipSync({ 'dentro.csv': [strToU8('a,b'), { mtime: new Date(2020, 2, 4, 12) }] })
  const zip = asBuffer(zipSync({
    'primero.csv': [strToU8('a,b'), { mtime: new Date(2021, 4, 6, 12) }],
    'segundo.csv': [strToU8('a,b'), { mtime: new Date(2022, 6, 8, 12) }],
    'anidado.zip': [nested, { mtime: new Date(2025, 1, 1, 12) }],
  }))
  const entries = docRead.expandZip(zip)
  assert.equal(entries.find(e => e.path === 'primero.csv').sourceDate.date, '2021-05-06')
  assert.equal(entries.find(e => e.path === 'segundo.csv').sourceDate.date, '2022-07-08')
  assert.equal(entries.find(e => e.path === 'anidado/dentro.csv').sourceDate.date, '2020-03-04')
  assert.equal(zipEntryDates(Buffer.from('')).size, 0)
})

test('una creación de ZIP tiene preferencia sobre la modificación del navegador', async () => {
  assert.deepEqual(await resolveFileDate(Buffer.from('a,b'), 'csv', { archiveDate: fallback, lastModified: originalModified }), fallback)
})

test('ZIP de Windows: lee fecha de creación NTFS cuando se conserva en la entrada', () => {
  const extra = Buffer.alloc(32)
  extra.writeUInt16LE(1, 4); extra.writeUInt16LE(24, 6)
  extra.writeBigUInt64LE(BigInt(Date.parse('2019-03-04T12:00:00Z') + 11644473600000) * 10000n, 16)
  const zip = asBuffer(zipSync({ 'archivo.csv': [strToU8('a,b'), { extra: { 10: extra }, mtime: new Date(2025, 1, 1) }] }))
  assert.deepEqual(zipEntryDates(zip).get('archivo.csv'), { date: '2019-03-04', source: 'created' })
})

const doc = { documentType: 'invoice', issuer: null, recipient: null, number: 'F001', issueDate: null, dueDate: null, lines: [], taxLines: [{ base: 100, vatRate: 21, vatAmount: 21, surchargeRate: 0, surchargeAmount: 0 }], total: 121, irpfRate: 0, irpfAmount: 0, warnings: [], confidence: 100, paid: false, currency: 'EUR' }
const ctx = { company: { legalName: 'Empresa', nif: 'B12345678' }, categories: [], path: 'archivo.pdf', direction: 'received', today: '2026-10-23', fileDate: fallback }

for (const direction of ['received', 'issued']) {
  test(`${direction}: conversión compartida por escaneo y lotes aplica fecha antes de validar`, () => {
    const result = extraction.toInvoiceData(doc, direction, ctx)
    assert.equal(result.blocking, false)
    assert.equal(result.data.issueDate, fallback.date)
    assert.deepEqual(result.data.dateFallback, fallback)
    assert.ok(result.warnings.some(w => w.includes('creación del archivo')))
    const dated = extraction.toInvoiceData({ ...doc, issueDate: '2018-04-01' }, direction, ctx)
    assert.equal(dated.data.issueDate, '2018-04-01')
    assert.equal(dated.data.dateFallback, null)
  })
}

test('Excel/CSV: filas sin fecha ni número usan fecha del archivo sin importar la fila de totales', () => {
  const sheet = { name: 'Hoja', rows: [['Proveedor A', 100, 21, 121], ['Proveedor B', 200, 42, 242], [null, 300, 63, 363]] }
  const mapping = { name: 'Hoja', kind: 'invoice_list', direction: 'received', contactRole: 'supplier', headerRow: null, firstDataRow: 1, dateOrder: 'dmy', columns: { partyName: 0, base: 1, vatAmount: 2, total: 3 }, taxGroups: [], defaultVatRate: 21 }
  const records = sheetRecords(sheet, mapping, ctx, null)
  assert.equal(records.length, 2)
  for (const record of records) {
    assert.equal(record.data.issueDate, fallback.date)
    assert.equal(record.blocking, false)
    assert.equal(record.data.dateFallback.source, 'created')
  }
})
