import { z } from 'zod'

/** Qué se pierde al eliminar esta empresa (solo ella): sus datos, quién deja de tener acceso y su última copia */
export default defineEventHandler(async (event) => {
  const id = z.coerce.number().int().positive().parse(getRouterParam(event, 'id'))
  const { user, company } = await requireCompany(event, 'owner', id)
  return companyDeletionPlan(company, user.id)
})
