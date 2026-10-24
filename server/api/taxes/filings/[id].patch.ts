import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ status: z.enum(['filed', 'paid']) })

/** Marca un modelo presentado como pagado (o lo devuelve a «presentado») */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const { status } = await readInput(event, schema)
  const f = tables.taxFilings
  const r = await useDb().update(f).set({ status }).where(and(eq(f.id, id), eq(f.companyId, company.id)))
  if (!r[0].affectedRows) throw createError({ statusCode: 404, statusMessage: 'Presentación no encontrada' })
  await audit(event, { companyId: company.id, userId: user.id, action: `tax.${status}`, entity: 'tax_filing', entityId: id })
  return { ok: true }
})
