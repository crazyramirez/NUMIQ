import { z } from 'zod'

const schema = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
})

/** Activa los avisos en este dispositivo (si ya estaba, lo pasa al usuario actual) */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = await readInput(event, schema)
  const values = { userId: user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, device: deviceName(event) }
  await useDb().insert(tables.pushSubscriptions).values(values)
    .onDuplicateKeyUpdate({ set: { userId: values.userId, p256dh: values.p256dh, auth: values.auth, device: values.device } })
  await audit(event, { userId: user.id, companyId: user.currentCompanyId, action: 'push.subscribe' })
  return { ok: true }
})
