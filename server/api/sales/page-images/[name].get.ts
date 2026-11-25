/** Imagen de una página adicional, para el editor y la vista del documento */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const img = await readPageImage(company.id, getRouterParam(event, 'name') ?? '')
  if (!img) throw createError({ statusCode: 404, statusMessage: 'Imagen no encontrada' })
  setResponseHeaders(event, {
    'content-type': img.kind.mime,
    // El nombre es único y nunca cambia de contenido
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  return img.data
})
