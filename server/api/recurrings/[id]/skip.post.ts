/** Se salta la próxima fecha sin generar nada (vacaciones, un mes sin servicio…) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const rec = await getRecurring(company.id, idParam(event))
  if (recurringStatus(rec) === 'finished') throw createError({ statusCode: 409, statusMessage: 'Esta serie ya terminó' })
  const r = await skipNext(rec)
  await audit(event, { companyId: company.id, userId: user.id, action: 'recurring.skip', entity: 'recurring', entityId: rec.id, data: { skipped: rec.nextDate } })
  return r
})
