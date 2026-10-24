import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Deshace una unión de fichas: vuelven a existir con su id y recuperan sus documentos */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { undoId } = await readInput(event, z.object({ undoId: z.number().int().positive() }))
  const a = tables.auditLog
  const [row] = await useDb().select().from(a).where(and(eq(a.id, undoId), eq(a.companyId, company.id), eq(a.action, 'contact.merge')))
  const data = row?.data as { undo?: MergeUndo, undone?: boolean } | undefined
  if (!data?.undo) throw createError({ statusCode: 404, statusMessage: 'No se encuentra la unión' })
  if (data.undone) throw createError({ statusCode: 409, statusMessage: 'Ya está deshecho' })
  await unmergeContacts(company.id, data.undo)
  await useDb().update(a).set({ data: { ...data, undone: true } }).where(eq(a.id, undoId))
  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.unmerge', entity: 'contact', entityId: data.undo.keep.id, data: { undoId } })
  return { ok: true }
})
