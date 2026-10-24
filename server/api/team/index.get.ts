import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'

/** Miembros de la empresa e invitaciones pendientes */
export default defineEventHandler(async (event) => {
  const { company, user, role } = await requireCompany(event, 'advisor')
  const db = useDb()
  const m = tables.companyMembers
  const u = tables.users
  const [members, invites] = await Promise.all([
    db.select({ userId: u.id, name: u.name, email: u.email, role: m.role, joinedAt: m.createdAt, lastLoginAt: u.lastLoginAt })
      .from(m).innerJoin(u, eq(u.id, m.userId)).where(eq(m.companyId, company.id)).orderBy(asc(m.createdAt)),
    ['owner', 'admin'].includes(role)
      ? db.select({ id: tables.companyInvites.id, email: tables.companyInvites.email, role: tables.companyInvites.role, expiresAt: tables.companyInvites.expiresAt, lastSentAt: tables.companyInvites.lastSentAt, createdAt: tables.companyInvites.createdAt })
          .from(tables.companyInvites)
          .where(and(eq(tables.companyInvites.companyId, company.id), isNull(tables.companyInvites.acceptedAt), gt(tables.companyInvites.expiresAt, new Date())))
          .orderBy(desc(tables.companyInvites.id))
      : Promise.resolve([]),
  ])
  return {
    myRole: role,
    canManage: role === 'owner' || role === 'admin',
    mail: mailEnabled(),
    members: members.map(x => ({ ...x, isYou: x.userId === user.id })),
    invites,
  }
})
