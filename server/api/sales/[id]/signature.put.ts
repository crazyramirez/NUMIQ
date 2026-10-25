import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  /** null = lo que diga Ajustes para su tipo */
  sign: z.boolean().nullable(),
  signatureId: z.number().int().positive().nullable(),
})

/**
 * Firma de un documento, en cualquier estado: es solo cómo se ve (no cambia importes ni datos fiscales),
 * así que también se pone o se quita en una factura emitida.
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, schema)
  if (input.signatureId) await findSignature(company.id, input.signatureId)
  const s = tables.salesDocuments
  const res = await useDb().update(s).set({ sign: input.sign, signatureId: input.signatureId })
    .where(and(eq(s.id, id), eq(s.companyId, company.id)))
  if (!res[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.signature', entity: 'sales_document', entityId: id, data: input })
  return { ok: true }
})
