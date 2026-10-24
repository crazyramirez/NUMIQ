/** Acepta la invitación con la cuenta con la que se ha entrado (su email debe coincidir) */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = getRouterParam(event, 'token') ?? ''
  rateLimit(`invite-accept:${user.id}`, 10, 15 * 60_000)
  const invite = await acceptInvite(token, user)
  await audit(event, { companyId: invite.companyId, userId: user.id, action: 'team.join', data: { role: invite.role } })
  return { ok: true, companyId: invite.companyId }
})
