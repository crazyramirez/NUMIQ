import { createHash } from 'node:crypto'
import { and, eq, like } from 'drizzle-orm'

const MAX_SIGNED_BYTES = 30 * 1024 * 1024

/**
 * Copia firmada de un documento (las firmas se estampan en el navegador desde el visor). Se guarda junto
 * al original, en el mismo sitio: adjunta a la misma factura o gasto, o en la misma carpeta del archivo.
 * El original no se toca. Firmar otra vez una copia firmada la actualiza en lugar de crear otra.
 */
const SIGNED_NOTE = 'Copia firmada'

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const db = useDb()
  const [src] = await db.select().from(tables.files).where(and(eq(tables.files.id, id), eq(tables.files.companyId, company.id)))
  if (!src) throw createError({ statusCode: 404, statusMessage: 'Archivo no encontrado' })

  const part = (await readMultipartFormData(event))?.find(p => p.name === 'file' && p.data?.length)
  if (!part) throw createError({ statusCode: 400, statusMessage: 'Falta el documento firmado' })
  if (part.data.length > MAX_SIGNED_BYTES) throw createError({ statusCode: 413, statusMessage: 'El documento firmado supera 30 MB' })
  const type = detectDocument(part.data, part.filename ?? '')
  if (!type || !/^(application\/pdf|image\/(png|jpeg|webp))$/.test(type.mime)) throw createError({ statusCode: 415, statusMessage: 'El documento firmado debe ser un PDF o una imagen' })

  const base = src.originalName.replace(/\.[^.]+$/, '').replace(/\s*\(firmado(?: \d+)?\)$/i, '')
  const path = await saveCompanyFile(company.id, src.kind === 'vault' ? 'vault' : 'attachments', part.data, type.ext)
  const sha256 = createHash('sha256').update(part.data).digest('hex')

  // Firmar de nuevo una copia firmada: se actualiza esa misma copia
  if (src.notes === SIGNED_NOTE) {
    const name = safeFilename(`${src.originalName.replace(/\.[^.]+$/, '')}.${type.ext}`)
    await db.update(tables.files).set({ originalName: name, mime: type.mime, size: part.data.length, path, sha256 }).where(eq(tables.files.id, src.id))
    await deleteStoredFile(src.path)
    await audit(event, { companyId: company.id, userId: user.id, action: 'file.sign', entity: src.linkedType ?? 'file', entityId: src.linkedId ?? id, data: { file: id, name, updated: true } })
    return { id: src.id, originalName: name, mime: type.mime, size: part.data.length, createdAt: src.createdAt, updated: true }
  }

  // Varias copias firmadas del mismo original: «(firmado)», «(firmado 2)»…
  const siblings = await db.select({ name: tables.files.originalName }).from(tables.files).where(and(
    eq(tables.files.companyId, company.id),
    eq(tables.files.notes, SIGNED_NOTE),
    like(tables.files.originalName, `${base.replace(/[\\%_]/g, m => `\\${m}`)} (firmado%`),
  ))
  const taken = new Set(siblings.map(f => f.name.replace(/\.[^.]+$/, '').toLowerCase()))
  let label = `${base} (firmado)`
  for (let n = 2; taken.has(label.toLowerCase()); n++) label = `${base} (firmado ${n})`
  const originalName = safeFilename(`${label}.${type.ext}`)
  // Los originales de una factura o un gasto (escaneado, importado) pasan a ser un adjunto más del documento
  const kind = (src.kind === 'scan' || src.kind === 'import') && src.linkedId ? 'attachment' : src.kind
  const [res] = await db.insert(tables.files).values({
    companyId: company.id,
    kind,
    originalName,
    mime: type.mime,
    size: part.data.length,
    path,
    sha256,
    year: src.year,
    quarter: src.quarter,
    folder: src.folder,
    notes: SIGNED_NOTE,
    linkedType: src.linkedType,
    linkedId: src.linkedId,
    uploadedBy: user.id,
  }).$returningId()
  const [file] = await db.select().from(tables.files).where(eq(tables.files.id, res!.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'file.sign', entity: src.linkedType ?? 'file', entityId: src.linkedId ?? id, data: { from: id, file: file!.id, name: originalName } })
  return { id: file!.id, originalName: file!.originalName, mime: file!.mime, size: file!.size, createdAt: file!.createdAt, updated: false }
})
