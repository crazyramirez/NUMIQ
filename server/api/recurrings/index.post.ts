/** Programa una factura o un gasto recurrente */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, recurringInputSchema)
  if (input.nextDate < shiftDays(toISODate(new Date()), -366)) {
    throw createError({ statusCode: 400, statusMessage: 'La primera fecha no puede ser de hace más de un año', data: { field: 'nextDate' } })
  }
  await assertTemplateRefs(company.id, input)
  const [res] = await useDb().insert(tables.recurrings).values({
    companyId: company.id,
    kind: input.kind,
    name: input.name,
    frequency: input.frequency,
    interval: input.interval,
    startDate: input.nextDate,
    nextDate: input.nextDate,
    endDate: input.endDate,
    autoIssue: input.autoIssue,
    autoSend: input.autoSend,
    template: buildTemplate(input),
    active: true,
    createdBy: user.id,
  }).$returningId()
  await audit(event, { companyId: company.id, userId: user.id, action: 'recurring.create', entity: 'recurring', entityId: res!.id, data: { kind: input.kind, frequency: input.frequency } })
  return { id: res!.id }
})
