import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, companyPatchSchema)
  if (!Object.keys(input).length) return { ok: true }
  await useDb().update(tables.companies).set(input).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'company.update', data: { fields: Object.keys(input) } })
  return { ok: true }
})
