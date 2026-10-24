import { eq } from 'drizzle-orm'
import { z } from 'zod'

/** Pausa o reanuda. Al reanudar, lo atrasado no se genera: la serie sigue desde hoy. */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const rec = await getRecurring(company.id, idParam(event))
  const { active } = await readInput(event, z.object({ active: z.boolean() }))
  if (active && recurringStatus(rec) === 'finished') throw createError({ statusCode: 409, statusMessage: 'Esta serie ya terminó: cambia la fecha final para seguir' })
  let nextDate = rec.nextDate
  if (active) {
    const today = toISODate(new Date())
    const start = rec.startDate ?? rec.nextDate
    while (nextDate < today) nextDate = nextOccurrence(start, rec.frequency, rec.interval, nextDate)
    if (rec.endDate && nextDate > rec.endDate) throw createError({ statusCode: 409, statusMessage: 'No quedan fechas antes de la fecha final' })
  }
  await useDb().update(tables.recurrings).set({ active, nextDate, lastError: null }).where(eq(tables.recurrings.id, rec.id))
  await audit(event, { companyId: company.id, userId: user.id, action: active ? 'recurring.resume' : 'recurring.pause', entity: 'recurring', entityId: rec.id })
  return { active, nextDate }
})
