/** Qué incluiría la copia de seguridad y cuándo se hizo la última */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'admin')
  return backupPreview(company)
})
