import { eq } from 'drizzle-orm'

/** Guarda los datos del gestor o asesoría de la empresa */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const advisor = await readInput(event, advisorSchema)
  const settings = { ...(company.settings ?? {}), advisor }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'advisor.update' })
  return { advisor: advisorOf({ settings }) }
})
