import { and, eq } from 'drizzle-orm'

/** Vuelta de Google: guarda el permiso, crea el calendario «NUMIQ · Empresa» y sincroniza */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'advisor')
  const q = getQuery(event)
  const expected = getCookie(event, 'numiq-gcal')
  deleteCookie(event, 'numiq-gcal', { path: '/api/calendar/google' })
  const back = (motivo: string) => sendRedirect(event, `/calendario?conectar=error&motivo=${encodeURIComponent(motivo)}`)
  if (q.error) return back(q.error === 'access_denied' ? 'cancelado' : String(q.error))
  if (!expected || typeof q.state !== 'string' || q.state !== expected || typeof q.code !== 'string') return back('caducado')
  if (!googleConfig()) return back('google')
  try {
    const tokens = await googleExchange(q.code, `${siteUrl(event)}/api/calendar/google/callback`)
    if (!tokens.refreshToken) return back('permiso')
    const calendarId = await googleCreateCalendar(tokens.accessToken, `NUMIQ · ${company.tradeName || company.legalName}`)
    const db = useDb()
    const where = and(eq(tables.calendarAccounts.companyId, company.id), eq(tables.calendarAccounts.userId, user.id), eq(tables.calendarAccounts.provider, 'google'))
    const [old] = await db.select().from(tables.calendarAccounts).where(where)
    if (old) await disconnectAccount(old)
    await db.insert(tables.calendarAccounts).values({
      companyId: company.id,
      userId: user.id,
      provider: 'google',
      label: tokens.email ? `Google · ${tokens.email}` : 'Google Calendar',
      calendarRef: calendarId,
      ownsCalendar: true,
      secret: sealJson({ refreshToken: tokens.refreshToken }),
      layers: old?.layers?.length ? old.layers : [...DEFAULT_SYNC_LAYERS],
    })
    const [account] = await db.select().from(tables.calendarAccounts).where(where)
    await audit(event, { companyId: company.id, userId: user.id, action: 'calendar.connect', entity: 'calendar_account', entityId: account!.id, data: { provider: 'google' } })
    // La primera carga sigue en segundo plano: la pantalla ya muestra el progreso
    void syncAccount(account!.id)
    return sendRedirect(event, '/calendario?conectar=sincronizado')
  }
  catch (err) {
    console.warn('[calendario] google', (err as Error).message)
    return back('google-error')
  }
})
