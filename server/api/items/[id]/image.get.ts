import { and, eq } from 'drizzle-orm'

/** Imagen del producto (la URL lleva versión: se puede cachear sin caducidad) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const [item] = await useDb().select({ imagePath: tables.items.imagePath }).from(tables.items)
    .where(and(eq(tables.items.id, id), eq(tables.items.companyId, company.id)))
  if (!item?.imagePath) throw createError({ statusCode: 404, statusMessage: 'Sin imagen' })
  const data = await readStoredFile(item.imagePath).catch(() => null)
  const kind = data && detectImage(data)
  if (!data || !kind) throw createError({ statusCode: 404, statusMessage: 'Sin imagen' })
  setResponseHeaders(event, {
    'content-type': kind.mime,
    'cache-control': 'private, max-age=31536000, immutable',
    'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox',
    'x-content-type-options': 'nosniff',
  })
  return data
})
