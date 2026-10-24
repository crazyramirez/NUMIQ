/**
 * Sube una tanda de archivos al lote. Cada archivo va en un campo "files" y su ruta relativa
 * (carpetas arrastradas o seleccionadas) en "paths", en el mismo orden.
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const batch = await getBatch(company.id, id)
  if (batch.status === 'done') throw createError({ statusCode: 409, statusMessage: 'Esta importación ya está terminada' })
  const parts = (await readMultipartFormData(event)) ?? []
  const files = parts.filter(p => p.name === 'files' && p.filename && p.data?.length)
  if (!files.length) throw createError({ statusCode: 400, statusMessage: 'Elige al menos un archivo' })
  let paths: string[] = []
  try {
    const raw = parts.find(p => p.name === 'paths')?.data.toString('utf8')
    paths = raw ? JSON.parse(raw) : []
  }
  catch {
    paths = []
  }
  const result: AddedFiles = { added: 0, skipped: [] }
  let lastModified: unknown[] = []
  try {
    const raw = parts.find(p => p.name === 'lastModified')?.data.toString('utf8')
    const parsed = raw ? JSON.parse(raw) : []
    lastModified = Array.isArray(parsed) ? parsed : []
  }
  catch { /* Clientes antiguos o metadatos ausentes: se leen del propio archivo. */ }
  for (const [i, f] of files.entries()) {
    const r = await addBatchFile(company.id, user.id, id, { filename: f.filename!, data: f.data, sourcePath: typeof paths?.[i] === 'string' ? paths[i] : f.filename, lastModified: lastModified[i] })
    result.added += r.added
    result.skipped.push(...r.skipped)
  }
  return result
})
