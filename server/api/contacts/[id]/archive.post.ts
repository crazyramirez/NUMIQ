import { and, eq } from 'drizzle-orm'

/** Archiva un contacto (cliente o proveedor) sin eliminarlo ni desasignar sus documentos */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()

  const res = await db.update(tables.contacts).set({ archivedAt: new Date() })
    .where(and(eq(tables.contacts.id, id), eq(tables.contacts.companyId, company.id)))
  if (!res[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Contacto no encontrado' })

  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.archive', entity: 'contact', entityId: id })
  return { ok: true }
})
