import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const db = useDb()
  const c = tables.aiConversations
  const r = await db.delete(c).where(and(eq(c.id, id), eq(c.companyId, company.id), eq(c.userId, user.id)))
  if (!r[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Conversación no encontrada' })
  await db.delete(tables.aiMessages).where(eq(tables.aiMessages.conversationId, id))
  return { ok: true }
})
