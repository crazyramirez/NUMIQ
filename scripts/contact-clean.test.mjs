import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeNif, validateNif, looksLikeEuVat } from '../shared/utils/nif.ts'
import { provinceFromPostalCode } from '../shared/utils/provinces.ts'

// Las utilidades compartidas se autoimportan en Nuxt
Object.assign(globalThis, { normalizeNif, validateNif, looksLikeEuVat, provinceFromPostalCode })
const { cleanContactDraft, checkContactDraft, nifSuggestion, titleCaseEs, normalizeLegalForm, validIban, formatPhone, countryCode } = await import('../shared/utils/contact-clean.ts')

const clean = d => cleanContactDraft(d).contact

test('NIF: separadores, prefijo ES, cero perdido y letras por cifras', () => {
  assert.equal(clean({ nif: 'B-21347885' }).nif, 'B21347885')
  assert.equal(clean({ nif: 'ES B91348755' }).nif, 'B91348755')
  assert.equal(clean({ nif: '1234567L' }).nif, '01234567L')
  assert.equal(clean({ nif: 'B9I348755' }).nif, 'B91348755')
  assert.equal(clean({ nif: '28654334Z' }).kind, 'person')
  assert.equal(clean({ nif: 'X2492911X' }).kind, 'person')
  assert.equal(clean({ nif: 'P2908400A' }).kind, 'company')
  const fr = clean({ nif: 'FR12345678901' })
  assert.equal(fr.nifType, 'vat_eu')
  assert.equal(fr.country, 'FR')
})

test('NIF erróneo: error con la propuesta correcta', () => {
  const c = clean({ name: 'Pepe', nif: '28654334' })
  const issue = checkContactDraft(c).find(i => i.field === 'nif')
  assert.equal(issue.level, 'error')
  assert.equal(issue.fix, '28654334Z')
  assert.equal(nifSuggestion('28654334A'), '28654334Z')
  assert.equal(nifSuggestion('28654334Z'), null)
})

test('código postal, provincia y país', () => {
  const a = clean({ postalCode: '8001', city: 'BARCELONA', province: 'BARCELONA' })
  assert.equal(a.postalCode, '08001')
  assert.equal(a.city, 'Barcelona')
  assert.equal(a.province, 'Barcelona')
  assert.equal(a.country, 'ES')
  assert.equal(clean({ postalCode: '29400', province: ' Málaga' }).province, 'Málaga')
  assert.equal(clean({ postalCode: '48001', province: 'Vizcaya' }).province, 'Vizcaya')
  assert.equal(clean({ postalCode: '41013', province: 'Madrid' }).province, 'Sevilla')
  assert.equal(clean({ postalCode: '41013' }).province, 'Sevilla')
  assert.equal(countryCode('España'), 'ES')
  assert.equal(countryCode('UK'), 'GB')
  assert.equal(clean({ country: 'Portugal' }).country, 'PT')
})

test('email y teléfono: erratas, varios valores y formato', () => {
  const c = cleanContactDraft({ email: 'INFO@empresa.es; admin@empresa.es', phone: '633522482 / +34 954 12 34 56' })
  assert.equal(c.contact.email, 'info@empresa.es')
  assert.equal(c.contact.phone, '633 522 482')
  assert.match(c.contact.notes, /Otros emails: admin@empresa.es/)
  assert.match(c.contact.notes, /Otros teléfonos: 954 123 456/)
  assert.equal(clean({ email: 'pepe@gmial.com' }).email, 'pepe@gmail.com')
  assert.equal(clean({ email: 'pepe@empresa.con' }).email, 'pepe@empresa.com')
  assert.equal(formatPhone('0034 633 52 24 82'), '633 522 482')
  assert.equal(formatPhone('+44 20 7946 0958'), '+442079460958')
})

test('IBAN y cuenta de 20 dígitos', () => {
  assert.ok(validIban('ES91 2100 0418 4502 0005 1332'))
  assert.ok(!validIban('ES91 2100 0418 4502 0005 1333'))
  assert.equal(clean({ iban: '2100 0418 45 0200051332' }).iban, 'ES9121000418450200051332')
  assert.ok(checkContactDraft(clean({ name: 'X', iban: 'ES0012345678' })).some(i => i.field === 'iban' && i.level === 'error'))
})

test('nombres: formas jurídicas, mayúsculas y duplicados de nombre', () => {
  assert.equal(normalizeLegalForm('Cárnicas Segundín S. L. U.'), 'Cárnicas Segundín S.L.U.')
  assert.equal(normalizeLegalForm('Chincha Rabiña S.L'), 'Chincha Rabiña S.L.')
  assert.equal(normalizeLegalForm('ABSOLUTE EXPERIENCIAS DE COMUNICACIÓN, S.L.'), 'ABSOLUTE EXPERIENCIAS DE COMUNICACIÓN, S.L.')
  assert.equal(normalizeLegalForm('María Sa'), 'María Sa')
  assert.equal(normalizeLegalForm('BAINTEX TECHNOLOGIES SL'), 'BAINTEX TECHNOLOGIES S.L.')
  assert.equal(titleCaseEs('LOS PALACIOS Y VILLAFRANCA'), 'Los Palacios y Villafranca')
  assert.equal(titleCaseEs('PLAZA AVIADOR RUIZ DE ALDA 3, 8A'), 'Plaza Aviador Ruiz de Alda 3, 8A')
  assert.equal(titleCaseEs("C/SANT JOAN D'EN COLL"), "C/Sant Joan D'En Coll")
  const a = clean({ name: 'Annalisa Albrighi', contactPerson: 'Annalisa Albrighi' })
  assert.equal(a.contactPerson, null)
  assert.equal(clean({ name: 'Ayuntamiento de Ronda' }).kind, 'company')
  assert.equal(clean({ address: 'Crtra. Sevilla, Km89' }).address, 'Ctra. Sevilla, Km89')
})

test('idempotente: una segunda pasada no cambia nada', () => {
  const first = cleanContactDraft({ name: 'BAINTEX TECHNOLOGIES SL', nif: 'b-98664196', email: 'a@b.es, c@d.es', phone: '633522482;954123456', postalCode: '8001', city: 'PATERNA', address: ' CALLE NUEVAS ECNOLOGIAS, NUM 6', iban: '21000418450200051332' })
  const second = cleanContactDraft(first.contact)
  assert.deepEqual(second.contact, first.contact)
  assert.equal(second.changes.length, 0)
})
