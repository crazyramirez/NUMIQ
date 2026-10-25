/** Imagen de una firma (PNG). No cambia nunca: se puede guardar en caché */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const row = await findSignature(company.id, idParam(event))
  const data = await readStoredFile(row.path).catch(() => null)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Firma no encontrada' })
  setResponseHeaders(event, {
    'content-type': 'image/png',
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  return data
})
