import { z } from 'zod'

const schema = z.object({
  keepId: z.number().int().positive(),
  ids: z.array(z.number().int().positive()).min(1).max(50),
})

/** Une fichas repetidas en una: sus documentos pasan a la que se conserva. Devuelve el id para deshacerlo */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { keepId, ids } = await readInput(event, schema)
  const undo = await mergeContacts(company.id, keepId, ids)
  // La auditoría guarda lo necesario para deshacer la unión (las fichas tal como estaban)
  const [row] = await useDb().insert(tables.auditLog).values({
    companyId: company.id, userId: user.id, action: 'contact.merge', entity: 'contact', entityId: keepId,
    data: { undo, names: undo.merged.map(m => m.name) },
    ip: getRequestIP(event, { xForwardedFor: true })?.slice(0, 45) ?? null,
  }).$returningId()
  const m = undo.moved
  return { ok: true, undoId: row!.id, merged: undo.merged.length, moved: m.sales.length + m.expenses.length + m.recurrings.length }
})
