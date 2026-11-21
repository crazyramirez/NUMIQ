import { z } from 'zod'

const schema = z.object({
  user: z.string().trim().max(200),
  // Vacía: se queda la que ya había (el formulario nunca la recibe de vuelta)
  password: z.string().max(200).default(''),
  smtpHost: z.string().trim().max(200).regex(/^[\w.-]*$/, 'Servidor SMTP no válido').default(''),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(465),
  fromName: z.string().trim().max(120).default(''),
})

/**
 * Guarda la cuenta de envío del escritorio (Gmail con contraseña de aplicación u otro SMTP) y la prueba
 * contra el servidor. Con el email vacío se quita la cuenta.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  if (!isDesktop()) throw createError({ statusCode: 404, statusMessage: 'Solo en NUMIQ de escritorio' })
  const input = await readInput(event, schema)
  if (!input.user) {
    saveDesktopSettings({ mail: null })
    return { configured: false, check: null }
  }
  if (!z.email().safeParse(input.user).success) throw createError({ statusCode: 400, statusMessage: 'Escribe un email válido', data: { field: 'user' } })
  const prev = desktopSettings().mail
  const password = input.password.trim() ? sealDesktopSecret(input.password.replace(/\s/g, '')) : (prev?.user === input.user ? prev.password : '')
  if (!password) throw createError({ statusCode: 400, statusMessage: 'Escribe la contraseña de aplicación', data: { field: 'password' } })
  saveDesktopSettings({
    mail: { user: input.user, password, smtpHost: input.smtpHost || 'smtp.gmail.com', smtpPort: input.smtpPort, fromName: input.fromName },
  })
  return { configured: mailEnabled(), check: await verifyMail() }
})
