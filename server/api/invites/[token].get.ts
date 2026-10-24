import { eq } from 'drizzle-orm'

/** Datos públicos de una invitación (para la página de aceptación) */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token') ?? ''
  rateLimit(`invite-view:${getRequestIP(event, { xForwardedFor: true }) ?? 'ip'}`, 60, 15 * 60_000)
  const invite = token.length >= 20 ? await findInvite(token) : null
  if (!invite) throw createError({ statusCode: 404, statusMessage: 'Invitación no encontrada' })
  const db = useDb()
  const [company] = await db.select({ legalName: tables.companies.legalName, tradeName: tables.companies.tradeName }).from(tables.companies).where(eq(tables.companies.id, invite.companyId))
  const [inviter] = invite.invitedBy ? await db.select({ name: tables.users.name }).from(tables.users).where(eq(tables.users.id, invite.invitedBy)) : []
  const [account] = await db.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, invite.email))
  return {
    company: company?.tradeName || company?.legalName || 'una empresa',
    inviter: inviter?.name ?? null,
    email: invite.email,
    role: invite.role,
    roleLabel: ROLE_LABELS[invite.role],
    expired: invite.expiresAt < new Date(),
    accepted: !!invite.acceptedAt,
    hasAccount: !!account,
  }
})
