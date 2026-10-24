import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { companyId } = await readInput(event, z.object({ companyId: z.number().int().positive() }))
  const db = useDb()
  const [member] = await db.select().from(tables.companyMembers)
    .where(and(eq(tables.companyMembers.companyId, companyId), eq(tables.companyMembers.userId, user.id)))
  if (!member) throw createError({ statusCode: 403, statusMessage: 'No tienes acceso a esa empresa' })
  await db.update(tables.users).set({ currentCompanyId: companyId }).where(eq(tables.users.id, user.id))
  return { ok: true }
})
