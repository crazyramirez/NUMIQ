import { eq } from 'drizzle-orm'

/** Cambia lo que el gestor puede subir (nóminas, impuestos, extractos, resto del archivo) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, advisorAccessSchema)
  const settings = { ...(company.settings ?? {}), advisorAccess: input }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'advisor.access', data: input })
  return advisorAccess({ settings })
})
