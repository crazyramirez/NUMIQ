import { buildFullClone } from '../../utils/clone'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  rateLimit(`clone:${company.id}`, 4, 10 * 60_000, 'Ya has solicitado varias clonaciones: espera unos minutos')

  const { zip, filename, stats } = await buildFullClone()

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'backup.clone',
    data: { ...stats, size: zip.length },
  })

  setResponseHeaders(event, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'content-length': zip.length,
    'cache-control': 'private, no-store',
  })

  return zip
})
