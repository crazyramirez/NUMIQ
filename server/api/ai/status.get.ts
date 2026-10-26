import { eq } from 'drizzle-orm'

/** ¿Tiene IA quien pregunta? Su clave (solo el principio y el final) o la del titular de la empresa. Nunca devuelve la clave */
export default defineEventHandler(async (event) => {
  const { user, role } = await requireCompany(event, 'advisor')
  const [row] = await useDb().select({ hint: tables.users.openaiKeyHint, at: tables.users.openaiKeyAt }).from(tables.users).where(eq(tables.users.id, user.id))
  const found = await currentAiKey()
  return {
    configured: !!found,
    source: found?.source ?? null,
    ownerName: found?.ownerName ?? null,
    own: row?.hint ? { hint: row.hint, savedAt: row.at } : null,
    /** La clave del titular la usan también los miembros del equipo que no tienen la suya */
    owner: role === 'owner',
  }
})
