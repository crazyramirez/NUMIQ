/** Firmas guardadas de la empresa (la predeterminada primero) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  return (await listSignatures(company.id)).map(signatureView)
})
