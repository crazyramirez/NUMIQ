/** Descarga la copia completa de la empresa (ZIP con Excel, JSON, PDF y documentos originales) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  rateLimit(`backup:${company.id}`, 6, 10 * 60_000, 'Ya has descargado varias copias: espera unos minutos')
  const q = getQuery(event)
  const opts = { pdfs: q.pdfs !== '0', originals: q.originals !== '0' }
  const { zip, filename, counts } = await buildBackup(company, opts)
  await audit(event, { companyId: company.id, userId: user.id, action: 'backup.download', data: { ...counts, size: zip.length } })
  setResponseHeaders(event, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'content-length': zip.length,
    'cache-control': 'private, no-store',
  })
  return zip
})
