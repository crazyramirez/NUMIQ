/** Logo de la empresa para la vista pública de un documento */
export default defineEventHandler(async (event) => {
  const { company } = await findPublicDoc(getRouterParam(event, 'token') ?? '')
  if (!company.logoPath) throw createError({ statusCode: 404, statusMessage: 'Sin logo' })
  const data = await readStoredFile(company.logoPath).catch(() => null)
  const kind = data && detectImage(data)
  if (!data || !kind) throw createError({ statusCode: 404, statusMessage: 'Sin logo' })
  setResponseHeaders(event, {
    'content-type': kind.mime,
    'cache-control': 'private, max-age=3600',
    'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox',
    'x-content-type-options': 'nosniff',
  })
  return data
})
