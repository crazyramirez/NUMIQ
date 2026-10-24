import { and, eq, isNotNull, isNull, max, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

const seriesPatchSchema = z.object({
  name: z.string().trim().min(1, 'El nombre no puede estar vacío').max(80).optional(),
  prefix: z.string().trim().max(20).optional(),
  padding: z.number().int().min(2).max(8).optional(),
  yearlyReset: z.boolean().optional(),
  nextSequence: z.number().int().min(1, 'El siguiente número debe ser al menos 1').optional(),
  isDefault: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const id = idParam(event)
  const input = await readInput(event, seriesPatchSchema)
  const db = useDb()

  const [existing] = await db.select().from(tables.series)
    .where(and(eq(tables.series.id, id), eq(tables.series.companyId, company.id), isNull(tables.series.archivedAt)))

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Serie de numeración no encontrada' })
  }

  const year = new Date().getFullYear()
  const targetYearlyReset = input.yearlyReset ?? existing.yearlyReset

  // Si se quiere cambiar el siguiente número correlativo, verificar que no cause colisión con facturas ya emitidas
  if (input.nextSequence != null) {
    const [maxIssued] = await db.select({ maxSeq: max(tables.salesDocuments.sequence) })
      .from(tables.salesDocuments)
      .where(and(
        eq(tables.salesDocuments.seriesId, id),
        eq(tables.salesDocuments.companyId, company.id),
        targetYearlyReset ? eq(tables.salesDocuments.year, year) : undefined,
        isNotNull(tables.salesDocuments.number),
      ))

    if (maxIssued?.maxSeq && input.nextSequence <= maxIssued.maxSeq) {
      throw createError({
        statusCode: 400,
        statusMessage: `No se puede fijar el próximo número en ${input.nextSequence} porque ya existe el documento nº ${maxIssued.maxSeq} emitido este año. Debe ser mayor que ${maxIssued.maxSeq}.`,
      })
    }
  }

  await db.transaction(async (tx) => {
    // Si se marca como predeterminada, desmarcar otras series del mismo tipo
    if (input.isDefault) {
      await tx.update(tables.series)
        .set({ isDefault: false })
        .where(and(
          eq(tables.series.companyId, company.id),
          eq(tables.series.kind, existing.kind),
          ne(tables.series.id, id),
        ))
    }

    const updateData: Partial<typeof tables.series.$inferInsert> = {}
    if (input.name !== undefined) updateData.name = input.name
    if (input.prefix !== undefined) updateData.prefix = input.prefix
    if (input.padding !== undefined) updateData.padding = input.padding
    if (input.yearlyReset !== undefined) updateData.yearlyReset = input.yearlyReset
    if (input.isDefault !== undefined) updateData.isDefault = input.isDefault

    if (Object.keys(updateData).length > 0) {
      await tx.update(tables.series)
        .set(updateData)
        .where(eq(tables.series.id, id))
    }

    // Actualizar el contador si se cambió el siguiente número
    if (input.nextSequence != null) {
      const counterYear = targetYearlyReset ? year : 0
      const lastNumber = Math.max(0, input.nextSequence - 1)

      await tx.insert(tables.seriesCounters)
        .values({ seriesId: id, year: counterYear, lastNumber })
        .onDuplicateKeyUpdate({ set: { lastNumber } })
    }
  })

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'series.update',
    entity: 'series',
    entityId: id,
  })

  return { ok: true }
})
