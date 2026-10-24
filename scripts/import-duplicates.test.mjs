import test from 'node:test'
import assert from 'node:assert/strict'
import { ImportDuplicateIndex, duplicateMatch, findSimilarContact, importDuplicateReason, sameImportParty, similarNames, findImportContact } from '../shared/utils/duplicate-matching.ts'
import { mergeInvoiceSheetRows } from '../server/utils/sheet-import.ts'
import { round2 } from '../shared/utils/tax.ts'

// Las utilidades compartidas se autoimportan en Nitro.
globalThis.round2 = round2

const party = { name: 'Árbol Servicios, S.L.', nif: 'B12345678', email: 'hola@arbol.test' }
const document = { type: 'expense', kind: 'invoice', party, number: 'F-001/26', issueDate: '2026-10-20', total: 121 }

test('normaliza NIF con prefijo ES, separadores, mayúsculas y nombres comerciales', () => {
  assert.ok(sameImportParty(party, { name: 'Otro nombre', nif: 'ES B-12345678' }))
  assert.ok(sameImportParty(party, { name: 'ARBOL SERVICIOS SL' }))
  assert.ok(sameImportParty({ name: 'Razón social', tradeName: 'Árbol Servicios' }, { name: 'arbol servicios' }))
})

test('email y teléfono con dirección reconocen contactos sin NIF', () => {
  assert.ok(sameImportParty(party, { name: 'Árbol nuevo', email: ' HOLA@ARBOL.TEST ' }))
  assert.ok(sameImportParty({ phone: '600 123 456', address: 'Calle Sol 1' }, { phone: '600123456', address: 'CALLE SOL, 1' }))
  assert.equal(sameImportParty({ phone: '600123456' }, { phone: '600123456' }), false)
})

test('dos NIF distintos no se fusionan por nombre, email o teléfono', () => {
  assert.equal(sameImportParty(party, { ...party, nif: 'B87654321' }), false)
  assert.equal(findImportContact([{ ...party, id: 1 }], { ...party, nif: 'B87654321' }), undefined)
})

test('el NIF exacto prevalece sobre homónimos y no elige contactos ambiguos', () => {
  const contacts = [{ name: party.name, id: 1 }, { ...party, id: 2 }]
  assert.equal(findImportContact(contacts, party)?.id, 2)
  assert.equal(findImportContact(contacts, { name: party.name }), undefined)
})

test('no compara campos vacíos como identidad', () => {
  assert.equal(sameImportParty({}, {}), false)
  assert.equal(sameImportParty({ name: '---', nif: ' ' }, { name: '...', nif: '-' }), false)
})

for (const type of ['expense', 'sales']) {
  test(`${type}: número normalizado identifica una reimportación`, () => {
    assert.ok(importDuplicateReason({ ...document, type }, { ...document, type, number: ' f001_26 ' }))
  })
  test(`${type}: sin número compara contraparte, fecha e importe`, () => {
    assert.equal(duplicateMatch({ ...document, type, number: null }, { ...document, type, party: { name: 'ARBOL SERVICIOS' } })?.certain, true)
    assert.equal(importDuplicateReason({ ...document, type, number: null }, { ...document, type, total: 122 }), null)
  })
  test(`${type}: sin número, la misma contraparte e importe con pocos días de diferencia es probable`, () => {
    assert.equal(duplicateMatch({ ...document, type, number: null }, { ...document, type, issueDate: '2026-10-21' })?.certain, false)
    assert.equal(duplicateMatch({ ...document, type, number: null }, { ...document, type, issueDate: '2026-10-25' })?.certain, false)
    assert.equal(duplicateMatch({ ...document, type, number: null }, { ...document, type, issueDate: '2026-10-26' }), null)
  })
  test(`${type}: el mismo número escrito de otra forma (ceros, serie) con el mismo importe es probable`, () => {
    const a = { ...document, type, number: 'F-0046/26' }
    assert.equal(duplicateMatch(a, { ...document, type, number: '46-26' })?.certain, false)
    assert.equal(duplicateMatch(a, { ...document, type, number: '46-26', total: 50 }), null)
    assert.equal(duplicateMatch(a, { ...document, type, number: '47-26' }), null)
  })
  test(`${type}: otros ceros a la izquierda o separadores son el mismo número`, () => {
    assert.equal(duplicateMatch({ ...document, type, number: 'FE26-000123' }, { ...document, type, number: 'fe26/123' })?.certain, true)
    assert.equal(duplicateMatch({ ...document, type, number: 'A-12' }, { ...document, type, number: 'B-12' }), null)
  })
  test(`${type}: dos números distintos con igual fecha e importe son documentos diferentes`, () => {
    assert.equal(importDuplicateReason({ ...document, type }, { ...document, type, number: 'F00226' }), null)
  })
  test(`${type}: numeraciones repetidas en distintos ejercicios son válidas`, () => {
    assert.equal(importDuplicateReason({ ...document, type }, { ...document, type, issueDate: '2025-10-20' }), null)
  })
}

test('el mismo número de dos proveedores distintos no es un duplicado', () => {
  assert.equal(importDuplicateReason(document, { ...document, party: { ...party, nif: 'B87654321' } }), null)
})

test('facturas, presupuestos, proformas y gastos mantienen identidades separadas', () => {
  const kinds = [{ type: 'expense', kind: 'invoice' }, { type: 'sales', kind: 'invoice' }, { type: 'sales', kind: 'quote' }, { type: 'sales', kind: 'proforma' }]
  for (const a of kinds) for (const b of kinds) {
    assert.equal(!!importDuplicateReason({ ...document, ...a }, { ...document, ...b }), a === b)
  }
})

test('importe solo, sin contraparte o sin fecha no basta', () => {
  assert.equal(importDuplicateReason({ ...document, number: null, party: null }, document), null)
  assert.equal(importDuplicateReason({ ...document, number: null, issueDate: null }, document), null)
  assert.equal(importDuplicateReason({ ...document, number: null, total: NaN }, document), null)
})

test('redondea importes a céntimos conservando el signo', () => {
  assert.ok(importDuplicateReason({ ...document, number: null, total: 121.00000001 }, document))
  assert.equal(importDuplicateReason({ ...document, number: null, total: -121 }, document), null)
})

test('índice detecta duplicados internos y guarda la referencia al registro existente', () => {
  const index = new ImportDuplicateIndex()
  assert.equal(index.find(document), null)
  index.add(document, { id: 42 })
  assert.equal(index.find({ ...document, number: 'F00126' })?.value.id, 42)
  assert.equal(index.find({ ...document, number: null, party: { name: 'arbol servicios' } })?.value.id, 42)
  assert.equal(index.find({ ...document, number: 'OTRO' }), null)
})

test('índice conserva todos los proveedores con el mismo número', () => {
  const index = new ImportDuplicateIndex()
  index.add(document, 1)
  index.add({ ...document, party: { name: 'Otro', nif: 'B87654321' } }, 2)
  assert.equal(index.find(document)?.value, 1)
  assert.equal(index.find({ ...document, party: { nif: 'B87654321' } })?.value, 2)
})

test('índice compara clientes y proveedores por los mismos datos del contacto', () => {
  const index = new ImportDuplicateIndex()
  index.add({ type: 'contact', party }, 7)
  assert.equal(index.find({ type: 'contact', party: { name: 'ARBOL SERVICIOS' } })?.value, 7)
  assert.equal(index.find({ type: 'contact', party: { ...party, nif: 'B87654321' } }), null)
})

const taxDoc = (base, rate) => ({ taxLines: [{ base, vatRate: rate, vatAmount: base * rate / 100, surchargeAmount: 0 }], total: base * (1 + rate / 100), irpfAmount: null, irpfRate: null, summary: null })

test('Excel: una fila duplicada no duplica bases, IVA ni total', () => {
  const doc = taxDoc(100, 21)
  const rows = mergeInvoiceSheetRows([{ key: 'F1', doc }, { key: 'F1', doc: structuredClone(doc) }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].total, 121)
  assert.equal(rows[0].taxLines.length, 1)
})

test('Excel: mantiene desgloses de IVA diferentes y omite las repeticiones', () => {
  const first = taxDoc(100, 21), second = taxDoc(200, 10)
  const rows = mergeInvoiceSheetRows([{ key: 'F1', doc: first }, { key: 'F1', doc: second }, { key: 'F1', doc: structuredClone(second) }])
  assert.equal(rows[0].total, 341)
  assert.equal(rows[0].taxLines.length, 2)
})

test('gasto: el mismo número e importe aunque el proveedor esté escrito de otra forma', () => {
  const a = { ...document, party: { name: 'REPSOL' } }
  assert.equal(duplicateMatch(a, { ...document, party: { name: 'Repsol Comercial de Productos Petrolíferos', nif: 'A80298839' } })?.certain, true)
  assert.equal(duplicateMatch(a, { ...document, total: 99, party: { name: 'Repsol Comercial' } }), null)
})

test('gasto del banco y ticket escaneado: mismo importe, nombre parecido y fechas cercanas', () => {
  const bank = { type: 'expense', kind: 'ticket', party: { name: 'Repsol' }, number: null, issueDate: '2026-10-22', total: 60.5, description: 'COMPRA TARJ REPSOL 1234' }
  const ticket = { type: 'expense', kind: 'ticket', party: { name: 'REPSOL ESTACIÓN DE SERVICIO', nif: 'A12345674' }, number: 'T-998', issueDate: '2026-10-20', total: 60.5, description: 'Gasolina' }
  assert.equal(duplicateMatch(ticket, bank)?.certain, false)
  assert.equal(duplicateMatch({ ...ticket, total: 61 }, bank), null)
  assert.equal(duplicateMatch({ ...ticket, issueDate: '2026-10-10' }, bank), null)
  assert.equal(duplicateMatch({ ...ticket, party: { name: 'Cepsa' }, description: null }, bank), null)
})

test('gastos sin proveedor se reconocen por el concepto', () => {
  const a = { type: 'expense', party: null, number: null, issueDate: '2026-10-30', total: 294, description: 'Cuota de autónomos' }
  const b = { type: 'expense', party: { name: 'Tesorería General de la Seguridad Social' }, number: null, issueDate: '2026-10-31', total: 294, description: 'Cuota autónomos octubre' }
  assert.equal(duplicateMatch(a, b)?.certain, false)
  assert.equal(duplicateMatch({ ...a, description: 'Material de oficina' }, b), null)
})

test('nombres parecidos: palabras significativas, sin formas jurídicas ni relleno', () => {
  assert.ok(similarNames('Endesa', 'Endesa Energía, S.A.U.'))
  assert.ok(similarNames('TRANSF. ARBOL SERVICIOS', 'Transferencia a favor de Árbol Servicios SL · Fra 46/2026'))
  assert.equal(similarNames('Juan', 'Juan Pérez'), false)
  assert.equal(similarNames('Servicios Lumbre', 'Árbol Servicios'), false)
  assert.equal(similarNames('Recibo', 'Recibo Endesa'), false)
})

test('contacto parecido: único, y nunca entre dos NIF distintos', () => {
  const contacts = [{ id: 1, name: 'Endesa' }, { id: 2, name: 'Movistar', nif: 'A82018474' }]
  assert.equal(findSimilarContact(contacts, { name: 'Endesa Energía S.A.U.', nif: 'A81948077' })?.id, 1)
  assert.equal(findSimilarContact(contacts, { name: 'Movistar Telefónica', nif: 'B00000000' }), undefined)
  assert.equal(findSimilarContact(contacts, { name: 'Movistar Telefónica' })?.id, 2)
  // «Endesa» a secas puede ser cualquiera de las dos: no se adjudica al azar
  assert.equal(findSimilarContact([{ id: 1, name: 'Endesa Energía' }, { id: 3, name: 'Endesa Distribución' }], { name: 'Endesa' }), undefined)
})

test('índice: lo seguro antes que lo probable, y certainOnly descarta lo probable', () => {
  const index = new ImportDuplicateIndex()
  index.add({ ...document, number: null, issueDate: '2026-10-18' }, 'cercano')
  assert.equal(index.find({ ...document, number: null })?.value, 'cercano')
  assert.equal(index.find({ ...document, number: null })?.certain, false)
  assert.equal(index.find({ ...document, number: null }, { certainOnly: true }), null)
  index.add(document, 'mismo')
  assert.equal(index.find(document)?.value, 'mismo')
  assert.equal(index.find(document)?.certain, true)
})

test('gasto creado desde el banco: la factura puede ser hasta 35 días anterior al cargo', () => {
  const bank = { type: 'expense', party: { name: 'Endesa' }, number: null, issueDate: '2026-10-05', total: 60.5, description: 'RECIBO ENDESA', paidOnBank: true }
  const invoice = { type: 'expense', party: { name: 'Endesa Energía S.A.U.', nif: 'A81948077' }, number: 'FE26-123', issueDate: '2026-09-15', total: 60.5 }
  assert.equal(duplicateMatch(invoice, bank)?.certain, false)
  assert.match(duplicateMatch(invoice, bank).reason, /pagado en el banco 20 días/)
  // Una factura posterior al cargo o de hace más de 35 días es otra
  assert.equal(duplicateMatch({ ...invoice, issueDate: '2026-10-20' }, bank), null)
  assert.equal(duplicateMatch({ ...invoice, issueDate: '2026-08-20' }, bank), null)
  // Sin la marca del banco sigue haciendo falta una fecha cercana
  assert.equal(duplicateMatch(invoice, { ...bank, paidOnBank: false }), null)
})

test('índice: entre varias probables gana la de fecha más cercana', () => {
  const index = new ImportDuplicateIndex()
  const bank = { type: 'expense', party: { name: 'Movistar' }, number: null, total: 45, paidOnBank: true }
  index.add({ ...bank, issueDate: '2026-10-05' }, 'octubre')
  index.add({ ...bank, issueDate: '2026-09-05' }, 'septiembre')
  assert.equal(index.find({ type: 'expense', party: { name: 'Movistar' }, number: 'M-9', issueDate: '2026-09-01', total: 45 })?.value, 'septiembre')
})
