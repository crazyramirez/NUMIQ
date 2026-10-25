export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return eventDto(await getCalendarEvent(company.id, idParam(event)))
})
