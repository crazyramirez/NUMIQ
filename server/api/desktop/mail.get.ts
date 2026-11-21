/** Cuenta de correo de envío de la app de escritorio (Ajustes → Correo). Nunca devuelve la contraseña. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  if (!isDesktop()) throw createError({ statusCode: 404, statusMessage: 'Solo en NUMIQ de escritorio' })
  const m = desktopSettings().mail
  return {
    configured: mailEnabled(),
    user: m?.user ?? '',
    smtpHost: m?.smtpHost || 'smtp.gmail.com',
    smtpPort: m?.smtpPort || 465,
    fromName: m?.fromName ?? '',
    hasPassword: !!m?.password,
  }
})
