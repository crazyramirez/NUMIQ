import test from 'node:test'
import assert from 'node:assert/strict'
import { ImportDuplicateIndex, importDuplicateReason, sameImportParty, findImportContact } from '../shared/utils/duplicate-matching.ts'
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
    assert.ok(importDuplicateReason({ ...document, type, number: null }, { ...document, type, party: { name: 'ARBOL SERVICIOS' } }))
    assert.equal(importDuplicateReason({ ...document, type, number: null }, { ...document, type, issueDate: '2026-10-21' }), null)
    assert.equal(importDuplicateReason({ ...document, type, number: null }, { ...document, type, total: 122 }), null)
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
