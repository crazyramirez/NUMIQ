import test from 'node:test'
import assert from 'node:assert/strict'
import { bestByName, duplicateMatch, findSimilarContact, ibansInText, nameInText, nameSimilarity, similarNames, taxIdsInText, validIban } from '../shared/utils/duplicate-matching.ts'

test('nombres con erratas en palabras largas', () => {
  assert.ok(similarNames('Iberdrola Clientes', 'IBERDORLA CLIENTES SAU'))
  assert.ok(similarNames('Telefónica de España', 'TELEFONCA ESPAÑA'))
  assert.ok(similarNames('Consultoría Martínez', 'Consultoria Martines SL'))
  // Una sola palabra: la errata solo vale con 8 letras o más
  assert.ok(similarNames('Vodafone', 'Vodafon'))
  assert.equal(similarNames('Glovo', 'Globo'), false)
})

test('apellidos parecidos no son la misma persona', () => {
  assert.equal(similarNames('María García', 'María Gracia'), false)
  assert.equal(similarNames('Juan Pérez', 'Juan López'), false)
  assert.equal(similarNames('Juan', 'Juan Martínez'), false)
})

test('orden distinto, iniciales y formas jurídicas', () => {
  assert.ok(similarNames('GARCIA LOPEZ MARIA', 'María García López'))
  assert.ok(similarNames('M. García López', 'María García López'))
  assert.ok(similarNames('Endesa', 'Endesa Energía, S.A.U.'))
})

test('siglas y abreviaturas', () => {
  assert.ok(similarNames('BBVA', 'Banco Bilbao Vizcaya Argentaria, S.A.'))
  assert.ok(similarNames('B.B.V.A.', 'Banco Bilbao Vizcaya Argentaria'))
  assert.ok(similarNames('ECI', 'El Corte Inglés'))
  assert.ok(similarNames('Hnos. Pérez Ruiz', 'Hermanos Pérez Ruiz'))
  assert.ok(similarNames('AMZN Mktp ES', 'Amazon Mktp'))
  // Unas siglas de tres letras dentro de un texto más largo no bastan
  assert.equal(similarNames('Ana Isabel Ruiz', 'Air Europa'), false)
})

test('el más parecido gana entre homónimos parciales', () => {
  const contacts = [{ id: 1, name: 'María García' }, { id: 2, name: 'María García López' }]
  assert.equal(findSimilarContact(contacts, { name: 'GARCIA LOPEZ MARIA' })?.id, 2)
  // Dos igual de parecidos: no se adivina
  assert.equal(bestByName([{ id: 1, name: 'Endesa Energía' }, { id: 2, name: 'Endesa Distribución' }], 'Endesa'), undefined)
  assert.ok(nameSimilarity('Endesa', 'Endesa') > nameSimilarity('Endesa', 'Endesa Energía XXI'))
})

test('un NIF distinto nunca se une por nombre parecido', () => {
  assert.equal(findSimilarContact([{ id: 1, name: 'Iberdrola Clientes', nif: 'A95758389' }], { name: 'IBERDORLA CLIENTES', nif: 'B12345674' }), undefined)
  assert.equal(findSimilarContact([{ id: 1, name: 'Iberdrola Clientes' }], { name: 'IBERDORLA CLIENTES', nif: 'A95758389' })?.id, 1)
})

test('nombre de un contacto dentro de un concepto del banco', () => {
  assert.equal(nameInText('Acme Consulting, S.L.', 'TRANSF SEPA DE ACME CONSULTING SL FRA 23/2026'), 2)
  assert.equal(nameInText('Lidl', 'COMPRA TARJ 1234 LIDL MADRID'), 1)
  assert.equal(nameInText('Acme Consulting', 'TRANSF SEPA DE ACME LOGISTICA'), 0)
  assert.equal(nameInText('Iberdrola Clientes', 'RECIBO IBERDORLA CLIENTES OCT'), 1.5)
  assert.equal(nameInText('Uno', 'RECIBO UNO'), 0)
})

test('NIF en el concepto y en el identificador de acreedor SEPA', () => {
  assert.deepEqual(taxIdsInText('RECIBO ENDESA ACREEDOR ES21000A81948077 REF 0034'), ['A81948077'])
  assert.deepEqual(taxIdsInText('TRANSF. NIF B-12.345.674 FRA 23'), ['B12345674'])
  // Una referencia con forma de NIF pero sin la letra de control buena no cuenta
  assert.deepEqual(taxIdsInText('REF B12345678 PEDIDO'), [])
})

test('IBAN válidos en un texto', () => {
  assert.ok(validIban('ES91 2100 0418 4502 0005 1332'))
  assert.equal(validIban('ES91 2100 0418 4502 0005 1333'), false)
  assert.deepEqual(ibansInText('TRANSFERENCIA DESDE ES91 2100 0418 4502 0005 1332 CONCEPTO FRA'), ['ES9121000418450200051332'])
})

test('un gasto del banco con el nombre escrito con errata y el escaneo de su ticket son el mismo', () => {
  const bank = { type: 'expense', kind: 'ticket', party: { name: 'Iberdorla Clientes' }, issueDate: '2026-10-05', total: 84.7, paidOnBank: true }
  const scan = { type: 'expense', kind: 'invoice', party: { name: 'Iberdrola Clientes S.A.U.', nif: 'A95758389' }, number: null, issueDate: '2026-09-20', total: 84.7 }
  assert.equal(duplicateMatch(scan, bank)?.certain, false)
})

test('unos céntimos de diferencia con el mismo proveedor y fechas cercanas: probable', async () => {
  const { ImportDuplicateIndex } = await import('../shared/utils/duplicate-matching.ts')
  const saved = { type: 'expense', kind: 'ticket', party: { name: 'Repsol', nif: 'A78374725' }, issueDate: '2026-10-05', total: 84.7 }
  const read = { ...saved, total: 84.69, issueDate: '2026-10-06' }
  assert.equal(duplicateMatch(read, saved)?.certain, false)
  assert.equal(duplicateMatch({ ...read, total: 84.6 }, saved), null)
  assert.equal(duplicateMatch({ ...read, party: { name: 'Otro', nif: 'B76543214' } }, saved), null)
  const index = new ImportDuplicateIndex()
  index.add(saved, 1)
  assert.equal(index.find(read)?.value, 1)
  assert.equal(index.find(read, { certainOnly: true }), null)
})
