import { and, eq } from 'drizzle-orm'

/** Descarga un archivo de la empresa. Solo PDF e imágenes se abren en el navegador. */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const [file] = await useDb().select().from(tables.files)
    .where(and(eq(tables.files.id, id), eq(tables.files.companyId, company.id)))
  if (!file) throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })
  const data = await readStoredFile(file.path).catch(() => null)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })

  const viewable = /^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.mime)
  const inline = viewable && getQuery(event).download === undefined
  setResponseHeaders(event, {
    'content-type': file.mime,
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.originalName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    'cache-control': 'private, no-store',
    'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox',
    'x-content-type-options': 'nosniff',
  })
  return data
})
