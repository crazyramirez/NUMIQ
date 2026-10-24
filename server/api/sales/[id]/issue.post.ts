export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const number = await issueSalesDocument(company.id, id)
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.issue', entity: 'sales_document', entityId: id, data: { number } })
  return { number }
})
