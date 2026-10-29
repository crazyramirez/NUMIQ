import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  await useDb().update(tables.companies).set({ emailSignaturePath: null }).where(eq(tables.companies.id, company.id))
  await deleteStoredFile(company.emailSignaturePath)
  await audit(event, { companyId: company.id, userId: user.id, action: 'company.email_signature.delete' })
  return { ok: true }
})
