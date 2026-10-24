import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

const OFFICE: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip',
}

/**
 * Tipo de un documento adjunto por su contenido (la extensión solo desambigua los formatos que
 * comparten firma, como los de Office). Null = no admitido.
 */
export function detectDocument(data: Buffer, name: string): { ext: string, mime: string } | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b)
  if (starts(0x25, 0x50, 0x44, 0x46)) return { ext: 'pdf', mime: 'application/pdf' }
  const image = detectImage(data)
  if (image && image.ext !== 'svg') return image
  if (data.length > 12 && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' }
  if (starts(0x50, 0x4B, 0x03, 0x04)) return { ext: OFFICE[ext] ? ext : 'zip', mime: OFFICE[ext] ?? OFFICE.zip! }
  if (starts(0xD0, 0xCF, 0x11, 0xE0)) {
    if (ext === 'xls') return { ext, mime: 'application/vnd.ms-excel' }
    return { ext: 'doc', mime: 'application/msword' }
  }
  // Texto plano / CSV: sin bytes nulos en el principio
  if (['csv', 'txt'].includes(ext) && !data.subarray(0, 4096).includes(0)) return { ext, mime: ext === 'csv' ? 'text/csv' : 'text/plain' }
  return null
}

/** Nombre seguro para guardar y para la cabecera Content-Disposition */
export function safeFilename(name: string) {
  return name.normalize('NFC').replace(/[\\/:*?\x22<>|\x00-\x1F]+/g, '_').trim().slice(0, 180) || 'archivo'
}

export async function saveAttachment(companyId: number, userId: number, file: { filename?: string, data: Buffer }, link: { type: 'sales_document' | 'expense', id: number }) {
  const originalName = safeFilename(file.filename ?? 'archivo')
  if (file.data.length > MAX_ATTACHMENT_BYTES) throw createError({ statusCode: 413, statusMessage: `${originalName} supera 10 MB` })
  const kind = detectDocument(file.data, originalName)
  if (!kind) throw createError({ statusCode: 415, statusMessage: `${originalName}: formato no admitido (PDF, imagen, Word, Excel, CSV o ZIP)` })
  const path = await saveCompanyFile(companyId, 'attachments', file.data, kind.ext)
  const [res] = await useDb().insert(tables.files).values({
    companyId,
    kind: 'attachment',
    originalName,
    mime: kind.mime,
    size: file.data.length,
    path,
    sha256: createHash('sha256').update(file.data).digest('hex'),
    linkedType: link.type,
    linkedId: link.id,
    uploadedBy: userId,
  }).$returningId()
  return res!.id
}

export function listAttachments(companyId: number, type: 'sales_document' | 'expense', id: number) {
  const f = tables.files
  return useDb().select({ id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, createdAt: f.createdAt })
    .from(f)
    .where(and(eq(f.companyId, companyId), eq(f.kind, 'attachment'), eq(f.linkedType, type), eq(f.linkedId, id)))
    .orderBy(desc(f.id))
}
