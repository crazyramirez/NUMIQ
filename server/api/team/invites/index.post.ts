import { and, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  email: emailField(),
  role: z.enum(['admin', 'member', 'advisor']),
  /** Enviar por correo o solo generar el enlace para compartirlo */
  send: z.boolean().default(true),
})

/** Invita a alguien a la empresa; devuelve también el enlace por si se quiere compartir a mano */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const input = await readInput(event, schema)
  rateLimit(`invite:${company.id}`, 20, 60 * 60_000, 'Has enviado muchas invitaciones seguidas: espera un poco')
  const db = useDb()
  const [already] = await db.select({ id: tables.users.id }).from(tables.companyMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.companyMembers.userId))
    .where(and(eq(tables.companyMembers.companyId, company.id), eq(tables.users.email, input.email)))
  if (already) throw createError({ statusCode: 409, statusMessage: 'Esa persona ya forma parte de la empresa', data: { field: 'email' } })
  // Una invitación pendiente por email: se renueva
  await db.update(tables.companyInvites).set({ expiresAt: new Date() })
    .where(and(eq(tables.companyInvites.companyId, company.id), eq(tables.companyInvites.email, input.email), isNull(tables.companyInvites.acceptedAt), gt(tables.companyInvites.expiresAt, new Date())))
  const { token, hash } = newToken()
  const [res] = await db.insert(tables.companyInvites).values({
    companyId: company.id, email: input.email, role: input.role, tokenHash: hash, invitedBy: user.id, expiresAt: new Date(Date.now() + INVITE_TTL),
  }).$returningId()
  let sent = false
  if (input.send) {
    await sendInviteEmail(event, company, user, input, token)
    await db.update(tables.companyInvites).set({ lastSentAt: new Date() }).where(eq(tables.companyInvites.id, res!.id))
    sent = true
  }
  await audit(event, { companyId: company.id, userId: user.id, action: 'team.invite', data: { email: input.email, role: input.role, sent } })
  return { id: res!.id, link: invitationUrl(event, token), sent }
})
