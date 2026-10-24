/** Formas de cobro online de la empresa (enlace de pago y Bizum) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return onlinePaymentsOf(company)
})
