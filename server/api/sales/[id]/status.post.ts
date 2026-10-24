import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Cambios de estado manuales: presupuesto aceptado/rechazado, factura marcada (o desmarcada) como enviada */
const ALLOWED: Record<string, string[]> = {
  quote: ['issued', 'sent', 'accepted', 'rejected', 'expired'],
  proforma: ['issued', 'sent', 'accepted', 'rejected'],
  invoice: ['issued', 'sent'],
  rectifying: ['issued', 'sent'],
}

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { status } = await readInput(event, z.object({ status: z.enum(['issued', 'sent', 'accepted', 'rejected', 'expired', 'pending']) }))
  if (status === 'pending') {
    const result = await changeSalesPayments(company.id, id, { action: 'clear' })
    await audit(event, { companyId: company.id, userId: user.id, action: 'sales.status.pending', entity: 'sales_document', entityId: id, data: result })
    return { ok: true }
  }
  const db = useDb()
  const [doc] = await db.select().from(tables.salesDocuments)
    .where(and(eq(tables.salesDocuments.id, id), eq(tables.salesDocuments.companyId, company.id)))
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
  if (doc.status === 'draft') throw createError({ statusCode: 409, statusMessage: 'Emite el documento antes de cambiar su estado' })
  if (!ALLOWED[doc.kind]?.includes(status)) throw createError({ statusCode: 400, statusMessage: 'Cambio de estado no permitido' })
  if (doc.status === 'invoiced') throw createError({ statusCode: 409, statusMessage: 'El presupuesto ya está facturado' })
  // Una factura cobrada (total o parcialmente) conserva su estado de cobro
  if ((doc.kind === 'invoice' || doc.kind === 'rectifying') && !['issued', 'sent'].includes(doc.status)) {
    throw createError({ statusCode: 409, statusMessage: 'Una factura con cobros conserva su estado de cobro' })
  }
  const sentAt = status === 'sent' ? (doc.status === 'sent' ? doc.sentAt : new Date()) : status === 'issued' ? null : doc.sentAt
  await db.update(tables.salesDocuments).set({ status, sentAt }).where(eq(tables.salesDocuments.id, id))
  await audit(event, { companyId: company.id, userId: user.id, action: `sales.status.${status}`, entity: 'sales_document', entityId: id })
  return { ok: true }
})
