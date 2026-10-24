import { and, eq, isNull } from 'drizzle-orm'

/** Reenvía una invitación con un enlace nuevo (el anterior deja de valer) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const id = idParam(event)
  const db = useDb()
  const [invite] = await db.select().from(tables.companyInvites)
    .where(and(eq(tables.companyInvites.id, id), eq(tables.companyInvites.companyId, company.id), isNull(tables.companyInvites.acceptedAt)))
  if (!invite) throw createError({ statusCode: 404, statusMessage: 'Invitación no encontrada' })
  rateLimit(`invite-resend:${id}`, 3, 60 * 60_000, 'Ya la has reenviado varias veces: espera un poco')
  const { token, hash } = newToken()
  await sendInviteEmail(event, company, user, invite, token)
  await db.update(tables.companyInvites).set({ tokenHash: hash, expiresAt: new Date(Date.now() + INVITE_TTL), lastSentAt: new Date() }).where(eq(tables.companyInvites.id, id))
  return { ok: true, link: invitationUrl(event, token) }
})
