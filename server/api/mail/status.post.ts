import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(300),
  status: z.enum(['new', 'ignored']),
})

/** Ignora correos de la bandeja (o los recupera) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const { ids, status } = await readInput(event, schema)
  const m = tables.mailMessages
  await useDb().update(m).set({ status }).where(and(eq(m.companyId, company.id), inArray(m.id, ids), inArray(m.status, ['new', 'ignored'])))
  return { ok: true }
})
