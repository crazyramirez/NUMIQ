/** Nuevo evento o tarea del calendario */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, calendarEventSchema)
  await assertEventRefs(company.id, input)
  const [res] = await useDb().insert(tables.calendarEvents).values({ companyId: company.id, createdBy: user.id, ...eventValues(input) }).$returningId()
  await audit(event, { companyId: company.id, userId: user.id, action: 'calendar.create', entity: 'calendar_event', entityId: res!.id, data: { kind: input.kind } })
  return { id: res!.id }
})
