/** Presupuesto o proforma → borrador de factura con las mismas líneas */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const newId = await quoteToInvoice(company, user.id, id)
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.convert', entity: 'sales_document', entityId: newId, data: { from: id } })
  return { id: newId }
})
