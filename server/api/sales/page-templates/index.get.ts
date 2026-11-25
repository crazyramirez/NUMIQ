/** Plantillas de página para insertar en facturas y presupuestos */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return pageTemplatesOf(company)
})
