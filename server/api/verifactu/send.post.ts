/** Envía ya a la AEAT los registros de facturación pendientes */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  if (!company.verifactuEnabled) throw createError({ statusCode: 409, statusMessage: 'VeriFactu está desactivado para esta empresa' })
  const result = await sendPendingRecords(company)
  await audit(event, { companyId: company.id, userId: user.id, action: 'verifactu.send', data: { ...result, environment: verifactuSettings(company).environment } })
  return result
})
