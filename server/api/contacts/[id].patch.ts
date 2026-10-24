import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, contactInputSchema)
  const res = await useDb().update(tables.contacts).set(input)
    .where(and(eq(tables.contacts.id, id), eq(tables.contacts.companyId, company.id)))
  if (!res[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Contacto no encontrado' })
  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.update', entity: 'contact', entityId: id })
  return { ok: true }
})
