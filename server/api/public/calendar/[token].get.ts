import { and, eq } from 'drizzle-orm'

/**
 * Suscripción iCal (webcal) del calendario: la leen Google Calendar, Apple Calendar y Outlook.
 * El token es aleatorio (24 bytes) y propio de cada persona; regenerarlo invalida el anterior.
 * Publica de 3 meses atrás a 15 meses adelante.
 */
export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') ?? '').replace(/\.ics$/i, '')
  if (!/^[\w-]{20,64}$/.test(token)) throw createError({ statusCode: 404, statusMessage: 'Calendario no encontrado' })
  const db = useDb()
  const [row] = await db.select({ link: tables.calendarLinks, company: tables.companies })
    .from(tables.calendarLinks)
    .innerJoin(tables.companies, eq(tables.companies.id, tables.calendarLinks.companyId))
    // Si la persona deja la empresa, su enlace deja de funcionar
    .innerJoin(tables.companyMembers, and(eq(tables.companyMembers.companyId, tables.calendarLinks.companyId), eq(tables.companyMembers.userId, tables.calendarLinks.userId)))
    .where(eq(tables.calendarLinks.token, token))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Calendario no encontrado' })
  const today = madridToday()
  const layers = (row.link.layers?.length ? row.link.layers : DEFAULT_FEED_LAYERS).filter(l => l !== 'feed') as CalendarLayer[]
  const items = await calendarItems(row.company, shiftDays(today, -92), shiftDays(today, 456), { layers })
  const body = itemsToIcs(items, {
    name: `NUMIQ · ${row.company.tradeName || row.company.legalName}`,
    site: siteUrl(event),
    description: 'Cobros, pagos, plazos de Hacienda y tus eventos de NUMIQ',
  })
  // Como mucho una escritura cada 10 minutos por enlace
  if (!row.link.lastUsedAt || Date.now() - new Date(row.link.lastUsedAt).getTime() > 600_000) {
    await db.update(tables.calendarLinks).set({ lastUsedAt: new Date() }).where(eq(tables.calendarLinks.id, row.link.id)).catch(() => {})
  }
  setResponseHeaders(event, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': 'inline; filename="numiq.ics"',
    'cache-control': 'private, max-age=300',
    'x-robots-tag': 'noindex',
  })
  return body
})
