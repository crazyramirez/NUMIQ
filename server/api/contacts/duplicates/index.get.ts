import { z } from 'zod'

/** Fichas que parecen el mismo cliente o proveedor (para unirlas); con `role`, solo los grupos donde aparece ese papel */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event)
  const { role } = await getValidatedQuery(event, z.object({ role: z.enum(['client', 'supplier']).optional() }).parse)
  const groups = await findDuplicateContacts(company.id, notDuplicatePairs(company.settings))
  return role ? groups.filter(g => g.members.some(m => (role === 'client' ? m.isClient : m.isSupplier))) : groups
})
