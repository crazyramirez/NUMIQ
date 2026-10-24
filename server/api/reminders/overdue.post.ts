/** Recuerda ya el pago de todas las facturas vencidas (salvo las sin email o avisadas hace menos de 4 días) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  if (!mailEnabled()) throw createError({ statusCode: 503, statusMessage: 'El correo no está configurado: añade GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD' })
  rateLimit(`reminders-overdue:${company.id}`, 4, 60 * 60_000, 'Ya has enviado recordatorios hace poco: espera un rato')
  const plan = await overdueReminderPlan(company)
  const r = await sendReminders(company, plan.ready, siteUrl(event), user.id)
  await audit(event, { companyId: company.id, userId: user.id, action: 'reminders.overdue', data: { ...r, noEmail: plan.noEmail, recent: plan.recent } })
  return { ...r, noEmail: plan.noEmail, recent: plan.recent }
})
