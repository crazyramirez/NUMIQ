/** Facturas o gastos con los que conciliar a mano un movimiento */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const q = String(getQuery(event).q ?? '').slice(0, 100)
  return { items: await matchCandidates(company, idParam(event), q) }
})
