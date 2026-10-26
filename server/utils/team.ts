import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * Equipo de la empresa: socios, empleados y el gestor (rol "advisor": consulta datos, informes e
 * impuestos sin poder emitir ni borrar, y sube lo que la empresa le permita; ver advisor-access.ts).
 * Las invitaciones son enlaces de un solo uso, 14 días.
 */

type Company = typeof tables.companies.$inferSelect

export const INVITE_TTL = 14 * 86_400_000

export async function sendInviteEmail(event: H3Event, company: Company, inviter: { name: string }, invite: { email: string, role: string }, token: string) {
  const brand = company.tradeName || company.legalName
  const roleText = invite.role === 'advisor'
    ? 'como gestor: podrás consultar sus facturas, gastos, informes e impuestos, descargar la documentación de cada trimestre y subir lo que te permita, como nóminas o impuestos presentados'
    : invite.role === 'admin' ? 'como administrador' : 'a su equipo'
  await sendAccountEmail(invite.email, {
    subject: `${inviter.name} te invita a ${brand} en NUMIQ`,
    title: `Te han invitado a ${brand}`,
    lines: [`${inviter.name} te invita a ${brand} ${roleText}.`, 'La invitación caduca en 14 días.'],
    action: { label: 'Aceptar la invitación', url: invitationUrl(event, token) },
    footer: 'Si no conoces a quien te invita, ignora este correo.',
  })
}

export const invitationUrl = (event: H3Event, token: string) => `${siteUrl(event)}/invitacion?token=${token}`

/** Invitación vigente a partir del enlace */
export async function findInvite(token: string) {
  const [invite] = await useDb().select().from(tables.companyInvites).where(eq(tables.companyInvites.tokenHash, hashToken(token)))
  return invite ?? null
}

/** El usuario se une a la empresa con el rol de la invitación y pasa a trabajar en ella */
export async function acceptInvite(token: string, user: { id: number, email: string }) {
  const db = useDb()
  const invite = await findInvite(token)
  if (!invite || invite.expiresAt < new Date()) throw createError({ statusCode: 400, statusMessage: 'La invitación no es válida o ha caducado: pide una nueva' })
  if (invite.acceptedAt) throw createError({ statusCode: 409, statusMessage: 'Esta invitación ya se ha usado' })
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: `Esta invitación es para ${invite.email}: entra o regístrate con ese email` })
  }
  const m = tables.companyMembers
  const [existing] = await db.select().from(m).where(and(eq(m.companyId, invite.companyId), eq(m.userId, user.id)))
  if (!existing) await db.insert(m).values({ companyId: invite.companyId, userId: user.id, role: invite.role })
  await db.update(tables.companyInvites).set({ acceptedAt: new Date(), acceptedBy: user.id }).where(eq(tables.companyInvites.id, invite.id))
  // Cualquier otra invitación pendiente al mismo email para la misma empresa deja de valer
  await db.update(tables.companyInvites).set({ expiresAt: new Date() })
    .where(and(eq(tables.companyInvites.companyId, invite.companyId), eq(tables.companyInvites.email, invite.email), isNull(tables.companyInvites.acceptedAt)))
  // Si la invitación llegó por correo, abrir el enlace demuestra que el email es suyo
  await db.update(tables.users).set({ currentCompanyId: invite.companyId, ...(invite.lastSentAt ? { emailVerifiedAt: new Date() } : {}) }).where(eq(tables.users.id, user.id))
  return invite
}
