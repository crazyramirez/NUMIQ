import { z } from 'zod'

/** ¿Hay correo configurado? Con ?verify=1 prueba la conexión SMTP. Nunca devuelve credenciales. */
export default defineEventHandler(async (event) => {
  await requireCompany(event, 'admin')
  const { verify } = readQueryInput(event, z.object({ verify: z.coerce.boolean().default(false) }))
  const c = mailConfig()
  const configured = mailEnabled()
  return {
    configured,
    account: configured ? c.user.replace(/^(.{2}).*(@.*)$/, '$1•••$2') : null,
    check: verify ? await verifyMail() : null,
  }
})
