import { and, eq } from 'drizzle-orm'

/** Guarda el evento entero (el formulario siempre manda todos los campos) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const ev = await getCalendarEvent(company.id, idParam(event))
  const input = await readInput(event, calendarEventSchema)
  await assertEventRefs(company.id, input)
  const values = eventValues(input)
  // Si cambia la hora o la fecha, el aviso vuelve a salir
  const remindedFor = values.startDate !== ev.startDate || values.startTime !== ev.startTime || values.remindMinutes !== ev.remindMinutes ? null : ev.remindedFor
  await useDb().update(tables.calendarEvents).set({ ...values, remindedFor }).where(and(eq(tables.calendarEvents.id, ev.id), eq(tables.calendarEvents.companyId, company.id)))
  await audit(event, { companyId: company.id, userId: user.id, action: 'calendar.update', entity: 'calendar_event', entityId: ev.id })
  return { ok: true }
})
