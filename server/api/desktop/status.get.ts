import { sql } from 'drizzle-orm'

/** Escritorio, primer arranque: sin ninguna cuenta en el equipo, la app abre «Crear cuenta» en vez de «Entrar» */
export default defineEventHandler(async () => {
  if (!isDesktop()) throw createError({ statusCode: 404, statusMessage: 'Solo en NUMIQ de escritorio' })
  const [row] = await useDb().select({ n: sql<number>`count(*)` }).from(tables.users)
  return { hasAccounts: Number(row?.n ?? 0) > 0 }
})
