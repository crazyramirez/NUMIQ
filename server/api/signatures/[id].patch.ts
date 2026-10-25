import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1, 'Ponle un nombre').max(60).optional(),
  isDefault: z.literal(true).optional(),
})

/** Renombra una firma o la deja como predeterminada */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const id = idParam(event)
  const input = await readInput(event, schema)
  const row = await findSignature(company.id, id)
  const db = useDb()
  const s = tables.signatures
  if (input.name !== undefined) await db.update(s).set({ name: input.name }).where(eq(s.id, id))
  if (input.isDefault) {
    await db.update(s).set({ isDefault: false }).where(and(eq(s.companyId, company.id), ne(s.id, id)))
    await db.update(s).set({ isDefault: true }).where(eq(s.id, id))
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'signature.update', entity: 'signature', entityId: id, data: { name: input.name ?? row.name, isDefault: input.isDefault } })
  return { ok: true }
})
