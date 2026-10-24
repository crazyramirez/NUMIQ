import { and, eq } from 'drizzle-orm'

/** Borra la programación. Lo ya generado (facturas, gastos) se queda como está. */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const rec = await getRecurring(company.id, idParam(event))
  await useDb().delete(tables.recurrings).where(and(eq(tables.recurrings.id, rec.id), eq(tables.recurrings.companyId, company.id)))
  await audit(event, { companyId: company.id, userId: user.id, action: 'recurring.delete', entity: 'recurring', entityId: rec.id, data: { name: rec.name } })
  return { ok: true }
})
