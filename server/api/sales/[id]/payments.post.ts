export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, salesPaymentSchema)
  const result = await changeSalesPayments(company.id, id, { action: 'save', input })
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.payment', entity: 'sales_document', entityId: id, data: { ...result, input } })
  return { ok: true }
})
