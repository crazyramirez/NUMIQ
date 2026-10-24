import { z } from 'zod'

/** Quita el vínculo entre el presupuesto y la factura; ninguno de los dos cambia en nada más */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { targetId } = await readInput(event, z.object({ targetId: z.number().int().positive() }))
  const r = await unlinkQuoteInvoice(company.id, id, targetId)
  if (r.changed) await audit(event, { companyId: company.id, userId: user.id, action: 'sales.unlink', entity: 'sales_document', entityId: r.invoiceId, data: { quoteId: r.quoteId } })
  return { ok: true }
})
