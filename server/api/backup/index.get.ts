/** Qué incluiría la copia de seguridad y cuándo se hizo la última */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  return { ...await backupPreview(company), canClone: isServerAdmin(user) }
})
