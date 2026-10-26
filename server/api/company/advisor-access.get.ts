/** Qué puede subir el gestor a la empresa */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return advisorAccess(company)
})
