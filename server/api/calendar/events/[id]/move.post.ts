import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Arrastrar a otro día: mueve el evento (o la serie entera si se repite) los días indicados */
const schema = z.object({ days: z.number().int().min(-3660).max(3660) })

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const ev = await getCalendarEvent(company.id, idParam(event))
  const { days } = await readInput(event, schema)
  if (!days) return { ok: true }
  const move = (d: string | null) => (d ? shiftDays(d, days) : null)
  await useDb().update(tables.calendarEvents).set({
    startDate: move(ev.startDate)!,
    endDate: move(ev.endDate),
    repeatUntil: move(ev.repeatUntil),
    doneDates: (ev.doneDates ?? []).map(d => shiftDays(d, days)),
    remindedFor: null,
  }).where(and(eq(tables.calendarEvents.id, ev.id), eq(tables.calendarEvents.companyId, company.id)))
  scheduleCalendarPush(company.id)
  return { ok: true }
})
