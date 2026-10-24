/** Vuelve a buscar coincidencias para los movimientos pendientes (tras crear facturas o gastos) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  rateLimit(`bank-suggest:${company.id}`, 20, 10 * 60_000)
  return { suggested: await suggestMatches(company) }
})
