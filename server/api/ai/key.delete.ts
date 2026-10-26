import { eq } from 'drizzle-orm'

/** Quita la clave de OpenAI del usuario */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await useDb().update(tables.users).set({ openaiKey: null, openaiKeyHint: null, openaiKeyAt: null }).where(eq(tables.users.id, user.id))
  await audit(event, { userId: user.id, action: 'user.openai_key.remove' })
  return { ok: true }
})
