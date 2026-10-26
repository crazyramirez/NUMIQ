import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const db = useDb()
  const [file] = await db.select().from(tables.files)
    .where(and(eq(tables.files.id, id), eq(tables.files.companyId, company.id), eq(tables.files.kind, 'vault')))
  if (!file) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
  assertOwnAdvisorFile(company, role, user.id, file)
  await db.delete(tables.files).where(eq(tables.files.id, id))
  await deleteStoredFile(file.path)
  await audit(event, { companyId: company.id, userId: user.id, action: 'vault.delete', entity: 'file', entityId: id, data: { name: file.originalName } })
  return { ok: true }
})
