import { and, eq } from 'drizzle-orm'

/** Logotipo del contacto (la URL lleva versión: se puede cachear sin caducidad) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const [contact] = await useDb().select({ logoPath: tables.contacts.logoPath }).from(tables.contacts)
    .where(and(eq(tables.contacts.id, id), eq(tables.contacts.companyId, company.id)))
  if (!contact?.logoPath) throw createError({ statusCode: 404, statusMessage: 'Sin logotipo' })
  const data = await readStoredFile(contact.logoPath).catch(() => null)
  const kind = data && detectImage(data)
  if (!data || !kind) throw createError({ statusCode: 404, statusMessage: 'Sin logotipo' })
  setResponseHeaders(event, {
    'content-type': kind.mime,
    'cache-control': 'private, max-age=31536000, immutable',
    'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox',
    'x-content-type-options': 'nosniff',
  })
  return data
})
