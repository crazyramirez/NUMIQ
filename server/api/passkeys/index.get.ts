import { desc, eq } from 'drizzle-orm'

/** Llaves de acceso del usuario (sin la clave pública: solo para verlas y quitarlas) */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const p = tables.userPasskeys
  return useDb().select({ id: p.id, name: p.name, backedUp: p.backedUp, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })
    .from(p).where(eq(p.userId, user.id)).orderBy(desc(p.createdAt))
})
