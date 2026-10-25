import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  await useDb().delete(tables.calendarFeeds).where(and(eq(tables.calendarFeeds.id, idParam(event)), eq(tables.calendarFeeds.companyId, company.id), eq(tables.calendarFeeds.userId, user.id)))
  return { ok: true }
})
