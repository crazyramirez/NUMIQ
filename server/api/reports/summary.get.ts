/** Informe del periodo: cuenta de resultados, IVA, IRPF, rankings y cobros pendientes */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const q = readQueryInput(event, reportQuerySchema)
  return buildReport(company, resolveReportPeriod(q.year, q.quarter, q.month))
})
