import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Renombra una cuenta bancaria */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const id = idParam(event)
  const { name } = await readInput(event, z.object({ name: z.string().trim().min(1, 'Escribe un nombre').max(120) }))
  const a = tables.bankAccounts
  const [res] = await useDb().update(a).set({ name }).where(and(eq(a.id, id), eq(a.companyId, company.id)))
  if (!res.affectedRows) throw createError({ statusCode: 404, statusMessage: 'Cuenta no encontrada' })
  return { ok: true }
})
