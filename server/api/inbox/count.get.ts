/** Contador de la bandeja para el menú: cuántas cosas esperan una decisión */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event, 'advisor')
  return inboxCount(company, user, role)
})
