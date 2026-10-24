import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const seriesCreateSchema = z.object({
  kind: z.enum(['quote', 'proforma', 'invoice', 'rectifying']),
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(80),
  prefix: z.string().trim().max(20).default(''),
  padding: z.number().int().min(2).max(8).default(4),
  yearlyReset: z.boolean().default(true),
  nextSequence: z.number().int().min(1, 'El siguiente número debe ser al menos 1').default(1),
  isDefault: z.boolean().default(false),
})

export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, seriesCreateSchema)
  const db = useDb()
  const year = new Date().getFullYear()

  let newId = 0
  await db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx.update(tables.series)
        .set({ isDefault: false })
        .where(and(
          eq(tables.series.companyId, company.id),
          eq(tables.series.kind, input.kind),
        ))
    }

    const [res] = await tx.insert(tables.series).values({
      companyId: company.id,
      kind: input.kind,
      name: input.name,
      prefix: input.prefix,
      padding: input.padding,
      yearlyReset: input.yearlyReset,
      isDefault: input.isDefault,
    })
    newId = res.insertId

    const counterYear = input.yearlyReset ? year : 0
    const lastNumber = Math.max(0, input.nextSequence - 1)
    await tx.insert(tables.seriesCounters).values({
      seriesId: newId,
      year: counterYear,
      lastNumber,
    })
  })

  await audit(event, {
    companyId: company.id,
    userId: user.id,
    action: 'series.create',
    entity: 'series',
    entityId: newId,
  })

  return { id: newId }
})
