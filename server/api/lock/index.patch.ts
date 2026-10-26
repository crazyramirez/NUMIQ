import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ mode: z.enum(['always', 'daily', 'off']) })

/** Cuándo pedir la huella, Face ID o el PIN al abrir NUMIQ: siempre, una vez al día o solo al entrar */
export default defineEventHandler(async (event) => {
  const { mode } = await readInput(event, schema)
  const user = await requireUser(event)
  const status = await requireLockStatus(event)
  if (weakerLock(mode, status.mode)) requireRecentVerification(status)
  await useDb().update(tables.users).set({ lockMode: mode }).where(eq(tables.users.id, user.id))
  forgetLockInfo(user.id)
  // Quien lo cambia la está usando ahora (la sesión no está bloqueada): no se le pide al instante
  const now = Date.now()
  await updateSessionLock(event, { at: now, seen: now })
  await audit(event, { userId: user.id, companyId: user.currentCompanyId, action: 'user.lock.mode', data: { mode, from: status.mode } })
  return lockPayload(await requireLockStatus(event))
})
