import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Quita los avisos de este dispositivo */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { endpoint } = await readInput(event, z.object({ endpoint: z.string().url().max(600) }))
  await useDb().delete(tables.pushSubscriptions)
    .where(and(eq(tables.pushSubscriptions.userId, user.id), eq(tables.pushSubscriptions.endpoint, endpoint)))
  return { ok: true }
})
