import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import * as tax from '../shared/utils/tax.ts'
import * as nif from '../shared/utils/nif.ts'

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context) }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context)
    throw error
  }
} })
const extraction = await import('../server/utils/extract.ts')
const docRead = await import('../server/utils/doc-read.ts')
const { resolveInvoiceParties } = await import('../server/utils/document-parties.ts')
const { resolveQuoteVat } = await import('../server/utils/quote-vat.ts')
Object.assign(globalThis, tax, nif, extraction, docRead)
const party = (name, nif = null, more = {}) => ({ name, nif, address: null, postalCode: null, city: null, province: null, country: 'ES', email: null, phone: null, isPerson: false, ...more })
const us = party('Empresa Propia SL', 'B12345674')
const client = party('Cliente Ejemplo', '12345678Z')
const supplier = party('Proveedor Ejemplo', '87654321X')
const company = { legalName: us.name, tradeName: 'Marca Propia', nif: us.nif, email: 'info@propia.example', ibans: ['ES1200000000000000000001'], defaultVatRate: 21 }
const contacts = [{ ...client, isClient: true, isSupplier: false, iban: 'ES1200000000000000000002' }, { ...supplier, isClient: false, isSupplier: true }]
const ctx = { company, contacts, today: '2026-10-23', path: 'documento.pdf', direction: 'auto', categories: [] }
const line = (amount = 1000, vatRate = null) => ({ description: 'Servicios', sku: null, kind: 'service', quantity: 1, unitPrice: amount, discountPct: 0, vatRate, amount })
const doc = (more = {}) => ({ documentType: 'invoice', issuer: us, recipient: client, number: 'F-001', issueDate: '2026-10-01', dueDate: null, currency: 'EUR', lines: [line()], taxLines: [], irpfRate: null, irpfAmount: null, total: 1000, paymentMethod: null, iban: null, paid: null, rectifiedNumber: null, customerReference: null, references: [], category: null, summary: null, confidence: 95, warnings: [], ...more })
const quote = (more = {}) => doc({ documentType: 'quote', vatPresentation: { mode: 'excluded', rate: null, amount: 1000, evidence: '1.000 € + IVA' }, ...more })
const converted = (d, context = ctx) => {
  const resolved = extraction.detectDirection(d, context, null)
  return { ...extraction.toInvoiceData(resolved.document, resolved.direction, context), resolved }
}

test('NIF propio normalizado y nombre comercial identifican ambos bloques', () => {
  for (const identity of [party('Otra lectura', 'ES B12345674'), party('Marca Propia'), party('Nombre ilegible', null, { email: company.email })]) {
    const result = converted(doc({ issuer: identity }))
    assert.equal(result.resolved.direction, 'issued')
    assert.equal(result.data.party.nif, client.nif)
    assert.equal(result.resolved.warning, null)
  }
  const received = converted(doc({ issuer: supplier, recipient: us }))
  assert.equal(received.resolved.direction, 'received')
  assert.equal(received.data.party.nif, supplier.nif)
})

test('cliente y empresa invertidos se corrigen automáticamente por pie y cuenta propios', () => {
  const result = converted(doc({ issuer: client, recipient: us, footerParty: us, iban: company.ibans[0], ibanRole: 'payee', paymentMethod: 'transfer' }))
  assert.equal(result.resolved.direction, 'issued')
  assert.equal(result.data.party.nif, client.nif)
  assert.equal(result.resolved.warning, null)
  assert.equal(result.resolved.blocking, false)
})

test('proveedor invertido se corrige con el pie del proveedor', () => {
  const result = converted(doc({ issuer: us, recipient: supplier, footerParty: supplier }))
  assert.equal(result.resolved.direction, 'received')
  assert.equal(result.data.party.nif, supplier.nif)
  assert.equal(result.resolved.warning, null)
})

test('una domiciliación en cuenta propia es recibida; una cuenta pagadora del cliente es emitida', () => {
  const received = converted(doc({ issuer: supplier, recipient: us, iban: company.ibans[0], paymentMethod: 'direct_debit' }))
  assert.equal(received.resolved.direction, 'received')
  const issued = converted(doc({ issuer: client, recipient: us, iban: contacts[0].iban, ibanRole: 'payer' }))
  assert.equal(issued.resolved.direction, 'issued')
  assert.equal(issued.data.party.nif, client.nif)
})

test('una cuenta sin papel y una carpeta contraria no anulan identidades verificadas', () => {
  const result = converted(doc({ issuer: supplier, recipient: us, iban: company.ibans[0], ibanRole: 'unknown' }), { ...ctx, path: 'Ventas/factura.pdf' })
  assert.equal(result.resolved.direction, 'received')
  assert.equal(result.resolved.warning, null)
})

test('un nombre idéntico con otro NIF no se convierte en la empresa propia', () => {
  const other = party(us.name, client.nif)
  const result = converted(doc({ recipient: other }))
  assert.equal(result.resolved.direction, 'issued')
  assert.equal(result.data.party.nif, client.nif)
  assert.equal(result.data.party.name, client.name)
})

test('la identidad explícita prevalece sobre el papel histórico de un contacto', () => {
  const result = converted(quote({ recipient: supplier }))
  assert.equal(result.resolved.direction, 'issued')
  assert.equal(result.resolved.confirmedReceived, false)
})

test('un contacto con ambos papeles no fuerza la clasificación', () => {
  const result = resolveInvoiceParties(doc({ issuer: null }), company, [{ ...client, isClient: true, isSupplier: true }], 'received')
  assert.equal(result.direction, 'received')
  assert.match(result.warning, /No se ha podido contrastar/)
})

test('conflicto entre cuenta y pie se conserva como error, sin inventar una solución', () => {
  const result = resolveInvoiceParties(doc({ footerParty: supplier, iban: company.ibans[0], ibanRole: 'payee' }), company, contacts)
  assert.equal(result.blocking, true)
  assert.match(result.warning, /contradicen/)
})

test('no se crea un contacto propio si ambos bloques son de la empresa', () => {
  const result = converted(doc({ recipient: us }))
  assert.equal(result.resolved.blocking, true)
  assert.equal(result.data.party, null)
})

test('documento con dos NIF ajenos distintos avisa pero no bloquea y asigna la empresa propia', () => {
  const res = resolveInvoiceParties(doc({ issuer: supplier, recipient: client }), company, contacts)
  assert.equal(res.blocking, false)
  assert.match(res.warning, /Los NIF de ambas partes son distintos/)
  assert.equal(res.document.recipient.nif, company.nif)
})

for (const type of ['quote', 'proforma']) {
  test(`${type} incompleto se trata como propio y recupera el cliente aunque esté en issuer`, () => {
    const result = converted(quote({ documentType: type, issuer: client, recipient: null }))
    assert.equal(result.resolved.direction, 'issued')
    assert.equal(result.resolved.confirmedReceived, false)
    assert.equal(result.data.party.nif, client.nif)
    assert.equal(result.resolved.warning, null)
  })
  test(`${type} de proveedor confirmado conserva su clasificación externa`, () => {
    const result = converted(quote({ documentType: type, issuer: supplier, recipient: us, footerParty: supplier }))
    assert.equal(result.resolved.direction, 'received')
    assert.equal(result.resolved.confirmedReceived, true)
  })
}

test('presupuesto con datos propios incompletos en destinatario se reconoce como propio', () => {
  const result = converted(quote({ issuer: client, recipient: party('Marca Propia') }))
  assert.equal(result.resolved.direction, 'issued')
  assert.equal(result.data.party.nif, client.nif)
})

test('un cliente guardado en el bloque inverso no envía el presupuesto propio al archivo', () => {
  const result = converted(quote({ issuer: client, recipient: us }))
  assert.equal(result.resolved.direction, 'issued')
  assert.equal(result.resolved.confirmedReceived, false)
  assert.equal(result.data.party.nif, client.nif)
  assert.equal(result.resolved.warning, null)
})

for (const rate of [21, 10, 0]) {
  test(`1.000 € + IVA usa el tipo de empresa ${rate} sin aviso de desglose`, () => {
    const result = converted(quote({ warnings: ['IVA indicado como no incluido, pero no aparece desglose fiscal.'] }), { ...ctx, company: { ...company, defaultVatRate: rate } })
    assert.equal(result.data.total, 1000 + rate * 10)
    assert.equal(result.data.taxLines[0].base, 1000)
    assert.equal(result.data.taxLines[0].vatAmount, rate * 10)
    assert.equal(result.blocking, false)
    assert.deepEqual(result.warnings, [])
    assert.match(result.data.vatCalculation, /configurado en tu empresa/)
  })
}

test('IVA explícito prevalece sobre configuración y calcula también proformas', () => {
  const result = converted(quote({ documentType: 'proforma', vatPresentation: { mode: 'excluded', rate: 10, amount: 1000, evidence: '1.000 € + IVA 10%' } }))
  assert.equal(result.data.total, 1100)
  assert.match(result.data.vatCalculation, /indicado en el documento/)
})

test('notación antigua + 10% IVA y aviso sin desglose se resuelven sin metadatos nuevos', () => {
  const result = converted(quote({ vatPresentation: undefined, summary: '1.000 € + 10% IVA', warnings: ['IVA indicado como no incluido, pero no aparece desglose fiscal.'] }))
  assert.equal(result.data.total, 1100)
  assert.deepEqual(result.warnings, [])
})

test('un total final ya con IVA se conserva aunque no haya cuadro de impuestos', () => {
  const result = converted(quote({ vatPresentation: undefined, summary: 'Precio + IVA', total: 1210 }))
  assert.equal(result.data.taxLines[0].base, 1000)
  assert.equal(result.data.total, 1210)
  assert.deepEqual(result.warnings, [])
})

for (const netLines of [false, true]) {
  test(`1.210 € IVA incluido se descompone sin duplicar IVA; líneas ${netLines ? 'netas' : 'brutas'}`, () => {
    const result = converted(quote({ total: 1210, lines: [line(netLines ? 1000 : 1210)], vatPresentation: { mode: 'included', rate: 21, amount: 1210, evidence: '1.210 € IVA incluido' } }))
    assert.equal(result.data.taxLines[0].base, 1000)
    assert.equal(result.data.taxLines[0].vatAmount, 210)
    assert.equal(result.data.total, 1210)
    assert.equal(result.data.lines[0].unitPrice, 1000)
    assert.equal(result.data.linesMatch, true)
    assert.deepEqual(result.warnings, [])
  })
}

test('presupuesto exento no recibe IVA de la empresa', () => {
  const result = converted(quote({ vatPresentation: { mode: 'exempt', rate: null, amount: 1000, evidence: 'Exento de IVA' } }))
  assert.equal(result.data.total, 1000)
  assert.equal(result.data.taxLines[0].vatRate, 0)
})

test('sin indicación fiscal no se inventa un IVA; las facturas conservan su fiscalidad', () => {
  for (const source of [quote({ vatPresentation: undefined }), doc({ summary: '1.000 € + IVA' })]) {
    assert.equal(resolveQuoteVat(source, 21).document, source)
    assert.equal(resolveQuoteVat(source, 21).calculation, null)
  }
})

test('desglose fiscal existente prevalece y no recibe IVA dos veces', () => {
  const source = quote({ total: 1210, taxLines: [{ base: 1000, vatRate: 21, vatAmount: 210, surchargeRate: 0, surchargeAmount: 0 }] })
  assert.equal(converted(source).data.total, 1210)
  assert.equal(resolveQuoteVat(source, 21).document, source)
  assert.equal(converted({ ...source, total: 1000 }).data.total, 1210)
})

test('los tipos mixtos y descuentos se mantienen al calcular el total', () => {
  const result = converted(quote({ total: null, vatPresentation: { mode: 'excluded', rate: null, amount: null, evidence: '+ IVA' }, lines: [{ ...line(900, 21), unitPrice: 1000, discountPct: 10 }, line(100, 10)] }))
  assert.equal(result.data.total, 1199)
  assert.equal(result.data.lines[0].discountPct, 10)
  assert.equal(result.data.linesMatch, true)
})

test('conserva advertencias ajenas al desglose y el documento original', () => {
  const source = quote({ total: 1200, warnings: ['Falta firma'] })
  const snapshot = structuredClone(source)
  const result = converted(source)
  assert.equal(result.data.total, 1200)
  assert.ok(result.warnings.some(w => w.includes('no cuadran')))
  assert.ok(result.warnings.includes('Falta firma'))
  assert.deepEqual(source, snapshot)
})
