/** ¿Hay que aprobar los gastos del equipo? */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return approvalSettings(company)
})
