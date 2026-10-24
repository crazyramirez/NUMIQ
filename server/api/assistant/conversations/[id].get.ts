import { and, asc, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const db = useDb()
  const c = tables.aiConversations
  const [conv] = await db.select().from(c).where(and(eq(c.id, id), eq(c.companyId, company.id), eq(c.userId, user.id)))
  if (!conv) throw createError({ statusCode: 404, statusMessage: 'Conversación no encontrada' })
  const m = tables.aiMessages
  const messages = await db.select({ id: m.id, role: m.role, content: m.content, tools: m.tools, createdAt: m.createdAt }).from(m)
    .where(eq(m.conversationId, id)).orderBy(asc(m.id))
  return { id: conv.id, title: conv.title, messages }
})
