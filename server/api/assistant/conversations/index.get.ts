import { and, desc, eq } from 'drizzle-orm'

/** Conversaciones del usuario con el asistente */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const c = tables.aiConversations
  return useDb().select({ id: c.id, title: c.title, updatedAt: c.updatedAt }).from(c)
    .where(and(eq(c.companyId, company.id), eq(c.userId, user.id)))
    .orderBy(desc(c.updatedAt)).limit(50)
})
