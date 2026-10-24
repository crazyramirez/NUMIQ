import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  model: z.enum(['303', '130', '111', '115', '349', '390', '347', '190', '180', '100', '200', '202']),
  year: z.number().int().min(2000).max(2100),
  /** 1T..4T, 1P..3P (pagos fraccionados del 202), 0A (anual) o mes 01..12 */
  period: z.string().regex(/^([1-4]T|[1-3]P|0A|0[1-9]|1[0-2])$/, 'Periodo no válido'),
  result: z.number().finite(),
  status: z.enum(['filed', 'paid']).default('filed'),
  csv: z.string().trim().max(40).nullish().transform(v => v || null),
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  receiptFileId: z.number().int().positive().nullish(),
  boxes: z.record(z.string(), z.number()).nullish(),
})

/** Registra que el modelo se ha presentado (con su justificante y CSV) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, schema)
  const db = useDb()
  if (input.receiptFileId) {
    const [f] = await db.select({ id: tables.files.id }).from(tables.files).where(and(eq(tables.files.id, input.receiptFileId), eq(tables.files.companyId, company.id)))
    if (!f) throw createError({ statusCode: 400, statusMessage: 'Justificante no encontrado' })
  }
  const values = {
    status: input.status,
    result: input.result,
    csv: input.csv,
    filedAt: input.filedAt ? new Date(`${input.filedAt}T12:00:00`) : new Date(),
    receiptFileId: input.receiptFileId ?? null,
    boxes: input.boxes ?? null,
  }
  await db.insert(tables.taxFilings).values({ companyId: company.id, model: input.model, year: input.year, period: input.period, ...values })
    .onDuplicateKeyUpdate({ set: values })
  if (input.receiptFileId) {
    const [filing] = await db.select({ id: tables.taxFilings.id }).from(tables.taxFilings)
      .where(and(eq(tables.taxFilings.companyId, company.id), eq(tables.taxFilings.model, input.model), eq(tables.taxFilings.year, input.year), eq(tables.taxFilings.period, input.period)))
    if (filing) await db.update(tables.files).set({ linkedType: 'tax_filing', linkedId: filing.id }).where(eq(tables.files.id, input.receiptFileId))
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'tax.filed', data: { model: input.model, period: `${input.period} ${input.year}`, csv: input.csv } })
  return { ok: true }
})
