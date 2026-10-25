/** Firma que lleva el documento, para su vista pública (solo si el documento va firmado) */
export default defineEventHandler(async (event) => {
  const { doc, company } = await findPublicDoc(getRouterParam(event, 'token') ?? '')
  const { signature } = await documentSignature(company.id, signingSettings(company), doc)
  const row = signature ? await findSignature(company.id, signature.id).catch(() => null) : null
  const data = row ? await readStoredFile(row.path).catch(() => null) : null
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Sin firma' })
  setResponseHeaders(event, {
    'content-type': 'image/png',
    'cache-control': 'private, max-age=600',
    'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox',
    'x-content-type-options': 'nosniff',
  })
  return data
})
