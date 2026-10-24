import { eq } from 'drizzle-orm'

/** Activa o ajusta los recordatorios automáticos de cobro */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, reminderSettingsSchema)
  if (input.enabled && !mailEnabled()) throw createError({ statusCode: 503, statusMessage: 'El correo no está configurado: añade GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD' })
  const settings = { ...(company.settings ?? {}), reminders: input }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'reminders.settings', data: { enabled: input.enabled, days: input.days } })
  return { settings: input }
})
