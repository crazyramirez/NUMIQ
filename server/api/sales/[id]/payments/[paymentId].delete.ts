export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const paymentId = idParam(event, 'paymentId')
  const result = await changeSalesPayments(company.id, id, { action: 'remove', paymentId })
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.payment.delete', entity: 'sales_document', entityId: id, data: result })
  return { ok: true }
})
