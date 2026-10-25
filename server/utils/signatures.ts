import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

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
  if (existing.length >= MAX_SIGNATURES) throw createError({ statusCode: 409, statusMessage: `Máximo ${MAX_SIGNATURES} firmas: elimina alguna que ya no uses` })
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

// ─── Firma en facturas y presupuestos ───────────────────────────────────────

export const signingSettingsSchema = z.object({
  /** Firmar por defecto las facturas (también rectificativas) */
  invoices: z.boolean(),
  /** Firmar por defecto los presupuestos y proformas */
  quotes: z.boolean(),
  /** Firma a usar (null = la principal) */
  signatureId: z.number().int().positive().nullable(),
  /** Texto sobre la firma («Firma», «Conforme»…); vacío = sin texto */
  label: z.string().trim().max(40),
})
export type SigningSettings = z.infer<typeof signingSettingsSchema>

export function signingSettings(company: { settings: Record<string, unknown> | null }): SigningSettings {
  const s = (company.settings?.signing ?? {}) as Partial<SigningSettings>
  return {
    invoices: s.invoices === true,
    quotes: s.quotes === true,
    signatureId: typeof s.signatureId === 'number' ? s.signatureId : null,
    label: typeof s.label === 'string' ? s.label : 'Firma',
  }
}

const isQuoteKind = (kind: string) => kind === 'quote' || kind === 'proforma'

/**
 * Firma que lleva un documento: la que se eligió en él o, si no se tocó, la de Ajustes para su tipo.
 * Una firma borrada cae en la de Ajustes o en la principal.
 */
export async function documentSignature(companyId: number, settings: SigningSettings, doc: { kind: string, sign: boolean | null, signatureId: number | null }) {
  const byDefault = isQuoteKind(doc.kind) ? settings.quotes : settings.invoices
  const on = doc.sign ?? byDefault
  const all = await listSignatures(companyId)
  const pick = all.find(s => s.id === doc.signatureId) ?? all.find(s => s.id === settings.signatureId) ?? all[0] ?? null
  return {
    /** Lo que diría Ajustes para este tipo de documento */
    byDefault,
    signature: on && pick ? { id: pick.id, name: pick.name, url: `/api/signatures/${pick.id}`, label: settings.label } : null,
  }
}
