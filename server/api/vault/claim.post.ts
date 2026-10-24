import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = vaultMetaSchema.extend({ fileId: z.number().int().positive() })

/** Guarda en el archivo un documento escaneado que no es una factura (extracto, contrato…) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { fileId, ...meta } = await readInput(event, schema)
  const file = await claimScanFile(company.id, fileId)
  await useDb().update(tables.files).set({ kind: 'vault', ...meta }).where(eq(tables.files.id, file!.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'vault.claim', entity: 'file', entityId: fileId })
  return { ok: true }
})
