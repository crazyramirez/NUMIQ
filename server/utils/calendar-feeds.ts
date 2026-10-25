import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { and, eq } from 'drizzle-orm'
import type { CalendarItem } from '../../shared/utils/calendar'

/**
 * Calendarios externos: la dirección iCal secreta de Google Calendar, un calendario público de
 * iCloud o el enlace ICS de Outlook. El servidor lo descarga (solo direcciones públicas, nunca la
 * red interna), expande las repeticiones y lo guarda unos minutos.
 */

const FRESH_MS = 20 * 60_000
const MAX_BYTES = 6 * 1024 * 1024
const TIMEOUT_MS = 12_000

/** webcal:// → https://; solo http(s) */
export function normalizeFeedUrl(raw: string) {
  const s = raw.trim().replace(/^webcals?:\/\//i, 'https://')
  let url: URL
  try {
    url = new URL(s)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Pega la dirección completa del calendario (empieza por https:// o webcal://)', data: { field: 'url' } })
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw createError({ statusCode: 400, statusMessage: 'La dirección debe empezar por https:// o webcal://', data: { field: 'url' } })
  if (url.username || url.password) throw createError({ statusCode: 400, statusMessage: 'La dirección no puede llevar usuario ni contraseña', data: { field: 'url' } })
  return url.toString()
}

function privateAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7))
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff')
}

/** Solo servidores públicos: nunca la red interna (salvo NUXT_CALDAV_ALLOW_PRIVATE=true para un CalDAV propio en la LAN) */
export async function assertPublicHost(url: URL, allowPrivate = false) {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map(a => a.address)
  if (!addresses.length) throw new Error('No se encuentra el servidor de ese calendario')
  if (!allowPrivate && addresses.some(privateAddress)) throw new Error('Esa dirección no es pública')
}

/** Descarga el .ics siguiendo hasta 3 redirecciones, cada una comprobada */
export async function fetchIcs(raw: string) {
  let url = new URL(normalizeFeedUrl(raw))
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(url)
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'accept': 'text/calendar, text/plain;q=0.8, */*;q=0.5', 'user-agent': 'NUMIQ-Calendar/1.0' },
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Redirección no válida')
      continue
    }
    if (res.status === 401 || res.status === 403) throw new Error('El calendario no es público o la dirección secreta ha cambiado')
    if (res.status === 404) throw new Error('No existe ningún calendario en esa dirección')
    if (!res.ok) throw new Error(`El servidor del calendario respondió ${res.status}`)
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > MAX_BYTES) throw new Error('El calendario es demasiado grande')
    const reader = res.body?.getReader()
    if (!reader) return ''
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {
        await reader.cancel()
        throw new Error('El calendario es demasiado grande')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  throw new Error('Demasiadas redirecciones')
}

/** Ventana que se guarda: medio año atrás y año y medio adelante */
function feedWindow() {
  const today = madridToday()
  return { from: shiftDays(today, -190), to: shiftDays(today, 550) }
}

type Feed = typeof tables.calendarFeeds.$inferSelect

export async function syncFeed(feed: Feed) {
  const db = useDb()
  try {
    const text = await fetchIcs(feed.url)
    const { from, to } = feedWindow()
    const events = parseIcs(text, from, to)
    await db.update(tables.calendarFeeds).set({ cache: events, lastSyncAt: new Date(), lastError: null }).where(eq(tables.calendarFeeds.id, feed.id))
    return { ok: true as const, count: events.length, events }
  }
  catch (err) {
    const message = (err as Error).name === 'TimeoutError' ? 'El calendario tarda demasiado en responder' : (err as Error).message || 'No se pudo leer el calendario'
    await db.update(tables.calendarFeeds).set({ lastSyncAt: new Date(), lastError: message.slice(0, 300) }).where(eq(tables.calendarFeeds.id, feed.id))
    return { ok: false as const, error: message }
  }
}

const syncing = new Map<number, Promise<unknown>>()

/** Una sincronización por calendario a la vez */
export function syncFeedOnce(feed: Feed) {
  const running = syncing.get(feed.id)
  if (running) return running
  const p = syncFeed(feed).finally(() => syncing.delete(feed.id))
  syncing.set(feed.id, p)
  return p
}

export async function feedItems(companyId: number, userId: number, from: string, to: string): Promise<CalendarItem[]> {
  const feeds = await useDb().select().from(tables.calendarFeeds)
    .where(and(eq(tables.calendarFeeds.companyId, companyId), eq(tables.calendarFeeds.userId, userId), eq(tables.calendarFeeds.active, true)))
  const out: CalendarItem[] = []
  await Promise.all(feeds.map(async (f) => {
    let events = f.cache ?? []
    const stale = !f.lastSyncAt || Date.now() - new Date(f.lastSyncAt).getTime() > FRESH_MS
    if (!f.lastSyncAt) {
      // Primera vez: se espera (con su límite de tiempo); después, se refresca sin hacer esperar
      const r = await syncFeedOnce(f) as Awaited<ReturnType<typeof syncFeed>>
      if (r.ok) events = r.events
    }
    else if (stale) {
      void syncFeedOnce(f)
    }
    const color = isCalendarColor(f.color) ? f.color : 'slate'
    for (const e of events) {
      if ((e.endDate ?? e.date) < from || e.date > to) continue
      out.push({
        id: `feed-${f.id}-${e.uid}`,
        layer: 'feed',
        type: 'external',
        title: e.title,
        subtitle: f.name,
        date: e.date,
        endDate: e.endDate ?? null,
        time: e.time ?? null,
        endTime: e.endTime ?? null,
        color,
        icon: 'ph:calendar-blank',
        location: e.location ?? null,
        notes: e.notes ?? null,
        feedId: f.id,
      })
    }
  }))
  return out
}
