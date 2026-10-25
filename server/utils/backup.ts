import { asc, eq, inArray } from 'drizzle-orm'
import { zipSync } from 'fflate'
import * as XLSX from 'xlsx'

type Company = typeof tables.companies.$inferSelect

export interface BackupOptions {
  /** PDF de cada factura y presupuesto emitido */
  pdfs: boolean
  /** Documentos originales: tickets, facturas recibidas, archivo trimestral, adjuntos */
  originals: boolean
}

const STATUS: Record<string, string> = {
  draft: 'Borrador', issued: 'Emitida', sent: 'Enviada', paid: 'Cobrada', partial: 'Cobro parcial', cancelled: 'Anulada',
  accepted: 'Aceptado', rejected: 'Rechazado', expired: 'Caducado', invoiced: 'Facturado', pending: 'Pendiente',
}
const KIND: Record<string, string> = { invoice: 'Factura', rectifying: 'Rectificativa', quote: 'Presupuesto', proforma: 'Proforma' }
const METHOD: Record<string, string> = { transfer: 'Transferencia', card: 'Tarjeta', cash: 'Efectivo', direct_debit: 'Domiciliación', bizum: 'Bizum', other: 'Otro' }

const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'archivo'

/** Hoja con cabecera en negrita (por formato) y anchos razonables */
function sheet(rows: unknown[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map(w => ({ wch: w }))
  if (rows.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: widths.length - 1 } }) }
  return ws
}

/** Lo que se va a exportar, para enseñarlo antes de descargar */
export async function backupPreview(company: Company) {
  const db = useDb()
  const [sales, expenses, contacts, files, tx] = await Promise.all([
    db.select({ status: tables.salesDocuments.status }).from(tables.salesDocuments).where(eq(tables.salesDocuments.companyId, company.id)),
    db.select({ id: tables.expenses.id }).from(tables.expenses).where(eq(tables.expenses.companyId, company.id)),
    db.select({ id: tables.contacts.id }).from(tables.contacts).where(eq(tables.contacts.companyId, company.id)),
    db.select({ size: tables.files.size, kind: tables.files.kind }).from(tables.files).where(eq(tables.files.companyId, company.id)),
    db.select({ id: tables.bankTransactions.id }).from(tables.bankTransactions).where(eq(tables.bankTransactions.companyId, company.id)),
  ])
  const originals = files.filter(f => f.kind !== 'pdf' && f.kind !== 'logo')
  const last = (company.settings?.backup ?? null) as { at: string, size: number } | null
  return {
    documents: sales.filter(s => s.status !== 'draft').length,
    expenses: expenses.length,
    contacts: contacts.length,
    bank: tx.length,
    files: originals.length,
    filesSize: originals.reduce((s, f) => s + f.size, 0),
    last,
  }
}

/**
 * Copia completa de la empresa en formatos abiertos: Excel legible, JSON con todos los datos
 * (para migrar o restaurar), PDF de los documentos emitidos y los archivos originales.
 */
export async function buildBackup(company: Company, opts: BackupOptions) {
  const db = useDb()
  const cid = company.id
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  const add = (path: string, data: Buffer | Uint8Array, compress = true) => {
    let p = path
    for (let i = 2; entries[p]; i++) p = path.replace(/(\.[^./]+)?$/, ` (${i})$1`)
    entries[p] = [data instanceof Uint8Array ? data : new Uint8Array(data), { level: compress ? 6 : 0 }]
  }
  const json = (name: string, rows: unknown) => add(`Datos (JSON)/${name}.json`, Buffer.from(JSON.stringify(rows, null, 1), 'utf8'))

  const t = tables
  const [contacts, items, itemCategories, categories, series, sales, payments, expenses, bankAccounts, bankTx, recurrings, filings, verifactu, files, templates, emails, packs, calendar] = await Promise.all([
    db.select().from(t.contacts).where(eq(t.contacts.companyId, cid)).orderBy(asc(t.contacts.name)),
    db.select().from(t.items).where(eq(t.items.companyId, cid)).orderBy(asc(t.items.name)),
    db.select().from(t.itemCategories).where(eq(t.itemCategories.companyId, cid)).orderBy(asc(t.itemCategories.name)),
    db.select().from(t.categories).where(eq(t.categories.companyId, cid)),
    db.select().from(t.series).where(eq(t.series.companyId, cid)),
    db.select().from(t.salesDocuments).where(eq(t.salesDocuments.companyId, cid)).orderBy(asc(t.salesDocuments.issueDate), asc(t.salesDocuments.id)),
    db.select().from(t.payments).where(eq(t.payments.companyId, cid)).orderBy(asc(t.payments.date)),
    db.select().from(t.expenses).where(eq(t.expenses.companyId, cid)).orderBy(asc(t.expenses.issueDate), asc(t.expenses.id)),
    db.select().from(t.bankAccounts).where(eq(t.bankAccounts.companyId, cid)),
    db.select().from(t.bankTransactions).where(eq(t.bankTransactions.companyId, cid)).orderBy(asc(t.bankTransactions.date)),
    db.select().from(t.recurrings).where(eq(t.recurrings.companyId, cid)),
    db.select().from(t.taxFilings).where(eq(t.taxFilings.companyId, cid)),
    db.select().from(t.verifactuRecords).where(eq(t.verifactuRecords.companyId, cid)).orderBy(asc(t.verifactuRecords.id)),
    db.select().from(t.files).where(eq(t.files.companyId, cid)),
    db.select().from(t.invoiceTemplates).where(eq(t.invoiceTemplates.companyId, cid)),
    db.select().from(t.sentEmails).where(eq(t.sentEmails.companyId, cid)),
    db.select().from(t.advisorPacks).where(eq(t.advisorPacks.companyId, cid)),
    db.select().from(t.calendarEvents).where(eq(t.calendarEvents.companyId, cid)).orderBy(asc(t.calendarEvents.startDate)),
  ])
  const saleIds = sales.map(s => s.id)
  const expenseIds = expenses.map(e => e.id)
  const [lines, taxLines, counters] = await Promise.all([
    saleIds.length ? db.select().from(t.salesDocumentLines).where(inArray(t.salesDocumentLines.documentId, saleIds)).orderBy(asc(t.salesDocumentLines.documentId), asc(t.salesDocumentLines.position)) : [],
    expenseIds.length ? db.select().from(t.expenseTaxLines).where(inArray(t.expenseTaxLines.expenseId, expenseIds)) : [],
    series.length ? db.select().from(t.seriesCounters).where(inArray(t.seriesCounters.seriesId, series.map(s => s.id))) : [],
  ])

  // ─── JSON: todo, sin enlaces de acceso ni rutas internas ───
  json('empresa', { ...company, logoPath: undefined })
  json('contactos', contacts.map(c => ({ ...c, logoPath: undefined })))
  json('productos', items.map(i => ({ ...i, imagePath: undefined })))
  json('productos_categorias', itemCategories)
  json('categorias', categories)
  json('series', series)
  json('series_contadores', counters)
  json('documentos_venta', sales.map(s => ({ ...s, publicToken: undefined })))
  json('documentos_venta_lineas', lines)
  json('cobros_y_pagos', payments)
  json('gastos', expenses)
  json('gastos_desglose_iva', taxLines)
  json('banco_cuentas', bankAccounts)
  json('banco_movimientos', bankTx.map(x => ({ ...x, hash: undefined })))
  json('recurrentes', recurrings)
  json('calendario_eventos', calendar)
  json('modelos_presentados', filings)
  json('verifactu_registros', verifactu)
  json('plantillas_factura', templates)
  json('correos_enviados', emails)
  json('envios_gestor', packs.map(p => ({ ...p, token: undefined, path: undefined })))
  json('archivos', files.map(f => ({ ...f, path: undefined })))

  // ─── Excel legible ───
  const contactById = new Map(contacts.map(c => [c.id, c]))
  const categoryById = new Map(categories.map(c => [c.id, c.name]))
  const itemCategoryById = new Map(itemCategories.map(c => [c.id, c.name]))
  const saleById = new Map(sales.map(s => [s.id, s]))
  const expenseById = new Map(expenses.map(e => [e.id, e]))
  const issued = sales.filter(s => s.status !== 'draft')
  const invoices = issued.filter(s => s.kind === 'invoice' || s.kind === 'rectifying')
  const quotes = issued.filter(s => s.kind === 'quote' || s.kind === 'proforma')
  const party = (s: typeof sales[number]) => s.customer ?? (s.contactId ? contactById.get(s.contactId) : null) ?? null

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet([
    ['Tipo', 'Número', 'Fecha', 'Vencimiento', 'Cliente', 'NIF', 'Base', 'IVA', 'Recargo', 'IRPF', 'Total', 'Cobrado', 'Pendiente', 'Estado'],
    ...invoices.map(s => [KIND[s.kind], s.number, s.issueDate, s.dueDate, party(s)?.name ?? '', party(s)?.nif ?? '', s.taxBase, s.vatTotal, s.surchargeTotal, s.irpfTotal, s.total, s.paidTotal, round2(s.total - s.paidTotal), STATUS[s.status] ?? s.status]),
  ], [13, 14, 11, 12, 34, 12, 12, 11, 10, 10, 12, 12, 12, 13]), 'Facturas')
  XLSX.utils.book_append_sheet(wb, sheet([
    ['Número', 'Fecha', 'Válido hasta', 'Cliente', 'Base', 'Total', 'Estado'],
    ...quotes.map(s => [s.number, s.issueDate, s.dueDate, party(s)?.name ?? '', s.taxBase, s.total, STATUS[s.status] ?? s.status]),
  ], [14, 11, 12, 34, 12, 12, 13]), 'Presupuestos')
  XLSX.utils.book_append_sheet(wb, sheet([
    ['Documento', 'Concepto', 'Cantidad', 'Precio', 'Dto. %', 'IVA %', 'Base'],
    ...lines.filter(l => saleById.get(l.documentId)?.status !== 'draft').map(l => [saleById.get(l.documentId)?.number ?? '', l.description, l.quantity, l.unitPrice, l.discountPct, l.vatRate, l.base]),
  ], [14, 50, 10, 12, 8, 8, 12]), 'Líneas')
  XLSX.utils.book_append_sheet(wb, sheet([
    ['Fecha', 'Proveedor', 'NIF', 'Nº factura', 'Concepto', 'Categoría', 'Base', 'IVA', 'IRPF', 'Total', 'Pagado', 'Estado'],
    ...expenses.map(e => [e.issueDate, e.supplier?.name ?? '', e.supplier?.nif ?? '', e.number ?? '', e.description ?? '', e.categoryId ? categoryById.get(e.categoryId) ?? '' : '', e.taxBase, e.vatTotal, e.irpfTotal, e.total, e.paidTotal, STATUS[e.status] ?? e.status]),
  ], [11, 30, 12, 14, 34, 22, 12, 11, 10, 12, 12, 11]), 'Gastos')
  XLSX.utils.book_append_sheet(wb, sheet([
    ['Nombre', 'Nombre comercial', 'NIF', 'Cliente', 'Proveedor', 'Email', 'Teléfono', 'Dirección', 'CP', 'Ciudad', 'Provincia', 'País', 'IBAN'],
    ...contacts.map(c => [c.name, c.tradeName ?? '', c.nif ?? '', c.isClient ? 'Sí' : '', c.isSupplier ? 'Sí' : '', c.email ?? '', c.phone ?? '', c.address ?? '', c.postalCode ?? '', c.city ?? '', c.province ?? '', c.country ?? '', c.iban ?? '']),
  ], [32, 22, 12, 8, 10, 28, 14, 30, 7, 16, 14, 6, 26]), 'Contactos')
  XLSX.utils.book_append_sheet(wb, sheet([
    ['Nombre', 'Categoría', 'Descripción', 'Referencia', 'Unidad', 'Precio', 'IVA %'],
    ...items.map(i => [i.name, i.categoryId ? itemCategoryById.get(i.categoryId) ?? '' : '', i.description ?? '', i.sku ?? '', i.unit ?? '', i.unitPrice, i.vatRate]),
  ], [34, 20, 40, 12, 10, 12, 8]), 'Productos')
  XLSX.utils.book_append_sheet(wb, sheet([
    ['Fecha', 'Tipo', 'Importe', 'Forma de pago', 'Documento', 'Nota'],
    ...payments.map(p => [p.date, p.direction === 'in' ? 'Cobro' : 'Pago', p.amount, METHOD[p.method] ?? p.method,
      p.salesDocumentId ? saleById.get(p.salesDocumentId)?.number ?? '' : p.expenseId ? expenseById.get(p.expenseId)?.supplier?.name ?? expenseById.get(p.expenseId)?.description ?? '' : '', p.notes ?? '']),
  ], [11, 8, 12, 14, 30, 30]), 'Cobros y pagos')
  if (bankTx.length) {
    const accountName = new Map(bankAccounts.map(a => [a.id, a.name]))
    XLSX.utils.book_append_sheet(wb, sheet([
      ['Cuenta', 'Fecha', 'Concepto', 'Importe', 'Saldo', 'Estado'],
      ...bankTx.map(x => [accountName.get(x.accountId) ?? '', x.date, x.description, x.amount, x.balance ?? '', x.status === 'matched' ? 'Conciliado' : x.status === 'ignored' ? 'Revisado' : 'Pendiente']),
    ], [18, 11, 56, 12, 12, 12]), 'Banco')
  }
  const brand = company.tradeName || company.legalName
  const stamp = toISODate(new Date())
  add(`${safe(brand)} - datos ${stamp}.xlsx`, Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true })), false)

  // ─── PDF de los documentos emitidos ───
  let pdfs = 0
  if (opts.pdfs) {
    for (const s of issued) {
      try {
        const original = s.imported && s.fileId ? files.find(f => f.id === s.fileId) : null
        const data = original?.mime === 'application/pdf' ? await readStoredFile(original.path) : (await salesPdf(company, s.id)).buffer
        const folder = s.kind === 'quote' || s.kind === 'proforma' ? 'Presupuestos' : 'Facturas emitidas'
        add(`${folder}/${s.issueDate.slice(0, 4)}/${safe(s.number ?? `sin-numero-${s.id}`)}.pdf`, data, false)
        pdfs++
      }
      catch (err) {
        console.warn(`[copia] PDF ${s.number}:`, (err as Error).message)
      }
    }
  }

  // ─── Documentos originales ───
  let originals = 0
  if (opts.originals) {
    for (const f of files) {
      if (f.kind === 'pdf' || f.kind === 'logo') continue
      const data = await readStoredFile(f.path).catch(() => null)
      if (!data) continue
      let path: string
      if (f.kind === 'vault') path = `Archivo trimestral/${f.year ?? 'sin año'}/${f.quarter ? `${f.quarter}T` : 'sin trimestre'}/${safe(f.folder ?? 'otros')}/${safe(f.originalName)}`
      else if (f.linkedType === 'expense' && f.linkedId && expenseById.has(f.linkedId)) {
        const e = expenseById.get(f.linkedId)!
        path = `Gastos/${e.issueDate.slice(0, 4)}/${e.issueDate} ${safe(e.supplier?.name ?? e.description ?? 'gasto')} - ${safe(f.originalName)}`
      }
      else if (f.linkedType === 'sales_document' && f.linkedId && saleById.has(f.linkedId)) path = `Adjuntos de documentos/${safe(saleById.get(f.linkedId)!.number ?? 'borrador')} - ${safe(f.originalName)}`
      else if (f.kind === 'receipt') path = `Justificantes de impuestos/${safe(f.originalName)}`
      else path = `Otros documentos/${safe(f.originalName)}`
      add(path, data, !/\.(pdf|jpe?g|png|webp|heic|zip|xlsx|docx)$/i.test(f.originalName))
      originals++
    }
    for (const c of contacts) {
      if (!c.logoPath) continue
      const data = await readStoredFile(c.logoPath).catch(() => null)
      const kind = data && detectImage(data)
      if (!data || !kind) continue
      add(`Logotipos de contactos/${safe(c.name)}.${kind.ext}`, data, false)
      originals++
    }
    for (const i of items) {
      if (!i.imagePath) continue
      const data = await readStoredFile(i.imagePath).catch(() => null)
      const kind = data && detectImage(data)
      if (!data || !kind) continue
      add(`Productos/${safe(i.name)}.${kind.ext}`, data, false)
      originals++
    }
    if (company.logoPath) {
      const logo = await readStoredFile(company.logoPath).catch(() => null)
      const kind = logo && detectImage(logo)
      if (logo && kind) add(`Logo.${kind.ext}`, logo, false)
    }
  }

  const readme = [
    `${brand} · NIF ${company.nif}`,
    `Copia de seguridad completa generada con NUMIQ el ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`,
    '',
    'Contenido:',
    `· ${safe(brand)} - datos ${stamp}.xlsx: facturas, presupuestos, líneas, gastos, contactos, productos, cobros y pagos${bankTx.length ? ' y banco' : ''}, listo para abrir con Excel.`,
    '· Datos (JSON): todos los registros en formato abierto, para migrar a otro programa o restaurar.',
    opts.pdfs ? `· Facturas emitidas y Presupuestos: ${pdfs} PDF, por año.` : '',
    opts.originals ? `· Documentos originales: ${originals} archivos (tickets, facturas recibidas, archivo trimestral y adjuntos).` : '',
    '',
    `Facturas: ${invoices.length} · Presupuestos: ${quotes.length} · Gastos: ${expenses.length} · Contactos: ${contacts.length}${verifactu.length && company.verifactuEnabled ? ` · Registros VeriFactu: ${verifactu.length}` : ''}`,
    '',
    'Guarda esta copia en un lugar seguro: contiene datos personales y fiscales de tu empresa y de tus clientes.',
    'La normativa obliga a conservar facturas y registros al menos 4 años (6 años en el ámbito mercantil).',
  ].filter(l => l !== null).join('\r\n')
  add('Léeme.txt', Buffer.from(`﻿${readme.replace(/\r\n\r\n\r\n/g, '\r\n\r\n')}\r\n`, 'utf8'))

  const zip = Buffer.from(zipSync(entries))
  const settings = { ...(company.settings ?? {}), backup: { at: new Date().toISOString(), size: zip.length } }
  await db.update(tables.companies).set({ settings }).where(eq(tables.companies.id, cid))
  return { zip, filename: `${safe(brand)} - copia NUMIQ ${stamp}.zip`, counts: { invoices: invoices.length, quotes: quotes.length, expenses: expenses.length, pdfs, originals } }
}
