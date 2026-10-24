export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  if (!company.logoPath) throw createError({ statusCode: 404, statusMessage: 'Sin logo' })
  const data = await readStoredFile(company.logoPath).catch(() => null)
  const kind = data && detectImage(data)
  if (!data || !kind) throw createError({ statusCode: 404, statusMessage: 'Sin logo' })
  setResponseHeaders(event, {
    'content-type': kind.mime,
    'cache-control': 'private, max-age=31536000, immutable',
    // Un SVG abierto directamente no puede ejecutar nada en nuestro dominio
    'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox',
    'x-content-type-options': 'nosniff',
  })
  return data
})
