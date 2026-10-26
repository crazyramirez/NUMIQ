import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import type { MemberRole } from '../db/schema'

export function sessionUser(u: { id: number, email: string, name: string, avatarUrl?: string | null }) {
  return { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl ?? null }
}

export async function requireUser(event: H3Event) {
  const session = await requireUserSession(event)
  const [user] = await useDb()
    .select({
      id: tables.users.id,
      email: tables.users.email,
      name: tables.users.name,
      avatarUrl: tables.users.avatarUrl,
      currentCompanyId: tables.users.currentCompanyId,
      emailVerifiedAt: tables.users.emailVerifiedAt,
    })
    .from(tables.users)
    .where(eq(tables.users.id, session.user.id))
  if (!user) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Sesión no válida' })
  }
  return user
}

const ROLE_RANK: Record<MemberRole, number> = { advisor: 1, member: 2, admin: 3, owner: 4 }

/**
 * Usuario + empresa activa en la que es miembro. Todas las rutas de datos filtran por
 * `company.id`: un usuario nunca ve datos de otra empresa. Con `companyId`, otra de sus empresas
 * (la copia de seguridad de cada una antes de eliminar la cuenta).
 */
export async function requireCompany(event: H3Event, minRole: MemberRole = 'member', companyId?: number) {
  const user = await requireUser(event)
  const id = companyId ?? user.currentCompanyId
  if (!id) throw createError({ statusCode: 409, statusMessage: 'Configura tu empresa para empezar', data: { needsOnboarding: true } })
  const [row] = await useDb()
    .select({ company: tables.companies, role: tables.companyMembers.role })
    .from(tables.companyMembers)
    .innerJoin(tables.companies, eq(tables.companies.id, tables.companyMembers.companyId))
    .where(and(eq(tables.companyMembers.companyId, id), eq(tables.companyMembers.userId, user.id)))
  if (!row) throw createError({ statusCode: 403, statusMessage: 'No tienes acceso a esta empresa', data: { needsOnboarding: true } })
  if (ROLE_RANK[row.role] < ROLE_RANK[minRole]) throw createError({ statusCode: 403, statusMessage: 'Tu rol no permite esta acción' })
  // El consumo de IA de esta petición (y de lo que siga en segundo plano) se apunta a esta empresa y usuario
  setAiScope(event, row.company.id, user.id)
  return { user, company: row.company, role: row.role }
}

/**
 * Quien administra el servidor: el titular del correo de la app (GOOGLE_APP_EMAIL) o los emails de
 * NUXT_SERVER_ADMINS, siempre con el email confirmado (el registro no lo exige: sin esto, cualquiera
 * podría registrarse con ese email). Ser propietario de una empresa no basta: cualquiera crea la suya.
 */
export function isServerAdmin(user: { email: string, emailVerifiedAt?: Date | string | null }) {
  if (!user.emailVerifiedAt) return false
  const admins = [mailConfig().user, ...String(process.env.NUXT_SERVER_ADMINS ?? '').split(/[,;\s]+/)]
    .map(s => s.trim().toLowerCase()).filter(Boolean)
  return admins.includes(user.email.toLowerCase())
}

/** Clonar o restaurar la base de datos entera (todas las cuentas y empresas): solo quien administra el servidor */
export async function requireServerAdmin(event: H3Event) {
  const user = await requireUser(event)
  if (!isServerAdmin(user)) throw createError({ statusCode: 403, statusMessage: 'Solo quien administra el servidor puede clonar o restaurar la base de datos' })
  return user
}

export function idParam(event: H3Event, name = 'id') {
  const id = Number(getRouterParam(event, name))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: `Parámetro ${name} inválido` })
  return id
}

export async function audit(event: H3Event, entry: { companyId?: number | null, userId?: number | null, action: string, entity?: string, entityId?: number, data?: Record<string, unknown> }) {
  await useDb().insert(tables.auditLog).values({
    ...entry,
    ip: getRequestIP(event, { xForwardedFor: true })?.slice(0, 45) ?? null,
  }).catch(err => console.error('[audit]', err))
}
