export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return loadSalesDocument(company.id, idParam(event))
})
