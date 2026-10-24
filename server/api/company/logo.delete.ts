import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  await useDb().update(tables.companies).set({ logoPath: null }).where(eq(tables.companies.id, company.id))
  await deleteStoredFile(company.logoPath)
  await audit(event, { companyId: company.id, userId: user.id, action: 'company.logo.delete' })
  return { ok: true }
})
