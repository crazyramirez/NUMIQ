import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ role: z.enum(['owner', 'admin', 'member', 'advisor']) })

/** Cambia el rol de un miembro. Solo el propietario puede nombrar otro propietario. */
export default defineEventHandler(async (event) => {
  const { company, user, role: myRole } = await requireCompany(event, 'admin')
  const userId = idParam(event, 'userId')
  const { role } = await readInput(event, schema)
  const db = useDb()
  const m = tables.companyMembers
  const [member] = await db.select().from(m).where(and(eq(m.companyId, company.id), eq(m.userId, userId)))
  if (!member) throw createError({ statusCode: 404, statusMessage: 'Miembro no encontrado' })
  if (member.role === 'owner' && myRole !== 'owner') throw createError({ statusCode: 403, statusMessage: 'Solo el propietario puede cambiar su propio rol' })
  if (role === 'owner' && myRole !== 'owner') throw createError({ statusCode: 403, statusMessage: 'Solo el propietario puede nombrar a otro propietario' })
  if (member.role === 'owner' && role !== 'owner') {
    const owners = await db.select({ id: m.userId }).from(m).where(and(eq(m.companyId, company.id), eq(m.role, 'owner')))
    if (owners.length <= 1) throw createError({ statusCode: 409, statusMessage: 'La empresa necesita al menos un propietario' })
  }
  await db.update(m).set({ role }).where(and(eq(m.companyId, company.id), eq(m.userId, userId)))
  await audit(event, { companyId: company.id, userId: user.id, action: 'team.role', entityId: userId, data: { role } })
  return { ok: true }
})
