import { eq } from 'drizzle-orm'
import { z } from 'zod'

/** «No son el mismo»: esas fichas no se vuelven a proponer como duplicadas entre sí */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { ids } = await readInput(event, z.object({ ids: z.array(z.number().int().positive()).min(2).max(50) }))
  const pairs = new Set(notDuplicatePairs(company.settings))
  for (const a of ids) for (const b of ids) if (a < b) pairs.add(pairKey(a, b))
  // Los últimos 5000 pares: de sobra para cualquier empresa
  const settings = { ...(company.settings ?? {}), contactsNotDuplicate: [...pairs].slice(-5000) }
  await useDb().update(tables.companies).set({ settings }).where(eq(tables.companies.id, company.id))
  await audit(event, { companyId: company.id, userId: user.id, action: 'contact.not_duplicate', entity: 'contact', data: { ids } })
  return { ok: true }
})
