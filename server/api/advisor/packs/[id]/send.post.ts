import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const emailList = z.string().trim().max(500).transform(s => s.split(/[,;\s]+/).filter(Boolean))
  .pipe(z.array(z.email('Hay un email no válido')).max(5, 'Máximo 5 destinatarios'))

const schema = z.object({
  to: emailList.pipe(z.array(z.string()).min(1, 'Indica el email de tu gestor')),
  cc: z.string().trim().max(500).optional().transform(s => (s ? s.split(/[,;\s]+/).filter(Boolean) : [])).pipe(z.array(z.email('Hay un email en copia no válido')).max(5)),
  subject: z.string().trim().min(1, 'Escribe un asunto').max(200),
  message: z.string().trim().min(1, 'Escribe un mensaje').max(5000),
})

/** Envía el paquete al gestor por correo (adjunto si cabe y siempre con enlace de descarga) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, schema)
  if (!mailEnabled()) throw createError({ statusCode: 503, statusMessage: 'El correo no está configurado: añade GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD' })
  const [pack] = await useDb().select().from(tables.advisorPacks).where(and(eq(tables.advisorPacks.id, id), eq(tables.advisorPacks.companyId, company.id)))
  if (!pack?.path) throw createError({ statusCode: 404, statusMessage: 'El paquete ya no está disponible: prepáralo de nuevo' })
  if (pack.expiresAt < new Date()) throw createError({ statusCode: 410, statusMessage: 'El enlace de este paquete ha caducado: prepáralo de nuevo' })
  const site = (useRuntimeConfig().siteUrl || getRequestURL(event, { xForwardedProto: true }).origin).replace(/\/+$/, '')
  const result = await sendPack(company, user, pack, { ...input, site })
  await audit(event, { companyId: company.id, userId: user.id, action: 'advisor.send', entity: 'advisor_pack', entityId: id, data: { to: input.to, attached: result.attached } })
  return { ok: true, ...result }
})
