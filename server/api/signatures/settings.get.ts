/** Firma por defecto en facturas y presupuestos (Ajustes → Firmas) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return signingSettings(company)
})
