/** Deshace la conciliación o el «ignorar» de un movimiento */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  await unmatch(company, id)
  await audit(event, { companyId: company.id, userId: user.id, action: 'bank.unmatch', entity: 'bank_transaction', entityId: id })
  return { ok: true }
})
