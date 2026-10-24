import { and, eq } from 'drizzle-orm'

/** Borra un envío y su ZIP (el enlace del gestor deja de funcionar) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()
  const [pack] = await db.select().from(tables.advisorPacks).where(and(eq(tables.advisorPacks.id, id), eq(tables.advisorPacks.companyId, company.id)))
  if (!pack) throw createError({ statusCode: 404, statusMessage: 'Envío no encontrado' })
  await deleteStoredFile(pack.path || null)
  await db.delete(tables.advisorPacks).where(eq(tables.advisorPacks.id, id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'advisor.delete', entity: 'advisor_pack', entityId: id })
  return { ok: true }
})
