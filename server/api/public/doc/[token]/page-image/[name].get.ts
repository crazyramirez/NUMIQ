/** Imagen de una página adicional en la vista pública: solo las que lleva ese documento */
export default defineEventHandler(async (event) => {
  const { doc, company } = await findPublicDoc(getRouterParam(event, 'token') ?? '')
  const name = getRouterParam(event, 'name') ?? ''
  const img = pageImages(doc.extraPages).includes(name) ? await readPageImage(company.id, name) : null
  if (!img) throw createError({ statusCode: 404, statusMessage: 'Imagen no encontrada' })
  setResponseHeaders(event, {
    'content-type': img.kind.mime,
    'cache-control': 'private, max-age=600',
    'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex',
  })
  return img.data
})
