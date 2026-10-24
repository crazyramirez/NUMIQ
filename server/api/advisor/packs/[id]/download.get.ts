import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const [pack] = await useDb().select().from(tables.advisorPacks).where(and(eq(tables.advisorPacks.id, id), eq(tables.advisorPacks.companyId, company.id)))
  if (!pack?.path) throw createError({ statusCode: 404, statusMessage: 'El paquete ya no está disponible' })
  const data = await readStoredFile(pack.path).catch(() => null)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'El paquete ya no está disponible' })
  const name = packFilename(company, pack.label)
  setResponseHeaders(event, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'cache-control': 'private, no-store',
  })
  return data
})
