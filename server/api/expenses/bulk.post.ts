import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  deductiblePct: z.number().min(0).max(100).optional(),
  vatDeductiblePct: z.number().min(0).max(100).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
}).refine(v => v.deductiblePct != null || v.vatDeductiblePct != null || v.categoryId !== undefined, 'Indica qué quieres cambiar')

/**
 * Cambia de una vez la deducibilidad o la categoría de varios gastos (p. ej. los que llegan del banco).
 * Devuelve cómo estaban para poder deshacerlo.
 */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, schema)
  const db = useDb()
  const e = tables.expenses

  if (input.categoryId) {
    const [cat] = await db.select({ id: tables.categories.id }).from(tables.categories)
      .where(and(eq(tables.categories.id, input.categoryId), eq(tables.categories.companyId, company.id), eq(tables.categories.kind, 'expense')))
    if (!cat) throw createError({ statusCode: 400, statusMessage: 'Categoría no encontrada' })
  }

  const previous = await db.select({ id: e.id, deductiblePct: e.deductiblePct, vatDeductiblePct: e.vatDeductiblePct, categoryId: e.categoryId })
    .from(e).where(and(eq(e.companyId, company.id), inArray(e.id, [...new Set(input.ids)])))
  if (!previous.length) throw createError({ statusCode: 404, statusMessage: 'Gastos no encontrados' })

  const changes = {
    ...(input.deductiblePct != null ? { deductiblePct: input.deductiblePct } : {}),
    ...(input.vatDeductiblePct != null ? { vatDeductiblePct: input.vatDeductiblePct } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
  }
  await db.update(e).set(changes).where(and(eq(e.companyId, company.id), inArray(e.id, previous.map(p => p.id))))
  await audit(event, { companyId: company.id, userId: user.id, action: 'expense.bulk', entity: 'expense', data: { ids: previous.map(p => p.id), changes } })
  return { updated: previous.length, previous }
})
