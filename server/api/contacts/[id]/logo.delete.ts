import { and, eq } from 'drizzle-orm'

/** Quita el logotipo del contacto */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()
  const [contact] = await db.select({ logoPath: tables.contacts.logoPath }).from(tables.contacts)
    .where(and(eq(tables.contacts.id, id), eq(tables.contacts.companyId, company.id)))
  if (!contact) throw createError({ statusCode: 404, statusMessage: 'Contacto no encontrado' })
  await db.update(tables.contacts).set({ logoPath: null }).where(eq(tables.contacts.id, id))
  await deleteStoredFile(contact.logoPath)
  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.logo.delete', entity: 'contact', entityId: id })
  return { ok: true }
})
