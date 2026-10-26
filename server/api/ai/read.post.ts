/** Escaneo rápido: lee una factura o ticket (foto, PDF o Word) y devuelve los datos para revisarlos */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  await requireAi()
  const parts = (await readMultipartFormData(event)) ?? []
  const file = parts.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Elige una foto o un documento' })
  const raw = parts.find(p => p.name === 'direction')?.data.toString('utf8')
  const direction = raw === 'issued' || raw === 'received' ? raw : 'auto'
  const lastModified = parts.find(p => p.name === 'lastModified')?.data.toString('utf8')
  const result = await readSingleDocument(company, user.id, { filename: file.filename || 'documento', data: file.data, lastModified }, direction)
  await audit(event, { companyId: company.id, userId: user.id, action: 'ai.read', entity: 'file', entityId: result.fileId })
  return result
})
