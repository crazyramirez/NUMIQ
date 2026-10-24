import { z } from 'zod'

/** Vincula el presupuesto con la factura (en cualquier sentido): la factura pasa a salir del presupuesto */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { targetId, replace } = await readInput(event, z.object({ targetId: z.number().int().positive(), replace: z.boolean().optional() }))
  const r = await linkQuoteInvoice(company.id, id, targetId, { replace })
  if (r.changed) await audit(event, { companyId: company.id, userId: user.id, action: 'sales.link', entity: 'sales_document', entityId: r.invoiceId, data: { quoteId: r.quoteId, previous: r.previous } })
  return { ok: true, quoteId: r.quoteId, invoiceId: r.invoiceId }
})
