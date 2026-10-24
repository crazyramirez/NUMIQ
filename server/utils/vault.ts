import { createHash } from 'node:crypto'
import { z } from 'zod'

/**
 * Archivo documental por trimestre: extractos del banco, contratos, nóminas, justificantes…
 * Lo que tu gestoría te pide cada trimestre, ordenado y a mano.
 */

export const MAX_VAULT_BYTES = 25 * 1024 * 1024

export const vaultMetaSchema = z.object({
  /** Carpeta: las predefinidas (banco, legal…) o una propia */
  folder: z.string().trim().toLowerCase().min(1).max(40).regex(/^[\p{L}\p{N} _-]+$/u, 'Nombre de carpeta no válido'),
  year: z.coerce.number().int().min(1990).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
  notes: z.string().trim().max(255).nullish().transform(v => v || null),
})

export type VaultMeta = z.infer<typeof vaultMetaSchema>

export async function saveVaultFile(companyId: number, userId: number, file: { filename?: string, data: Buffer }, meta: VaultMeta) {
  const originalName = safeFilename(file.filename ?? 'documento')
  if (file.data.length > MAX_VAULT_BYTES) throw createError({ statusCode: 413, statusMessage: `${originalName} supera 25 MB` })
  const kind = detectDocument(file.data, originalName) ?? (/\.xml$/i.test(originalName) && file.data.subarray(0, 256).toString('utf8').trimStart().startsWith('<') ? { ext: 'xml', mime: 'application/xml' } : null)
  if (!kind) throw createError({ statusCode: 415, statusMessage: `${originalName}: formato no admitido (PDF, imagen, Word, Excel, CSV, XML o ZIP)` })
  const path = await saveCompanyFile(companyId, `vault/${meta.year}-${meta.quarter}`, file.data, kind.ext)
  const [res] = await useDb().insert(tables.files).values({
    companyId,
    kind: 'vault',
    originalName,
    mime: kind.mime,
    size: file.data.length,
    path,
    sha256: createHash('sha256').update(file.data).digest('hex'),
    year: meta.year,
    quarter: meta.quarter,
    folder: meta.folder,
    notes: meta.notes,
    uploadedBy: userId,
  }).$returningId()
  return res!.id
}

/** Trimestres que toca un rango de fechas: 2026-02-01..2026-05-31 → 2026 T1 y T2 */
export function quartersInRange(from: string, to: string) {
  const out: Array<{ year: number, quarter: number }> = []
  let y = Number(from.slice(0, 4))
  let q = Math.floor((Number(from.slice(5, 7)) - 1) / 3) + 1
  const endY = Number(to.slice(0, 4))
  const endQ = Math.floor((Number(to.slice(5, 7)) - 1) / 3) + 1
  while (y < endY || (y === endY && q <= endQ)) {
    out.push({ year: y, quarter: q })
    q++
    if (q > 4) {
      q = 1
      y++
    }
    if (out.length > 60) break
  }
  return out
}
