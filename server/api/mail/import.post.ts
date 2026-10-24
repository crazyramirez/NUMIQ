import { and, eq, inArray, or } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ ids: z.array(z.number().int().positive()).min(1, 'Elige al menos un correo').max(100) })

/** Importa con IA los adjuntos de los correos elegidos */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event)
  if (!aiEnabled()) throw createError({ statusCode: 503, statusMessage: 'La IA no está configurada: añade NUXT_OPENAI_API_KEY en el .env' })
  const { ids } = await readInput(event, schema)
  // Solo correos que este usuario puede ver
  const m = tables.mailMessages
  const allowed = await useDb().select({ id: m.id }).from(m).where(and(
    eq(m.companyId, company.id),
    inArray(m.id, ids),
    canReadWholeInbox(user, role) ? undefined : or(eq(m.addressed, true)),
  ))
  if (!allowed.length) throw createError({ statusCode: 404, statusMessage: 'No se encontraron los correos' })
  const result = await importMessages(company, user.id, allowed.map(a => a.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'mail.import', entity: 'import_batch', entityId: result.batchId, data: { messages: allowed.length } })
  return result
})
