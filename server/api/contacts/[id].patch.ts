import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, contactInputSchema)
  // Dos fichas con el mismo NIF serían el mismo contacto partido en dos
  const duplicate = await findContactDuplicate(company.id, input, id)
  if (duplicate?.certain) throw createError({ statusCode: 409, statusMessage: duplicate.label, data: { field: 'nif', duplicate } })
  const res = await useDb().update(tables.contacts).set(input)
    .where(and(eq(tables.contacts.id, id), eq(tables.contacts.companyId, company.id)))
  if (!res[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Contacto no encontrado' })
  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.update', entity: 'contact', entityId: id })
  return { ok: true }
})
