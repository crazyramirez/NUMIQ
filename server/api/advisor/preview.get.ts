/** Qué irá en el envío del periodo: facturas, gastos, documentos y tamaño aproximado */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const q = readQueryInput(event, packPeriodSchema)
  return packPreview(company, packPeriod(q))
})
