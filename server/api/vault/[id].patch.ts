import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = vaultMetaSchema.partial().extend({
  name: z.string().trim().min(1).max(180).optional(),
})

/** Mueve un documento a otra carpeta o trimestre, o cambia su nota o nombre */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const input = await readInput(event, schema)
  const db = useDb()
  const [file] = await db.select({ id: tables.files.id, originalName: tables.files.originalName, folder: tables.files.folder, uploadedBy: tables.files.uploadedBy }).from(tables.files)
    .where(and(eq(tables.files.id, id), eq(tables.files.companyId, company.id), eq(tables.files.kind, 'vault')))
  if (!file) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado' })
  assertOwnAdvisorFile(company, role, user.id, file, input.folder)
  const { name, ...meta } = input
  // Se conserva la extensión original
  const ext = file.originalName.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? ''
  const originalName = name ? safeFilename(name.replace(/\.[a-z0-9]{1,6}$/i, '') + ext) : undefined
  const values = { ...meta, ...(originalName ? { originalName } : {}) }
  if (Object.keys(values).length) await db.update(tables.files).set(values).where(eq(tables.files.id, id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'vault.update', entity: 'file', entityId: id, data: values })
  return { ok: true }
})
