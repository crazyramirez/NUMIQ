/** Contador de Documentos para el menú: importaciones que esperan confirmación */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return inboxCount(company)
})
