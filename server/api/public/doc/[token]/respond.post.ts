import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  decision: z.enum(['accept', 'reject']),
  name: z.string().trim().min(2, 'Escribe tu nombre').max(120, 'El nombre es demasiado largo'),
  note: z.string().trim().max(1000, 'El comentario es demasiado largo').optional().transform(v => v || null),
})

const CLOSED: Record<string, string> = {
  accepted: 'Este presupuesto ya está aceptado',
  rejected: 'Este presupuesto ya está rechazado',
  invoiced: 'Este presupuesto ya está facturado',
  cancelled: 'Este presupuesto está anulado',
}

/** El cliente acepta o rechaza el presupuesto desde su enlace, sin cuenta */
export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  rateLimit(`quote-respond:${ip}`, 10, 15 * 60_000)
  const token = getRouterParam(event, 'token') ?? ''
  const input = await readInput(event, schema)
  const { doc, company } = await findPublicDoc(token)
  const state = quoteState(doc)
  if (!state) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
  if (state !== 'open') throw createError({ statusCode: 409, statusMessage: CLOSED[state] ?? 'Este presupuesto ya no admite respuesta' })

  const accepted = input.decision === 'accept'
  const status = accepted ? 'accepted' as const : 'rejected' as const
  const respondedAt = new Date()
  // Solo si sigue pendiente: dos respuestas a la vez no se pisan
  const [res] = await useDb().update(tables.salesDocuments)
    .set({ status, respondedAt, responseName: input.name, responseNote: input.note })
    .where(and(eq(tables.salesDocuments.id, doc.id), inArray(tables.salesDocuments.status, ['issued', 'sent'])))
  if (!res.affectedRows) throw createError({ statusCode: 409, statusMessage: 'Este presupuesto ya no admite respuesta' })

  await audit(event, { companyId: company.id, userId: null, action: `sales.public.${input.decision}`, entity: 'sales_document', entityId: doc.id, data: { name: input.name } })
  notifyQuoteResponse(company, doc, accepted, input.name, input.note, siteUrl(event))
    .catch(err => console.warn('[public-doc] aviso de respuesta', (err as Error).message))
  return { ok: true, state: status, respondedAt, responseName: input.name, responseNote: input.note }
})
