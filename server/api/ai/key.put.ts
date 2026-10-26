import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  key: z.string().trim().max(400).regex(/^sk-[\w-]{20,}$/, 'Pega la clave completa: empieza por «sk-»'),
})

/** Guarda la clave de OpenAI del usuario, cifrada. Antes comprueba con OpenAI que existe */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit(`openai-key:${user.id}`, 10, 15 * 60_000)
  const { key } = await readInput(event, schema)
  await checkAiKey(key)
  const hint = aiKeyHint(key)
  await useDb().update(tables.users).set({ openaiKey: sealAiKey(key), openaiKeyHint: hint, openaiKeyAt: new Date() }).where(eq(tables.users.id, user.id))
  await audit(event, { userId: user.id, action: 'user.openai_key.set', data: { hint } })
  return { ok: true, hint }
})
