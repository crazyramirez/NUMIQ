import { eq } from 'drizzle-orm'

/** Activa o desactiva la aprobación de gastos del equipo */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, approvalSettingsSchema)
  const settings = { ...(company.settings ?? {}), approvals: input }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'approvals.settings', data: input })
  return approvalSettings({ settings })
})
