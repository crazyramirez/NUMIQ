/** Envía ya los recordatorios que tocan, sin esperar al horario automático */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  if (!mailEnabled()) throw createError({ statusCode: 503, statusMessage: 'El correo no está configurado: añade GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD' })
  rateLimit(`reminders-send:${company.id}`, 6, 60 * 60_000, 'Ya has enviado recordatorios hace poco: espera un rato')
  const r = await sendDueReminders(company, siteUrl(event), { userId: user.id })
  await audit(event, { companyId: company.id, userId: user.id, action: 'reminders.send', data: r })
  return r
})
