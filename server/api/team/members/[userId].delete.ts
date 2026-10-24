import { and, eq } from 'drizzle-orm'

/** Quita a alguien de la empresa (o sale uno mismo). El propietario no puede irse si es el único. */
export default defineEventHandler(async (event) => {
  const { company, user, role: myRole } = await requireCompany(event, 'advisor')
  const userId = idParam(event, 'userId')
  const self = userId === user.id
  if (!self && myRole !== 'owner' && myRole !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Tu rol no permite esta acción' })
  const db = useDb()
  const m = tables.companyMembers
  const [member] = await db.select().from(m).where(and(eq(m.companyId, company.id), eq(m.userId, userId)))
  if (!member) throw createError({ statusCode: 404, statusMessage: 'Miembro no encontrado' })
  if (member.role === 'owner') {
    if (!self && myRole !== 'owner') throw createError({ statusCode: 403, statusMessage: 'No puedes quitar al propietario' })
    const owners = await db.select({ id: m.userId }).from(m).where(and(eq(m.companyId, company.id), eq(m.role, 'owner')))
    if (owners.length <= 1) throw createError({ statusCode: 409, statusMessage: 'La empresa necesita al menos un propietario' })
  }
  await db.delete(m).where(and(eq(m.companyId, company.id), eq(m.userId, userId)))
  // Quien sale deja de tener esta empresa como activa
  await db.update(tables.users).set({ currentCompanyId: null }).where(and(eq(tables.users.id, userId), eq(tables.users.currentCompanyId, company.id)))
  await audit(event, { companyId: company.id, userId: user.id, action: self ? 'team.leave' : 'team.remove', entityId: userId })
  return { ok: true }
})
