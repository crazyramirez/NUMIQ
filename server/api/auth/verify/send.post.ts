import { eq } from 'drizzle-orm'

/** Reenvía el correo para confirmar el email de la cuenta */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const [u] = await useDb().select({ verified: tables.users.emailVerifiedAt }).from(tables.users).where(eq(tables.users.id, user.id))
  if (u?.verified) return { ok: true, alreadyVerified: true }
  rateLimit(`verify:${user.id}`, 3, 15 * 60_000, 'Ya te hemos enviado el correo: revisa tu bandeja (también el spam)')
  await sendVerificationEmail(event, user)
  return { ok: true }
})
