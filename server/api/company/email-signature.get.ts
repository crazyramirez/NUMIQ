export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  if (!company.emailSignaturePath) throw createError({ statusCode: 404, statusMessage: 'Sin imagen de firma' })
  const data = await readStoredFile(company.emailSignaturePath).catch(() => null)
  const kind = data && detectImage(data)
  if (!data || !kind) throw createError({ statusCode: 404, statusMessage: 'Sin imagen de firma' })
  setResponseHeaders(event, {
    'content-type': kind.mime,
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  return data
})
