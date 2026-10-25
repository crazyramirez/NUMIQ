import { randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, max, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { PartySnapshot } from '../db/schema'
import type { SalesInvoiceLink, SalesSourceLink } from '../../shared/types/sales-links'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD')

export const salesLineSchema = z.object({
  itemId: z.number().int().positive().nullish(),
  // Vacío solo en las facturas «solo descripción» (todas las líneas sin concepto): se comprueba al guardar
  description: z.string().trim().max(2000),
  quantity: z.number().finite().min(-999999).max(999999),
  unitPrice: z.number().finite().min(-99999999).max(99999999),
  discountPct: z.number().min(0).max(100).default(0),
  vatRate: z.number().min(0).max(100),
  surchargeRate: z.number().min(0).max(100).default(0),
  irpfApplies: z.boolean().default(true),
})

export const salesInputSchema = z.object({
  number: z.string().trim().max(40).nullish(),
  kind: z.enum(['quote', 'proforma', 'invoice', 'rectifying']).default('invoice'),
  seriesId: z.number().int().positive().nullish(),
  contactId: z.number().int().positive().nullish(),
  customerReference: z.string().trim().max(80, 'Máximo 80 caracteres').nullish(),
  issueDate: isoDate,
  dueDate: isoDate.nullish(),
  operationDate: isoDate.nullish(),
  irpfRate: z.number().min(0).max(100).default(0),
  paymentMethod: z.enum(['transfer', 'card', 'cash', 'direct_debit', 'bizum', 'other']).default('transfer'),
  description: richDocSchema.nullish(),
  notes: z.string().max(5000).nullish(),
  terms: z.string().max(5000).nullish(),
  rectifiesId: z.number().int().positive().nullish(),
  rectificationCode: z.enum(['R1', 'R2', 'R3', 'R4', 'R5']).nullish(),
  rectificationReason: z.string().max(255).nullish(),
  lines: z.array(salesLineSchema).min(1, 'Añade al menos una línea').max(500),
  /** Firma: null = lo que diga Ajustes; sin enviar = no se toca */
  sign: z.boolean().nullable().optional(),
  signatureId: z.number().int().positive().nullable().optional(),
})

export type SalesInput = z.infer<typeof salesInputSchema>

export function companySnapshot(c: typeof tables.companies.$inferSelect): PartySnapshot {
  return {
    name: c.legalName,
    nif: c.nif, email: c.email, address: c.address, postalCode: c.postalCode, city: c.city, province: c.province, country: c.country,
  }
}

export function contactSnapshot(c: Pick<typeof tables.contacts.$inferSelect, 'name' | 'nif' | 'email' | 'address' | 'postalCode' | 'city' | 'province' | 'country'>): PartySnapshot {
  return { name: c.name, nif: c.nif, email: c.email, address: c.address, postalCode: c.postalCode, city: c.city, province: c.province, country: c.country }
}

async function defaultSeriesId(companyId: number, kind: SalesInput['kind']) {
  const [s] = await useDb().select({ id: tables.series.id }).from(tables.series)
    .where(and(eq(tables.series.companyId, companyId), eq(tables.series.kind, kind)))
    .orderBy(desc(tables.series.isDefault))
    .limit(1)
  return s?.id ?? null
}

/** Crea o actualiza un documento. Las facturas emitidas sin VeriFactu o importadas se pueden modificar. */
export async function saveSalesDraft(companyId: number, userId: number, input: SalesInput, id?: number) {
  const db = useDb()
  if (isConceptless(input.lines)) {
    if (!richToPlain(input.description)?.trim()) throw createError({ statusCode: 400, statusMessage: 'Sin conceptos, describe el trabajo en la descripción', data: { field: 'description' } })
  }
  else {
    const blank = input.lines.findIndex(l => !l.description.trim())
    if (blank >= 0) throw createError({ statusCode: 400, statusMessage: 'Describe el concepto', data: { field: `lines.${blank}.description` } })
  }
  if (input.contactId) {
    const [c] = await db.select({ id: tables.contacts.id }).from(tables.contacts)
      .where(and(eq(tables.contacts.id, input.contactId), eq(tables.contacts.companyId, companyId)))
    if (!c) throw createError({ statusCode: 400, statusMessage: 'Cliente no encontrado' })
  }
  const totals = computeTotals(input.lines, input.irpfRate)
  const values: Record<string, unknown> = {
    kind: input.kind,
    seriesId: input.seriesId ?? await defaultSeriesId(companyId, input.kind),
    contactId: input.contactId ?? null,
    customerReference: input.customerReference || null,
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    operationDate: input.operationDate ?? null,
    irpfRate: input.irpfRate,
    paymentMethod: input.paymentMethod,
    description: input.description ?? null,
    notes: input.notes ?? null,
    terms: input.terms ?? null,
    rectifiesId: input.rectifiesId ?? null,
    rectificationCode: input.rectificationCode ?? null,
    rectificationReason: input.rectificationReason ?? null,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxBase: totals.taxBase,
    vatTotal: totals.vatTotal,
    surchargeTotal: totals.surchargeTotal,
    irpfTotal: totals.irpfTotal,
    total: totals.total,
  }
  if (input.sign !== undefined) values.sign = input.sign
  if (input.signatureId !== undefined) {
    if (input.signatureId) await findSignature(companyId, input.signatureId)
    values.signatureId = input.signatureId
  }

  return db.transaction(async (tx) => {
    let docId = id
    if (docId) {
      const [doc] = await tx.select({
        id: tables.salesDocuments.id,
        status: tables.salesDocuments.status,
        kind: tables.salesDocuments.kind,
        imported: tables.salesDocuments.imported,
        number: tables.salesDocuments.number,
        contactId: tables.salesDocuments.contactId,
      }).from(tables.salesDocuments)
        .where(and(eq(tables.salesDocuments.id, docId), eq(tables.salesDocuments.companyId, companyId)))
      if (!doc) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })

      if (doc.status !== 'draft' && values.kind !== 'quote' && values.kind !== 'proforma' && !doc.imported) {
        const [hasVf] = await tx.select({ id: tables.verifactuRecords.id })
          .from(tables.verifactuRecords)
          .where(and(eq(tables.verifactuRecords.companyId, companyId), eq(tables.verifactuRecords.salesDocumentId, docId)))
          .limit(1)
        if (hasVf) {
          throw createError({ statusCode: 409, statusMessage: 'Esta factura tiene registro VeriFactu y no se puede modificar: emite una rectificativa' })
        }
      }

      const updateValues: Record<string, unknown> = { ...values }
      if (input.number !== undefined) {
        updateValues.number = input.number?.trim() || null
      }
      if (doc.status !== 'draft') {
        const contact = input.contactId
          ? (await tx.select().from(tables.contacts).where(eq(tables.contacts.id, input.contactId)))[0]
          : undefined
        // Sin contacto desde antes (se eliminó la ficha): se conserva la copia de sus datos
        if (contact) updateValues.customer = contactSnapshot(contact)
        else if (doc.contactId) updateValues.customer = null
        updateValues.year = Number(input.issueDate.slice(0, 4))
      }

      await tx.update(tables.salesDocuments).set(updateValues).where(eq(tables.salesDocuments.id, docId))
      await tx.delete(tables.salesDocumentLines).where(eq(tables.salesDocumentLines.documentId, docId))
    }
    else {
      const [res] = await tx.insert(tables.salesDocuments).values({
        ...values,
        companyId,
        status: 'draft',
        createdBy: userId,
      } as typeof tables.salesDocuments.$inferInsert).$returningId()
      docId = res!.id
    }
    await tx.insert(tables.salesDocumentLines).values(input.lines.map((l, position) => ({
      ...l,
      itemId: l.itemId ?? null,
      documentId: docId!,
      position,
      base: lineAmounts(l).base,
    })))
    if (id) {
      await refreshPaidStatus(docId!, tx)
    }
    return docId!
  })
}

/**
 * Emite un borrador: número correlativo, datos de emisor y cliente congelados y, si es factura,
 * registro VeriFactu encadenado. Todo en una transacción.
 */
export async function issueSalesDocument(companyId: number, id: number) {
  const db = useDb()
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(tables.salesDocuments)
      .where(and(eq(tables.salesDocuments.id, id), eq(tables.salesDocuments.companyId, companyId)))
      .for('update')
    if (!doc) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
    if (doc.status !== 'draft') throw createError({ statusCode: 409, statusMessage: 'Este documento ya está emitido' })
    if (!doc.seriesId) throw createError({ statusCode: 400, statusMessage: 'Elige una serie de numeración' })
    const isInvoice = doc.kind === 'invoice' || doc.kind === 'rectifying'
    if (isInvoice && !doc.contactId) throw createError({ statusCode: 400, statusMessage: 'La factura necesita un cliente' })

    const [company] = await tx.select().from(tables.companies).where(eq(tables.companies.id, companyId))
    const contact = doc.contactId
      ? (await tx.select().from(tables.contacts).where(eq(tables.contacts.id, doc.contactId)))[0]
      : undefined
    if (isInvoice && !contact?.nif) throw createError({ statusCode: 400, statusMessage: 'El cliente necesita NIF para emitir una factura completa' })

    const year = Number(doc.issueDate.slice(0, 4))
    if (isInvoice) {
      // Correlatividad: no se puede emitir con fecha anterior a la última factura de la serie
      const [last] = await tx.select({ d: max(tables.salesDocuments.issueDate) }).from(tables.salesDocuments)
        .where(and(eq(tables.salesDocuments.seriesId, doc.seriesId), eq(tables.salesDocuments.year, year), isNotNull(tables.salesDocuments.number), ne(tables.salesDocuments.id, id)))
      if (last?.d && last.d > doc.issueDate) {
        throw createError({ statusCode: 409, statusMessage: `La fecha no puede ser anterior a la última factura de la serie (${last.d})` })
      }
    }

    const { sequence, number } = await takeNextNumber(tx, doc.seriesId, year)
    await tx.update(tables.salesDocuments).set({
      number,
      sequence,
      year,
      status: 'issued',
      issuer: companySnapshot(company!),
      customer: contact ? contactSnapshot(contact) : null,
      publicToken: randomBytes(24).toString('base64url'),
    }).where(eq(tables.salesDocuments.id, id))

    // VeriFactu pospuesto como mínimo a 2028: desactivado de la app para no generar huellas ni bloquear edición
    const VERIFACTU_ACTIVE = false
    if (VERIFACTU_ACTIVE && isInvoice && company!.verifactuEnabled) {
      await createAltaRecord(tx, { ...doc, number }, company!.nif)
    }
    if (doc.kind === 'invoice' && doc.sourceId) {
      await tx.update(tables.salesDocuments).set({ status: 'invoiced' }).where(eq(tables.salesDocuments.id, doc.sourceId))
    }
    return number
  })
}

/** Recalcula lo cobrado de un documento y su estado */
export async function refreshPaidStatus(documentId: number, db: Pick<ReturnType<typeof useDb>, 'select' | 'update'> = useDb()) {
  const rows = await db.select({ amount: tables.payments.amount }).from(tables.payments).where(eq(tables.payments.salesDocumentId, documentId))
  const paid = round2(rows.reduce((s, r) => s + r.amount, 0))
  const [doc] = await db.select({ total: tables.salesDocuments.total, status: tables.salesDocuments.status, sentAt: tables.salesDocuments.sentAt, paidAt: tables.salesDocuments.paidAt }).from(tables.salesDocuments).where(eq(tables.salesDocuments.id, documentId))
  if (!doc) return
  const paidDiff = round2(Math.abs(doc.total) - Math.abs(paid))
  const isPaid = rows.length > 0 && (
    paidDiff <= 0.005 ||
    (paidDiff <= 1.00 && Math.abs(paid) >= Math.abs(doc.total) * 0.95)
  )
  const status = isPaid ? 'paid' : paid !== 0 ? 'partial' : (doc.status === 'paid' || doc.status === 'partial' ? doc.sentAt ? 'sent' : 'issued' : doc.status)
  await db.update(tables.salesDocuments).set({ paidTotal: paid, status, paidAt: status === 'paid' ? doc.paidAt ?? new Date() : null }).where(eq(tables.salesDocuments.id, documentId))
}

export const OPEN_STATUSES = ['issued', 'sent', 'partial'] as const

/** Emitido y con cobro pendiente */
export function isOpenStatus(status: string) {
  return (OPEN_STATUSES as readonly string[]).includes(status)
}

/** Facturas emitidas desde presupuestos: una consulta para todo el listado y siempre de la empresa. */
/**
 * Concepto corto de cada documento para las listas: su descripción en texto plano o, si no tiene,
 * sus líneas unidas con « · ».
 */
export async function salesConcepts(docs: Array<{ id: number, description: Parameters<typeof richToPlain>[0] }>) {
  const ids = docs.map(d => d.id)
  const lines = ids.length
    ? await useDb().select({ documentId: tables.salesDocumentLines.documentId, description: tables.salesDocumentLines.description })
      .from(tables.salesDocumentLines)
      .where(inArray(tables.salesDocumentLines.documentId, ids))
      .orderBy(tables.salesDocumentLines.position)
    : []
  const linesByDoc = new Map<number, string[]>()
  for (const l of lines) {
    const desc = l.description?.trim()
    if (desc) linesByDoc.set(l.documentId, [...(linesByDoc.get(l.documentId) ?? []), desc])
  }
  return new Map(docs.map((d) => {
    const descriptionText = richToPlain(d.description)?.replace(/\s+/g, ' ').trim() || null
    const docLines = linesByDoc.get(d.id) ?? []
    const linesSummary = docLines.length ? docLines.join(' · ') : null
    return [d.id, { descriptionText, linesSummary, conceptPreview: descriptionText || linesSummary || null }]
  }))
}

export async function loadQuoteInvoices(companyId: number, quoteIds: number[]) {
  const result = new Map<number, SalesInvoiceLink[]>()
  if (!quoteIds.length) return result
  const s = tables.salesDocuments
  const invoices = await useDb().select({ id: s.id, sourceId: s.sourceId, number: s.number, status: s.status }).from(s)
    .where(and(eq(s.companyId, companyId), inArray(s.sourceId, quoteIds), eq(s.kind, 'invoice'), ne(s.status, 'draft')))
    .orderBy(desc(s.issueDate), desc(s.id))
  for (const { sourceId, ...invoice } of invoices) {
    const links = result.get(sourceId!) ?? []
    links.push(invoice)
    result.set(sourceId!, links)
  }
  return result
}

/**
 * Documento original (importado o escaneado) que se puede enviar al cliente con la factura: solo si
 * es suyo y de nadie más. Un Excel/CSV o un PDF con varias facturas llevaría datos de otros clientes.
 */
async function ownOriginal(companyId: number, id: number, fileId: number) {
  const db = useDb()
  const f = tables.files
  const [file] = await db.select({ id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, kind: f.kind })
    .from(f).where(and(eq(f.id, fileId), eq(f.companyId, companyId)))
  // Ya adjunto: sale en la lista de adjuntos
  if (!file || file.kind === 'attachment' || /spreadsheet|excel|csv|tab-separated|zip/.test(file.mime)) return null
  const [sales, expenses] = await Promise.all([
    db.select({ id: tables.salesDocuments.id }).from(tables.salesDocuments)
      .where(and(eq(tables.salesDocuments.companyId, companyId), eq(tables.salesDocuments.fileId, fileId), ne(tables.salesDocuments.id, id))).limit(1),
    db.select({ id: tables.expenses.id }).from(tables.expenses)
      .where(and(eq(tables.expenses.companyId, companyId), eq(tables.expenses.fileId, fileId))).limit(1),
  ])
  if (sales.length || expenses.length) return null
  return { id: file.id, originalName: file.originalName, mime: file.mime, size: file.size }
}

export async function loadSalesDocument(companyId: number, id: number) {
  const db = useDb()
  const [doc] = await db.select().from(tables.salesDocuments)
    .where(and(eq(tables.salesDocuments.id, id), eq(tables.salesDocuments.companyId, companyId)))
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
  const isQuoteFamily = doc.kind === 'quote' || doc.kind === 'proforma'
  const familyKinds = isQuoteFamily ? (['quote', 'proforma'] as const) : (['invoice', 'rectifying'] as const)

  const [lines, payments, contact, verifactu, emails, attachments, owner, invoiceLinks, siblings, source, original] = await Promise.all([
    db.select().from(tables.salesDocumentLines).where(eq(tables.salesDocumentLines.documentId, id)).orderBy(tables.salesDocumentLines.position),
    db.select().from(tables.payments).where(eq(tables.payments.salesDocumentId, id)).orderBy(tables.payments.date),
    doc.contactId ? db.select().from(tables.contacts).where(eq(tables.contacts.id, doc.contactId)).then(r => r[0] ?? null) : null,
    db.select().from(tables.verifactuRecords).where(eq(tables.verifactuRecords.salesDocumentId, id)).orderBy(desc(tables.verifactuRecords.id)).limit(1).then(r => r[0] ?? null),
    db.select({
      id: tables.sentEmails.id, kind: tables.sentEmails.kind, to: tables.sentEmails.to, subject: tables.sentEmails.subject,
      status: tables.sentEmails.status, error: tables.sentEmails.error, withPdf: tables.sentEmails.withPdf, createdAt: tables.sentEmails.createdAt,
    }).from(tables.sentEmails).where(eq(tables.sentEmails.salesDocumentId, id)).orderBy(desc(tables.sentEmails.id)).limit(20),
    listAttachments(companyId, 'sales_document', id),
    db.select({ settings: tables.companies.settings, verifactuEnabled: tables.companies.verifactuEnabled }).from(tables.companies).where(eq(tables.companies.id, companyId)).then(r => r[0] ?? null),
    loadQuoteInvoices(companyId, isQuoteFamily ? [id] : []),
    db.select({
      id: tables.salesDocuments.id,
      number: tables.salesDocuments.number,
      status: tables.salesDocuments.status,
    })
      .from(tables.salesDocuments)
      .where(and(
        eq(tables.salesDocuments.companyId, companyId),
        inArray(tables.salesDocuments.kind, [...familyKinds]),
      ))
      .orderBy(
        sql`${tables.salesDocuments.status} = 'draft' ASC`,
        tables.salesDocuments.issueDate,
        sql`COALESCE(${tables.salesDocuments.sequence}, 0) ASC`,
        tables.salesDocuments.id,
      ),
    doc.sourceId
      ? db.select({ id: tables.salesDocuments.id, number: tables.salesDocuments.number, kind: tables.salesDocuments.kind, status: tables.salesDocuments.status })
        .from(tables.salesDocuments)
        .where(and(eq(tables.salesDocuments.id, doc.sourceId), eq(tables.salesDocuments.companyId, companyId)))
        .then(r => r[0] ?? null)
      : null,
    doc.fileId ? ownOriginal(companyId, id, doc.fileId) : null,
  ])
  const signing = await documentSignature(companyId, signingSettings({ settings: owner?.settings ?? null }), doc)
  const production = owner ? verifactuSettings(owner).environment === 'production' : false
  const idx = siblings.findIndex(s => s.id === id)
  const prev = idx > 0 ? { id: siblings[idx - 1]!.id, number: siblings[idx - 1]!.number } : null
  const next = idx >= 0 && idx < siblings.length - 1 ? { id: siblings[idx + 1]!.id, number: siblings[idx + 1]!.number } : null

  return {
    ...doc,
    invoices: invoiceLinks.get(id) ?? [],
    /** Presupuesto del que sale la factura */
    source: source as SalesSourceLink | null,
    lines,
    payments,
    emails,
    attachments,
    /** Archivo importado o escaneado del que sale la factura (si no figura ya entre los adjuntos) */
    original,
    /** Firma que se ve en el documento (null = sin firma) y si Ajustes la pone por defecto en su tipo */
    signature: signing.signature,
    signDefault: signing.byDefault,
    contact: contact ? contactView(contact) : null,
    hasVerifactu: false,
    canEdit: true,
    // VeriFactu desactivado de la vista y del PDF por ahora
    verifactu: null as ({ hash: string, qrUrl: string } & Record<string, any>) | null,
    prev,
    next,
  }
}
