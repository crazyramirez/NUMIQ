import { and, eq } from 'drizzle-orm'

/** Presupuesto o proforma → borrador de factura con las mismas líneas */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const src = await loadSalesDocument(company.id, id)
  if (src.kind !== 'quote' && src.kind !== 'proforma') throw createError({ statusCode: 400, statusMessage: 'Solo se convierten presupuestos y proformas' })

  const today = toISODate(new Date())
  const due = new Date()
  due.setDate(due.getDate() + (src.contact?.paymentTermsDays ?? company.paymentTermsDays))
  const newId = await saveSalesDraft(company.id, user.id, {
    kind: 'invoice',
    contactId: src.contactId,
    customerReference: src.customerReference,
    issueDate: today,
    dueDate: toISODate(due),
    irpfRate: src.irpfRate,
    paymentMethod: src.paymentMethod ?? 'transfer',
    description: src.description,
    notes: src.notes,
    terms: src.terms,
    lines: src.lines.map(l => ({
      itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
      discountPct: l.discountPct, vatRate: l.vatRate, surchargeRate: l.surchargeRate, irpfApplies: l.irpfApplies,
    })),
  })
  const db = useDb()
  await db.update(tables.salesDocuments).set({ sourceId: id })
    .where(and(eq(tables.salesDocuments.id, newId), eq(tables.salesDocuments.companyId, company.id)))
  if (src.status !== 'invoiced') {
    await db.update(tables.salesDocuments).set({ status: 'accepted' }).where(eq(tables.salesDocuments.id, id))
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.convert', entity: 'sales_document', entityId: newId, data: { from: id } })
  return { id: newId }
})
