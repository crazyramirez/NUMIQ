/** Pruebas con MySQL local y el servidor compilado. Solo escribe en una BD efímera propia. */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { eq } from 'drizzle-orm'

const database = `numiq_test_import_${randomBytes(8).toString('hex')}`
const target = { host: '127.0.0.1', port: 3308, user: 'root', password: '' }
const admin = await mysql.createConnection(target)
let appDb, setup
try {
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  setup = await mysql.createConnection({ ...target, database })
  await migrate(drizzle(setup), { migrationsFolder: 'server/db/migrations' })
  Object.assign(process.env, { DB_HOST: target.host, DB_PORT: String(target.port), DB_USER: target.user, DB_PASSWORD: '', DB_NAME: database })
  // Las variables NUXT prevalecen sobre DB_*: fijar ambas evita usar otra base.
  Object.assign(process.env, { NUXT_DATABASE_HOST: target.host, NUXT_DATABASE_PORT: String(target.port), NUXT_DATABASE_USER: target.user, NUXT_DATABASE_PASSWORD: '', NUXT_DATABASE_NAME: database })
  process.env.NUXT_SESSION_PASSWORD = randomBytes(32).toString('hex')
  delete process.env.DB_SOCKET
  delete process.env.NUXT_DATABASE_SOCKET
  const url = new URL('../.output/server/chunks/_/nitro.mjs', import.meta.url)
  const source = await readFile(url, 'utf8')
  const server = await import(url.href)
  const get = name => {
    const alias = source.match(new RegExp(`\\b${name} as ([\\w$]+)`))?.[1]
    assert.ok(alias && server[alias], `Exportación del build: ${name}`)
    return server[alias]
  }
  const tables = get('tables')
  appDb = get('useDb')()
  const commitBatch = get('commitBatch')
  const importSingleInvoice = get('importSingleInvoice')
  const saveExpense = get('saveExpense')
  const expenseInputSchema = get('expenseInputSchema')
  const companyId = (await appDb.insert(tables.companies).values({ legalName: 'Prueba importación', nif: 'B11111111' }).$returningId())[0].id
  const [company] = await appDb.select().from(tables.companies).where(eq(tables.companies.id, companyId))
  const party = { name: 'Árbol Servicios SL', nif: 'B12345678', email: 'hola@arbol.test', phone: null, address: null, postalCode: null, city: null, province: null, country: 'ES', isPerson: false }
  const invoice = { docType: 'invoice', party, number: 'F-001/26', issueDate: '2026-10-20', dueDate: null, lines: [{ description: 'Servicio de prueba', sku: null, kind: 'service', quantity: 1, unitPrice: 100, discountPct: 0, vatRate: 21, surchargeRate: 0 }], linesMatch: true, taxLines: [{ base: 100, vatRate: 21, vatAmount: 21, surchargeRate: 0, surchargeAmount: 0 }], irpfRate: 0, irpfAmount: 0, total: 121, paymentMethod: null, paid: false, rectifiedNumber: null, customerReference: null, categoryId: null, description: 'Prueba' }
  const batch = async (type, data, owner = companyId) => {
    const id = (await appDb.insert(tables.importBatches).values({ companyId: owner, status: 'review', options: { createItems: false, markPaid: false } }).$returningId())[0].id
    await appDb.insert(tables.importItems).values({ companyId: owner, batchId: id, type, status: 'ready', data })
    return id
  }

  const batches = await Promise.all([batch('expense', invoice), batch('expense', { ...invoice, number: 'f001_26', party: { ...party, nif: null } })])
  const results = await Promise.all(batches.map(id => commitBatch(companyId, 1, id)))
  assert.equal(results.reduce((n, r) => n + r.imported, 0), 1)
  assert.equal(results.reduce((n, r) => n + r.failed.length, 0), 0)
  assert.equal((await appDb.select().from(tables.expenses)).length, 1)
  assert.equal((await commitBatch(companyId, 1, batches[0])).imported, 0)
  console.log('OK: lotes simultáneos y doble confirmación crean un solo gasto')

  const salesBatch = await batch('sales', invoice)
  await importSingleInvoice(company, 1, { data: invoice, contactId: null, fileId: null })
  const stale = await commitBatch(companyId, 1, salesBatch)
  assert.equal(stale.imported, 0)
  assert.equal(stale.summary.duplicates, 1)
  await assert.rejects(importSingleInvoice(company, 1, { data: { ...invoice, number: 'f00126' }, contactId: null, fileId: null }), e => e.statusCode === 409)
  console.log('OK: revalida lotes antiguos y escaneos al guardar')

  for (const docType of ['quote', 'proforma']) {
    const r = await commitBatch(companyId, 1, await batch('sales', { ...invoice, docType }))
    assert.equal(r.imported, 1)
    assert.equal((await commitBatch(companyId, 1, await batch('sales', { ...invoice, docType }))).imported, 0)
  }
  assert.equal((await appDb.select().from(tables.salesDocuments)).length, 3)
  console.log('OK: factura, presupuesto y proforma conservan identidades distintas')

  const withoutNumber = await commitBatch(companyId, 1, await batch('expense', { ...invoice, number: null, party: { ...party, nif: null, name: 'ARBOL SERVICIOS' } }))
  assert.equal(withoutNumber.imported, 0)
  const otherSupplier = await commitBatch(companyId, 1, await batch('expense', { ...invoice, party: { ...party, nif: 'B87654321' } }))
  assert.equal(otherSupplier.imported, 1)
  console.log('OK: ausencia de número y proveedores homónimos con NIF distinto')

  const contactBatch = await batch('contact', { party, isClient: true, isSupplier: true })
  const reused = await commitBatch(companyId, 1, contactBatch)
  assert.equal(reused.imported, 0)
  const contacts = await appDb.select().from(tables.contacts)
  assert.equal(contacts.length, 2)
  assert.ok(contacts.find(c => c.nif === party.nif)?.isClient)
  assert.ok(contacts.find(c => c.nif === party.nif)?.isSupplier)
  console.log('OK: reutiliza contactos y conserva ambos papeles')

  const ambiguous = await commitBatch(companyId, 1, await batch('contact', { party: { ...party, nif: null }, isClient: true, isSupplier: true }))
  assert.equal(ambiguous.imported, 0)
  const afterAmbiguous = await appDb.select().from(tables.contacts)
  assert.equal(afterAmbiguous.length, 2)
  assert.equal(afterAmbiguous.find(c => c.nif === 'B87654321').isClient, false)
  console.log('OK: un contacto ambiguo no crea duplicados ni modifica un homónimo')

  const fileId = (await appDb.insert(tables.files).values({ companyId, kind: 'scan', originalName: 'prueba.pdf', mime: 'application/pdf', size: 1, path: 'test/no-file.pdf', sha256: 'a'.repeat(64) }).$returningId())[0].id
  const expense = expenseInputSchema.parse({ newSupplier: party, number: invoice.number, issueDate: invoice.issueDate, taxLines: invoice.taxLines, fileId })
  await assert.rejects(saveExpense(companyId, 1, expense), e => e.statusCode === 409)
  assert.equal((await appDb.select().from(tables.expenses)).length, 2)
  // Rechazar un duplicado no deja el bloqueo cogido: una operación nueva debe terminar.
  const afterFailure = await commitBatch(companyId, 1, await batch('expense', { ...invoice, number: 'F-002/26' }))
  assert.equal(afterFailure.imported, 1)
  console.log('OK: gasto escaneado bloqueado sin efectos secundarios; bloqueo liberado tras error')

  const anonymousExpense = expenseInputSchema.parse({ number: null, issueDate: '2026-10-22', taxLines: invoice.taxLines, fileId })
  await saveExpense(companyId, 1, anonymousExpense)
  const repeatedFileId = (await appDb.insert(tables.files).values({ companyId, kind: 'scan', originalName: 'renombrado.pdf', mime: 'application/pdf', size: 1, path: 'test/no-file-copy.pdf', sha256: 'a'.repeat(64) }).$returningId())[0].id
  const anonymousCopy = expenseInputSchema.parse({ number: null, issueDate: '2026-10-22', taxLines: [{ base: 101, vatRate: 21 }], fileId: repeatedFileId })
  await assert.rejects(saveExpense(companyId, 1, anonymousCopy), e => e.statusCode === 409 && /archivo/.test(e.statusMessage))
  console.log('OK: el mismo archivo renombrado se detecta incluso sin proveedor o número y con OCR distinto')

  const otherCompanyId = (await appDb.insert(tables.companies).values({ legalName: 'Otra empresa de prueba', nif: 'B22222222' }).$returningId())[0].id
  assert.equal((await commitBatch(otherCompanyId, 1, await batch('expense', invoice, otherCompanyId))).imported, 1)
  console.log('OK: las coincidencias están limitadas a la empresa')

  // Acceso desde presupuesto facturado: enlaces reales, también para documentos importados.
  const loadQuoteInvoices = get('loadQuoteInvoices')
  const loadSalesDocument = get('loadSalesDocument')
  const sales = await appDb.select().from(tables.salesDocuments).where(eq(tables.salesDocuments.companyId, companyId))
  const quote = sales.find(d => d.kind === 'quote')
  const linkedInvoice = sales.find(d => d.kind === 'invoice')
  await appDb.update(tables.salesDocuments).set({ sourceId: quote.id }).where(eq(tables.salesDocuments.id, linkedInvoice.id))
  await appDb.update(tables.salesDocuments).set({ status: 'invoiced' }).where(eq(tables.salesDocuments.id, quote.id))
  const extraInvoice = (await appDb.insert(tables.salesDocuments).values({ companyId, kind: 'invoice', status: 'issued', number: 'F-ASOCIADA-2', issueDate: '2026-10-23', sourceId: quote.id }).$returningId())[0].id
  await appDb.insert(tables.salesDocuments).values([
    { companyId, kind: 'invoice', status: 'draft', issueDate: '2026-10-23', sourceId: quote.id },
    { companyId: otherCompanyId, kind: 'invoice', status: 'issued', number: 'AJENA', issueDate: '2026-10-23', sourceId: quote.id },
    { companyId, kind: 'quote', status: 'sent', issueDate: '2026-10-23', sourceId: quote.id },
  ])
  const links = await loadQuoteInvoices(companyId, [quote.id, -1])
  assert.deepEqual(links.get(quote.id).map(d => d.id), [extraInvoice, linkedInvoice.id])
  assert.equal(links.has(-1), false)
  assert.equal((await loadQuoteInvoices(companyId, [])).size, 0)
  assert.deepEqual((await loadSalesDocument(companyId, quote.id)).invoices, links.get(quote.id))
  assert.deepEqual((await loadSalesDocument(companyId, linkedInvoice.id)).invoices, [])
  console.log('OK: presupuesto enlaza todas sus facturas emitidas, sin borradores ni datos de otra empresa')
}
catch (error) {
  console.error(error)
  process.exitCode = 1
}
finally {
  await appDb?.$client.end()
  await setup?.end()
  assert.match(database, /^numiq_test_import_[0-9a-f]{16}$/)
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
// El módulo Nitro inicia temporizadores de mantenimiento. La BD y conexiones ya están cerradas.
process.exit(process.exitCode ?? 0)
