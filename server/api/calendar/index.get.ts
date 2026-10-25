import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Todo lo que tiene fecha entre `from` y `to` (cuadrícula del mes, agenda o año) */
const querySchema = z.object({
  from: z.string(),
  to: z.string(),
  layers: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const q = readQueryInput(event, querySchema)
  const range = calendarRangeSchema.safeParse({ from: q.from, to: q.to })
  if (!range.success) throw createError({ statusCode: 400, statusMessage: range.error.issues[0]!.message })
  const layers = q.layers ? q.layers.split(',').filter(Boolean) as CalendarLayer[] : undefined
  const [items, feeds] = await Promise.all([
    calendarItems(company, range.data.from, range.data.to, { layers, userId: user.id }),
    useDb().select({ id: tables.calendarFeeds.id, name: tables.calendarFeeds.name, color: tables.calendarFeeds.color, active: tables.calendarFeeds.active, lastSyncAt: tables.calendarFeeds.lastSyncAt, lastError: tables.calendarFeeds.lastError })
      .from(tables.calendarFeeds).where(and(eq(tables.calendarFeeds.companyId, company.id), eq(tables.calendarFeeds.userId, user.id))),
  ])
  return { from: range.data.from, to: range.data.to, today: madridToday(), items, feeds }
})
