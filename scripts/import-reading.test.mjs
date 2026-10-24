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

// Factura real de un autónomo: la IA toma el NIF del cliente de la cabecera «NIF/CIF | Nº | Fecha» como del emisor,
// cruza los bloques y repite al cliente como titular de un «IBAN: …» sin nombre y como pie inexistente
const autonomo = { legalName: 'Andrés Ramírez Lería', tradeName: null, nif: '25588523B', email: 'andres@andresrl.es', ibans: [], defaultVatRate: 21 }
const agencia = party('ABSOLUTE EXPERIENCIAS DE COMUNICACIÓN, S.L.', 'B91348755')
const crossed = (more = {}) => doc({
  issuer: agencia, recipient: party(autonomo.legalName, autonomo.nif, { isPerson: true }), number: '16-26',
  taxLines: [{ base: 120, vatRate: 21, vatAmount: 25.2, surchargeRate: 0, surchargeAmount: 0 }], irpfRate: 15, irpfAmount: 18, total: 127.2,
  iban: 'ES3500730100570862027818', ibanRole: 'payee', payeeName: agencia.name, footerName: agencia.name, ...more,
})

test('retención profesional de un autónomo a una sociedad: emitida aunque la IA cruce los bloques', () => {
  const result = resolveInvoiceParties(crossed(), autonomo, [])
  assert.equal(result.direction, 'issued')
  assert.equal(result.blocking, false)
  assert.equal(result.document.recipient.nif, agencia.nif)
  assert.equal(result.document.issuer.nif, autonomo.nif)
})

test('la cuenta propia de cobro no choca con un titular que solo repite el emisor leído', () => {
  const result = resolveInvoiceParties(crossed(), { ...autonomo, ibans: ['ES35 0073 0100 5708 6202 7818'] }, [])
  assert.equal(result.direction, 'issued')
  assert.equal(result.blocking, false)
  assert.equal(result.warning, null)
})

test('un cliente habitual hace emitida la factura con los bloques cruzados, y avisa', () => {
  const plain = crossed({ irpfRate: null, irpfAmount: null, total: 145.2 })
  const habitual = [{ ...agencia, isClient: true, isSupplier: false, issuedCount: 6, receivedCount: 0 }]
  const result = resolveInvoiceParties(plain, autonomo, habitual)
  assert.equal(result.direction, 'issued')
  assert.equal(result.document.recipient.nif, agencia.nif)
  assert.match(result.warning, /cliente habitual/)
  // Sin historial, la lectura manda
  assert.equal(resolveInvoiceParties(plain, autonomo, []).direction, 'received')
  // Un historial mixto no decide
  assert.equal(resolveInvoiceParties(plain, autonomo, [{ ...habitual[0], receivedCount: 3 }]).direction, 'received')
})

test('una sociedad que paga a un profesional con retención registra un gasto', () => {
  const freelance = party('Diseñadora Autónoma', '87654321X', { isPerson: true })
  const result = resolveInvoiceParties(doc({ issuer: us, recipient: freelance, irpfRate: 15, irpfAmount: 150, total: 1060 }), company, [])
  assert.equal(result.direction, 'received')
  assert.equal(result.document.issuer.nif, freelance.nif)
})

test('el pie de un cliente habitual que le vende a la empresa sigue siendo un gasto', () => {
  const habitual = [{ ...client, isClient: true, isSupplier: false, issuedCount: 5, receivedCount: 0 }]
  const result = resolveInvoiceParties(doc({ issuer: us, recipient: client, footerParty: client }), company, habitual)
  assert.equal(result.direction, 'received')
  assert.equal(result.document.issuer.nif, client.nif)
})

test('el cuerpo que repite el concepto no se duplica en la descripción', () => {
  const concept = 'Mantenimiento web, Alojamiento Web, Copias de seguridad diarias y Certificado de seguridad para laboratoriovazquez.com febrero 2026'
  const repeated = '## Mantenimiento web, Alojamiento Web, Copias de seguridad diarias y Certificado de seguridad para\nlaboratoriovazquez.com\nfebrero 2026'
  assert.equal(converted(doc({ lines: [{ ...line(45, 21), description: concept }], bodyText: repeated })).data.bodyText, null)
  // Lo que no está en los conceptos se conserva, con sus títulos cortos
  const mixed = `${repeated}\n\n## Alcance\n- Revisión mensual de plugins\nPago a 30 días`
  assert.equal(extraction.withoutRepeatedBody(mixed, [concept]), '## Alcance\n- Revisión mensual de plugins\nPago a 30 días')
  assert.equal(extraction.withoutRepeatedBody('## Diseño\n- Logotipo y papelería', ['Diseño de logotipo']), '## Diseño\n- Logotipo y papelería')
  assert.equal(extraction.withoutRepeatedBody('Proyecto Stand Gourmets', []), 'Proyecto Stand Gourmets')
  // Un título que se queda sin texto debajo desaparece; varios «títulos» que son datos pasan a texto normal
  assert.equal(extraction.withoutRepeatedBody(`## Descripción\n${concept}`, [concept]), null)
  assert.equal(extraction.withoutRepeatedBody('## febrero 2026', [concept]), null)
  assert.equal(extraction.withoutRepeatedBody('## OP: 26 1376\n## Proyecto: Stand Gourmets 2026 - AGAPA', ['Visores pantallas']), 'OP: 26 1376\nProyecto: Stand Gourmets 2026 - AGAPA')
  assert.equal(extraction.withoutRepeatedBody('## Rediseño de la web corporativa', ['Diseño']), '## Rediseño de la web corporativa')
})

test('los conceptos no conservan los cortes de renglón del ancho de la celda', () => {
  const wrapped = 'Mantenimiento web y Certificado de seguridad para\nlaboratoriovazquez.com\n\nfebrero 2026'
  const result = converted(doc({ lines: [{ ...line(45, 21), description: wrapped }] }))
  assert.equal(result.data.lines[0].description, 'Mantenimiento web y Certificado de seguridad para laboratoriovazquez.com febrero 2026')
  // Los datos distintos (en mayúscula o tras un punto) siguen en su línea
  const details = 'Visores pantallas cuadradas.\nOP: 26 1376\nProyecto: Stand Gourmets 2026'
  assert.equal(converted(doc({ lines: [{ ...line(45, 21), description: details }] })).data.lines[0].description, details)
})

test('sin conceptos con importe, el texto va a la descripción y las líneas solo llevan la base', () => {
  const text = 'Diseño y Desarrollo Web para LanzarotePrivateTours.com'
  const taxLines = [{ base: 262.81, vatRate: 21, vatAmount: 55.19, surchargeRate: 0, surchargeAmount: 0 }]
  const result = converted(doc({ itemized: false, lines: [{ ...line(262.81, 21), description: text }], taxLines, total: 318, bodyText: `## Descripción\n${text}` }))
  assert.equal(result.data.conceptless, true)
  assert.equal(result.data.bodyText, `## Descripción\n${text}`)
  assert.deepEqual(result.data.lines.map(l => [l.description, l.quantity, l.unitPrice, l.vatRate]), [['', 1, 262.81, 21]])
  // El concepto que el cuerpo no recoge se suma a la descripción, sin repetir lo que ya dice
  assert.equal(extraction.conceptlessBody('Publicidad marzo 2026', ['Publicidad marzo 2026', 'Web y copias de seguridad']), 'Publicidad marzo 2026\nWeb y copias de seguridad')
  assert.equal(extraction.conceptlessBody(null, [text]), text)
  // Al cambiar la base en la revisión, la línea la sigue
  const edited = extraction.reconcileInvoiceLines({ ...result.data, taxLines: [{ ...taxLines[0], base: 300 }] })
  assert.equal(edited.lines[0].unitPrice, 300)
  // Con conceptos detallados (o lecturas antiguas sin el dato) todo sigue igual
  assert.equal(converted(doc({ itemized: true, lines: [{ ...line(1000, 21), description: 'Hosting anual' }] })).data.conceptless, undefined)
})

test('emitidas o recibidas elegidas al importar mandan sobre lo detectado', () => {
  const chosen = (d, direction, more = {}) => converted(d, { ...ctx, direction, ...more })
  // La IA cruzó los bloques: emitidas elegidas, el cliente sale del bloque del emisor
  const issued = chosen(doc({ issuer: client, recipient: us }), 'issued')
  assert.equal(issued.resolved.direction, 'issued')
  assert.equal(issued.data.party.nif, client.nif)
  assert.equal(issued.resolved.warning, null)
  // Recibidas manda aunque la cuenta propia de cobro y la carpeta digan emitida
  const received = chosen(doc({ issuer: supplier, recipient: us, iban: company.ibans[0], ibanRole: 'payee', footerParty: us }), 'received', { path: 'Ventas/f.pdf' })
  assert.equal(received.resolved.direction, 'received')
  assert.equal(received.resolved.blocking, false)
  assert.equal(received.data.party.nif, supplier.nif)
  // Un presupuesto de proveedor con recibidas elegidas va al archivo, no a Presupuestos
  assert.equal(chosen(quote({ issuer: us, recipient: supplier }), 'received').resolved.direction, 'received')
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

test('una carpeta con el nombre de un documento no dice el tipo de lo que contiene (el sentido, la de arriba)', () => {
  const inDocFolder = docRead.folderSignals('2025/1T/Emitidas/004_Factura_Absolute_MITMA_2025_Dinámica_Photo_AI_P/OP242163 DIEGO RAMÍREZ_P.pdf')
  assert.equal(inDocFolder.kind, null)
  assert.equal(inDocFolder.direction, 'issued')
  assert.equal(extraction.folderMismatch('purchase_order', inDocFolder), null)
  for (const [path, kind, direction] of [
    ['Facturas_Emitidas_2025_1T/f.pdf', 'invoice', 'issued'],
    ['Facturas de compra 2025 1T/f.pdf', 'invoice', 'received'],
    ['2025/Presupuestos/p.pdf', 'quote', null],
    ['Gastos/Nóminas enero 2025/n.pdf', 'payroll', 'received'],
  ]) {
    const f = docRead.folderSignals(path)
    assert.equal(f.kind, kind, path)
    assert.equal(f.direction, direction, path)
  }
})

test('los avisos de la IA sobre quién emite, la carpeta o la transcripción no llegan al usuario', () => {
  assert.deepEqual(extraction.usefulAiWarnings([
    'La carpeta indica \'Emitidas\', pero el documento está emitido por un tercero y va dirigido a Viseni Design S.L.',
    'El nombre del emisor aparece como \'Viseni Design S.L.\'; se ha normalizado la denominación.',
    'La descripción contiene una errata literal: \'pesonalizado\'.',
    'El total está cortado y no se lee',
    'Falta firma',
  ]), ['El total está cortado y no se lee', 'Falta firma'])
})
