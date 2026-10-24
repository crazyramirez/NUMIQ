/** PDF del documento: en línea (vista) o como descarga con ?download=1 */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const { buffer, filename } = await salesPdf(company, idParam(event))
  const download = getQuery(event).download !== undefined
  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    'cache-control': 'no-store',
  })
  return buffer
})
