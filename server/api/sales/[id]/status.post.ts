import { z } from 'zod'

/** Cambios de estado manuales: presupuesto aceptado/rechazado, factura marcada (o desmarcada) como enviada */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { status } = await readInput(event, z.object({ status: z.enum([...QUOTE_STATUSES, 'pending']) }))
  if (status === 'pending') {
    const result = await changeSalesPayments(company.id, id, { action: 'clear' })
    await audit(event, { companyId: company.id, userId: user.id, action: 'sales.status.pending', entity: 'sales_document', entityId: id, data: result })
    return { ok: true }
  }
  await setSalesStatus(company.id, id, status)
  await audit(event, { companyId: company.id, userId: user.id, action: `sales.status.${status}`, entity: 'sales_document', entityId: id })
  return { ok: true }
})
