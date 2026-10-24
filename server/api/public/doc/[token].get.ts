/**
 * PDF público de un documento emitido, para el enlace de los correos y la página /p/:token.
 * El token es aleatorio (24 bytes) y solo sirve en documentos emitidos; los borradores nunca son accesibles.
 */
export default defineEventHandler(async (event) => {
  const { doc, company } = await findPublicDoc(getRouterParam(event, 'token') ?? '')
  const { buffer, filename } = await salesPdf(company, doc.id)
  const download = getQuery(event).download !== undefined
  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex',
  })
  return buffer
})
