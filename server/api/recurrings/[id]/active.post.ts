import { z } from 'zod'

/** Pausa o reanuda. Al reanudar, lo atrasado no se genera: la serie sigue desde hoy. */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const rec = await getRecurring(company.id, idParam(event))
  const { active } = await readInput(event, z.object({ active: z.boolean() }))
  const r = await setRecurringActive(rec, active)
  await audit(event, { companyId: company.id, userId: user.id, action: active ? 'recurring.resume' : 'recurring.pause', entity: 'recurring', entityId: rec.id })
  return r
})
