import { and, eq, inArray } from 'drizzle-orm'

/** Cambios de estado manuales: presupuesto aceptado/rechazado, factura marcada (o desmarcada) como enviada */
const ALLOWED: Record<string, string[]> = {
  quote: ['issued', 'sent', 'accepted', 'rejected', 'expired'],
  proforma: ['issued', 'sent', 'accepted', 'rejected'],
  invoice: ['issued', 'sent'],
  rectifying: ['issued', 'sent'],
}

export type ManualStatus = 'issued' | 'sent' | 'accepted' | 'rejected' | 'expired'

/** Cambia el estado de un documento emitido; las facturas con cobros conservan su estado de cobro */
export async function setSalesStatus(companyId: number, id: number, status: ManualStatus) {
  const db = useDb()
  const [doc] = await db.select().from(tables.salesDocuments)
    .where(and(eq(tables.salesDocuments.id, id), eq(tables.salesDocuments.companyId, companyId)))
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
  if (doc.status === 'draft') throw createError({ statusCode: 409, statusMessage: 'Emite el documento antes de cambiar su estado' })
  if (!ALLOWED[doc.kind]?.includes(status)) throw createError({ statusCode: 400, statusMessage: 'Cambio de estado no permitido' })
  if (doc.status === 'invoiced') throw createError({ statusCode: 409, statusMessage: 'El presupuesto ya está facturado' })
  if ((doc.kind === 'invoice' || doc.kind === 'rectifying') && !['issued', 'sent'].includes(doc.status)) {
    throw createError({ statusCode: 409, statusMessage: 'Una factura con cobros conserva su estado de cobro' })
  }
  const sentAt = status === 'sent' ? (doc.status === 'sent' ? doc.sentAt : new Date()) : status === 'issued' ? null : doc.sentAt
  await db.update(tables.salesDocuments).set({ status, sentAt }).where(eq(tables.salesDocuments.id, id))
}

/**
 * Devuelve un documento emitido a borrador: sin número (al emitirlo de nuevo recibe el siguiente),
 * sin cobros (sus movimientos del banco vuelven a pendientes) y sin enlace público.
 * Las facturas con registro VeriFactu no se tocan: se corrigen con una rectificativa.
 */
export async function salesToDraft(companyId: number, id: number) {
  const db = useDb()
  const s = tables.salesDocuments
  const [doc] = await db.select().from(s).where(and(eq(s.id, id), eq(s.companyId, companyId)))
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
  if (doc.status === 'draft') return false
  if (doc.status === 'invoiced') throw createError({ statusCode: 409, statusMessage: 'El presupuesto ya está facturado' })
  const vf = tables.verifactuRecords
  const [registered] = await db.select({ id: vf.id }).from(vf).where(and(eq(vf.companyId, companyId), eq(vf.salesDocumentId, id))).limit(1)
  if (registered) throw createError({ statusCode: 409, statusMessage: 'Tiene registro VeriFactu: corrígela con una rectificativa' })
  if (doc.paidTotal !== 0 || ['paid', 'partial'].includes(doc.status)) await changeSalesPayments(companyId, id, { action: 'clear' })
  await db.update(s).set({ status: 'draft', number: null, sequence: null, sentAt: null, paidAt: null, publicToken: null })
    .where(and(eq(s.id, id), eq(s.companyId, companyId)))
  return true
}

const isInvoiceKind = (kind: string) => kind === 'invoice' || kind === 'rectifying'

export type SalesBulkAction =
  | { action: 'paid', date: 'today' | 'issue' | 'due' | string, method: 'transfer' | 'card' | 'cash' | 'direct_debit' | 'bizum' | 'other' }
  | { action: 'pending' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'draft' }
  | { action: 'due', dueDate?: string | null, dueDays?: number }

/**
 * Aplica un cambio de estado a varios documentos, uno a uno: lo que no se puede (o ya estaba así)
 * vuelve en `skipped` con el motivo, sin frenar al resto.
 */
export async function bulkSalesStatus(companyId: number, ids: number[], change: SalesBulkAction) {
  const db = useDb()
  const s = tables.salesDocuments
  const docs = await db.select({ id: s.id, kind: s.kind, status: s.status, number: s.number, issueDate: s.issueDate, dueDate: s.dueDate, sentAt: s.sentAt })
    .from(s).where(and(eq(s.companyId, companyId), inArray(s.id, ids)))
  const done: number[] = []
  const skipped: Array<{ id: number, number: string | null, reason: string }> = []
  const today = toISODate(new Date())

  for (const doc of docs) {
    const skip = (reason: string) => skipped.push({ id: doc.id, number: doc.number, reason })
    try {
      switch (change.action) {
        case 'paid': {
          if (!isInvoiceKind(doc.kind)) { skip('No es una factura'); break }
          if (doc.status === 'paid') { skip('Ya estaba cobrada'); break }
          if (doc.status === 'draft') { skip('Es un borrador: emítela antes'); break }
          const date = change.date === 'today' ? today : change.date === 'issue' ? doc.issueDate : change.date === 'due' ? doc.dueDate ?? doc.issueDate : change.date
          await changeSalesPayments(companyId, doc.id, { action: 'save', input: { date, method: change.method } })
          done.push(doc.id)
          break
        }
        case 'pending': {
          if (doc.status === 'draft') { skip('Es un borrador'); break }
          if (isInvoiceKind(doc.kind)) {
            if (!['paid', 'partial'].includes(doc.status)) { skip('Ya estaba pendiente'); break }
            await changeSalesPayments(companyId, doc.id, { action: 'clear' })
          }
          else {
            if (['issued', 'sent'].includes(doc.status)) { skip('Ya estaba pendiente'); break }
            await setSalesStatus(companyId, doc.id, doc.sentAt ? 'sent' : 'issued')
          }
          done.push(doc.id)
          break
        }
        case 'sent':
        case 'accepted':
        case 'rejected':
        case 'expired': {
          if (doc.status === change.action) { skip('Ya estaba así'); break }
          if (doc.status === 'draft') { skip('Es un borrador: emítelo antes'); break }
          if (isInvoiceKind(doc.kind) && change.action !== 'sent') { skip('Solo para presupuestos'); break }
          if (isInvoiceKind(doc.kind) && ['paid', 'partial'].includes(doc.status)) { skip('Tiene cobros: conserva su estado de cobro'); break }
          await setSalesStatus(companyId, doc.id, change.action)
          done.push(doc.id)
          break
        }
        case 'draft': {
          if (await salesToDraft(companyId, doc.id)) done.push(doc.id)
          else skip('Ya era un borrador')
          break
        }
        case 'due': {
          const dueDate = change.dueDays != null ? addDaysISO(doc.issueDate, change.dueDays) : change.dueDate ?? null
          if (dueDate && dueDate < doc.issueDate) { skip('El vencimiento quedaría antes de la fecha de emisión'); break }
          await db.update(s).set({ dueDate }).where(and(eq(s.id, doc.id), eq(s.companyId, companyId)))
          done.push(doc.id)
          break
        }
      }
    }
    catch (err) {
      skip((err as { statusMessage?: string }).statusMessage || 'No se pudo cambiar')
    }
  }
  return { done, skipped }
}
