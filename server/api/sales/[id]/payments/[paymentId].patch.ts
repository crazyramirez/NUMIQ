export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const paymentId = idParam(event, 'paymentId')
  const input = await readInput(event, salesPaymentSchema.required({ amount: true, date: true }))
  const result = await changeSalesPayments(company.id, id, { action: 'save', paymentId, input })
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.payment.edit', entity: 'sales_document', entityId: id, data: { ...result, input } })
  return { ok: true }
})
