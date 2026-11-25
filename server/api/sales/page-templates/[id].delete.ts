/** Borra una plantilla de página (los documentos que ya la usan no cambian) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = getRouterParam(event, 'id') ?? ''
  const list = pageTemplatesOf(company)
  const next = list.filter(t => t.id !== id)
  if (next.length === list.length) throw createError({ statusCode: 404, statusMessage: 'Plantilla no encontrada' })
  await savePageTemplates(company, next)
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.page_template_delete', data: { id } })
  return next
})
