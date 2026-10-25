import { and, eq } from 'drizzle-orm'

/** Vuelve a leer el calendario externo ahora */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const [feed] = await useDb().select().from(tables.calendarFeeds)
    .where(and(eq(tables.calendarFeeds.id, idParam(event)), eq(tables.calendarFeeds.companyId, company.id), eq(tables.calendarFeeds.userId, user.id)))
  if (!feed) throw createError({ statusCode: 404, statusMessage: 'Calendario no encontrado' })
  const r = await syncFeedOnce(feed) as Awaited<ReturnType<typeof syncFeed>>
  if (!r.ok) throw createError({ statusCode: 400, statusMessage: r.error })
  return { ok: true, count: r.count }
})
