import { and, eq } from 'drizzle-orm'

/** Borra el evento (con todas sus repeticiones) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const ev = await getCalendarEvent(company.id, idParam(event))
  await useDb().delete(tables.calendarEvents).where(and(eq(tables.calendarEvents.id, ev.id), eq(tables.calendarEvents.companyId, company.id)))
  await audit(event, { companyId: company.id, userId: user.id, action: 'calendar.delete', entity: 'calendar_event', entityId: ev.id, data: { title: ev.title } })
  scheduleCalendarPush(company.id)
  return { ok: true }
})
