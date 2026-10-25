import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1, 'Ponle un nombre').max(80).optional(),
  color: z.string().refine(isCalendarColor, 'Color no válido').optional(),
  active: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const input = await readInput(event, schema)
  const where = and(eq(tables.calendarFeeds.id, idParam(event)), eq(tables.calendarFeeds.companyId, company.id), eq(tables.calendarFeeds.userId, user.id))
  const [feed] = await useDb().select({ id: tables.calendarFeeds.id }).from(tables.calendarFeeds).where(where)
  if (!feed) throw createError({ statusCode: 404, statusMessage: 'Calendario no encontrado' })
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
  if (Object.keys(set).length) await useDb().update(tables.calendarFeeds).set(set).where(where)
  return { ok: true }
})
