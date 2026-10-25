import { and, asc, desc, eq } from 'drizzle-orm'

export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024
const MAX_SIGNATURES = 20

/** Ancho y alto de un PNG (cabecera IHDR) */
function pngSize(data: Buffer) {
  if (data.length < 24 || detectImage(data)?.ext !== 'png' || data.subarray(12, 16).toString('latin1') !== 'IHDR') return null
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

export function signatureView(s: typeof tables.signatures.$inferSelect) {
  return { id: s.id, name: s.name, kind: s.kind, width: s.width, height: s.height, isDefault: s.isDefault, createdAt: s.createdAt, url: `/api/signatures/${s.id}` }
}

export function listSignatures(companyId: number) {
  const s = tables.signatures
  return useDb().select().from(s).where(eq(s.companyId, companyId)).orderBy(desc(s.isDefault), asc(s.createdAt), asc(s.id))
}

/** Guarda una firma nueva (PNG transparente que prepara el navegador). La primera queda como predeterminada */
export async function createSignature(companyId: number, userId: number, input: { name: string, kind: 'drawn' | 'typed' | 'image', data: Buffer }) {
  if (input.data.length > MAX_SIGNATURE_BYTES) throw createError({ statusCode: 413, statusMessage: 'La firma supera 2 MB' })
  const size = pngSize(input.data)
  if (!size) throw createError({ statusCode: 415, statusMessage: 'La firma debe ser una imagen PNG' })
  if (size.width < 8 || size.height < 8 || size.width > 4000 || size.height > 4000) throw createError({ statusCode: 400, statusMessage: 'Tamaño de firma no válido' })

  const db = useDb()
  const existing = await listSignatures(companyId)
  if (existing.length >= MAX_SIGNATURES) throw createError({ statusCode: 409, statusMessage: `Máximo ${MAX_SIGNATURES} firmas: borra alguna que ya no uses` })
  const path = await saveCompanyFile(companyId, 'signatures', input.data, 'png')
  const [res] = await db.insert(tables.signatures).values({
    companyId,
    name: input.name,
    kind: input.kind,
    path,
    width: size.width,
    height: size.height,
    isDefault: existing.length === 0,
    createdBy: userId,
  }).$returningId()
  const [row] = await db.select().from(tables.signatures).where(eq(tables.signatures.id, res!.id))
  return signatureView(row!)
}

export async function findSignature(companyId: number, id: number) {
  const [row] = await useDb().select().from(tables.signatures)
    .where(and(eq(tables.signatures.id, id), eq(tables.signatures.companyId, companyId)))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Firma no encontrada' })
  return row
}
