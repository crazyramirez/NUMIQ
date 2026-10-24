import { z } from 'zod'

const schema = z.object({
  period: packPeriodSchema,
  issued: z.boolean().default(true),
  received: z.boolean().default(true),
  summary: z.boolean().default(true),
  vaultIds: z.array(z.number().int().positive()).max(500).default([]),
})

/** Prepara el ZIP del periodo para descargarlo o enviarlo */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const input = await readInput(event, schema)
  if (!input.issued && !input.received && !input.summary && !input.vaultIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'Elige al menos qué incluir' })
  }
  await purgeOldPacks(company.id).catch(() => {})
  const pack = await buildPack(company, user.id, packPeriod(input.period), input)
  await audit(event, { companyId: company.id, userId: user.id, action: 'advisor.pack', entity: 'advisor_pack', entityId: pack.id, data: { period: pack.label, files: pack.contents?.files } })
  const { path: _p, token: _t, ...rest } = pack
  return { ...rest, available: true }
})
