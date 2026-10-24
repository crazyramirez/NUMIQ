import { eq, sql } from 'drizzle-orm'

/** Descarga del paquete para el gestor, sin cuenta, con enlace que caduca */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token') ?? ''
  if (!/^[\w-]{20,64}$/.test(token)) throw createError({ statusCode: 404, statusMessage: 'Enlace no válido' })
  const db = useDb()
  const [pack] = await db.select().from(tables.advisorPacks).where(eq(tables.advisorPacks.token, token))
  if (!pack?.path) throw createError({ statusCode: 404, statusMessage: 'Enlace no válido' })
  if (pack.expiresAt < new Date()) throw createError({ statusCode: 410, statusMessage: 'Este enlace ha caducado: pide un envío nuevo' })
  const [company] = await db.select().from(tables.companies).where(eq(tables.companies.id, pack.companyId))
  const data = await readStoredFile(pack.path).catch(() => null)
  if (!data || !company) throw createError({ statusCode: 404, statusMessage: 'Enlace no válido' })
  await db.update(tables.advisorPacks).set({ downloads: sql`${tables.advisorPacks.downloads} + 1` }).where(eq(tables.advisorPacks.id, pack.id))
  const name = packFilename(company, pack.label)
  setResponseHeaders(event, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex',
  })
  return data
})
