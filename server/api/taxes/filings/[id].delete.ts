import { and, eq } from 'drizzle-orm'

/** Deshace el registro de una presentación (por si se marcó por error). El justificante sigue en el archivo. */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()
  const r = await db.delete(tables.taxFilings).where(and(eq(tables.taxFilings.id, id), eq(tables.taxFilings.companyId, company.id)))
  if (!r[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Presentación no encontrada' })
  await db.update(tables.files).set({ linkedType: null, linkedId: null }).where(and(eq(tables.files.companyId, company.id), eq(tables.files.linkedType, 'tax_filing'), eq(tables.files.linkedId, id)))
  await audit(event, { companyId: company.id, userId: user.id, action: 'tax.unfiled', entity: 'tax_filing', entityId: id })
  return { ok: true }
})
