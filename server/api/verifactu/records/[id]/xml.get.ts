/** XML del registro VeriFactu (enviado o pendiente) para revisarlo o archivarlo */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const xml = await recordXml(company, id)
  setResponseHeaders(event, {
    'content-type': 'application/xml; charset=utf-8',
    'content-disposition': `attachment; filename="verifactu-registro-${id}.xml"`,
    'cache-control': 'private, no-store',
  })
  return xml
})
