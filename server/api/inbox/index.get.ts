/** Bandeja de entrada: correos con facturas, importaciones por confirmar y gastos por revisar */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event)
  return inboxFeed(company, user, role)
})
