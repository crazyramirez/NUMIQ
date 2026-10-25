import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Marca (o desmarca) una tarea como hecha en una fecha concreta de la serie */
const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), done: z.boolean() })

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const ev = await getCalendarEvent(company.id, idParam(event))
  const { date, done } = await readInput(event, schema)
  const set = new Set(ev.doneDates ?? [])
  if (done) set.add(date)
  else set.delete(date)
  // Solo se guardan las más recientes: una tarea semanal no crece sin fin
  const doneDates = [...set].sort().slice(-400)
  await useDb().update(tables.calendarEvents).set({ doneDates }).where(and(eq(tables.calendarEvents.id, ev.id), eq(tables.calendarEvents.companyId, company.id)))
  return { ok: true, doneDates }
})
