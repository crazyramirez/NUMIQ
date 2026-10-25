import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import type { CalendarColor, CalendarItem, CalendarLayer } from '../../shared/utils/calendar'

/**
 * Sincronización con un calendario conectado (Google Calendar o CalDAV: iCloud, Nextcloud,
 * Fastmail…): NUMIQ escribe en un calendario propio («NUMIQ · Empresa») los eventos y tareas
 * y, si se eligen, los plazos de Hacienda, vencimientos y demás. Solo toca lo que creó él.
 *  - Al crear, cambiar, mover o borrar un evento se sincroniza al momento (scheduleCalendarPush).
 *  - Lo demás (plazos, vencimientos…) cada pocos minutos (plugin calendar-sync).
 */

type Account = typeof tables.calendarAccounts.$inferSelect
type Company = typeof tables.companies.$inferSelect
type OwnEvent = typeof tables.calendarEvents.$inferSelect

/** Lo que se publica si no se elige nada: tus eventos y tareas, y los plazos de Hacienda */
export const DEFAULT_SYNC_LAYERS: CalendarLayer[] = ['event', 'tax']
export const SYNC_LAYERS = ['event', 'tax', 'income', 'expense', 'quote', 'recurring', 'holiday'] as const

/** Evento tal como se escribe fuera, igual para Google y para CalDAV */
export interface RemoteEvent {
  key: string
  uid: string
  title: string
  description: string | null
  location: string | null
  url: string | null
  date: string
  /** Último día incluido */
  endDate: string | null
  time: string | null
  endTime: string | null
  /** RRULE sin el prefijo (FREQ=WEEKLY;INTERVAL=1;UNTIL=…) */
  rrule: string | null
  /** Avisos en minutos antes del inicio (negativo = después: «a las 9:00» de un evento de todo el día) */
  alarms: number[]
  color: CalendarColor
}

// ─── Credenciales ───

interface GoogleSecret { refreshToken: string }
interface CaldavSecret { username: string, password: string }

export const sealJson = (v: unknown) => sealSecret(Buffer.from(JSON.stringify(v), 'utf8')).toString('base64')
const openJson = <T>(s: string) => JSON.parse(openSecret(Buffer.from(s, 'base64')).toString('utf8')) as T

export const syncLayersOf = (a: Pick<Account, 'layers'>) => ((a.layers?.length ? a.layers : DEFAULT_SYNC_LAYERS) as CalendarLayer[])

// ─── Qué hay que tener en el calendario conectado ───

const UNTIL_DAYS = 400
const FROM_DAYS = 30

const REPEAT_RULE: Record<string, string> = { weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', quarterly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' }

function ruleOf(ev: OwnEvent) {
  if (ev.repeat === 'none') return null
  const interval = (ev.repeat === 'quarterly' ? 3 : 1) * Math.max(1, ev.repeatInterval || 1)
  const until = ev.repeatUntil
    ? ev.startTime ? `;UNTIL=${ev.repeatUntil.replace(/-/g, '')}T225959Z` : `;UNTIL=${ev.repeatUntil.replace(/-/g, '')}`
    : ''
  return `${REPEAT_RULE[ev.repeat]};INTERVAL=${interval}${until}`
}

function eventToRemote(ev: OwnEvent, site: string, contact: string | null): RemoteEvent {
  const doneOnce = ev.kind === 'task' && ev.repeat === 'none' && (ev.doneDates ?? []).includes(ev.startDate)
  const link = `${site}/calendario?fecha=${ev.startDate}&evento=${ev.id}`
  // Los de todo el día avisan a las 9:00 menos lo pedido: en minutos antes de las 0:00 de ese día
  const alarms = ev.remindMinutes == null ? [] : [ev.startTime ? ev.remindMinutes : ev.remindMinutes - 540]
  return {
    key: `ev-${ev.id}`,
    uid: `numiq-ev-${ev.id}`,
    title: `${doneOnce ? '✓ ' : ''}${ev.title}`,
    description: [contact ? `Con ${contact}` : null, ev.notes, `Abrir en NUMIQ: ${link}`].filter(Boolean).join('\n\n'),
    location: ev.location,
    url: link,
    date: ev.startDate,
    endDate: ev.endDate && ev.endDate > ev.startDate ? ev.endDate : null,
    time: ev.startTime,
    endTime: ev.kind === 'task' ? null : ev.endTime,
    rrule: ruleOf(ev),
    alarms,
    color: isCalendarColor(ev.color) ? ev.color : 'green',
  }
}

function itemToRemote(it: CalendarItem, site: string): RemoteEvent {
  const url = it.to ? `${site}${it.to}` : null
  // Plazos de Hacienda: a 5 días y la víspera a las 9:00; vencimientos, la víspera
  const alarms = it.status === 'done' ? [] : it.layer === 'tax' ? [5 * 1440, 900] : it.type === 'due' ? [900] : []
  return {
    key: it.id,
    uid: `numiq-${it.id.replace(/[^\w-]/g, '_')}`,
    title: icsSummary(it),
    description: [it.subtitle, it.notes, url ? `Abrir en NUMIQ: ${url}` : null].filter(Boolean).join('\n\n') || null,
    location: it.location ?? null,
    url,
    date: it.date,
    endDate: it.endDate ?? null,
    time: it.time ?? null,
    endTime: it.endTime ?? null,
    rrule: null,
    alarms,
    color: it.color,
  }
}

async function desiredEvents(account: Account, company: Company, site: string) {
  const layers = syncLayersOf(account)
  const today = madridToday()
  const from = shiftDays(today, -FROM_DAYS)
  const to = shiftDays(today, UNTIL_DAYS)
  const out: RemoteEvent[] = []
  const others = layers.filter(l => l !== 'event' && l !== 'feed')
  if (others.length) {
    for (const it of await calendarItems(company, from, to, { layers: others })) {
      if (it.type === 'window') continue
      out.push(itemToRemote(it, site))
    }
  }
  if (layers.includes('event')) {
    const e = tables.calendarEvents
    // Todos los que siguen vivos (los que se repiten van como una serie)
    const rows = await useDb().select({ ev: e, contact: tables.contacts.name }).from(e)
      .leftJoin(tables.contacts, eq(tables.contacts.id, e.contactId))
      .where(and(
        eq(e.companyId, company.id),
        or(ne(e.repeat, 'none'), gte(sql`COALESCE(${e.endDate}, ${e.startDate})`, from)),
        or(isNull(e.repeatUntil), gte(e.repeatUntil, from)),
      ))
    for (const r of rows) out.push(eventToRemote(r.ev, site, r.contact))
  }
  return out
}

const hashOf = (r: RemoteEvent) => createHash('sha256').update(JSON.stringify(r)).digest('hex')

// ─── Fechas para fuera ───

function addMinutesTo(date: string, time: string, minutes: number) {
  const [h, m] = time.split(':').map(Number)
  const total = h! * 60 + m! + minutes
  const days = Math.floor(total / 1440)
  const rest = ((total % 1440) + 1440) % 1440
  return { date: shiftDays(date, days), time: `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}` }
}

/** Fin de un evento con hora: la hora final del mismo día (o del último), o una hora después */
function timedEnd(r: RemoteEvent) {
  const endDate = r.endDate ?? r.date
  if (r.endTime && (endDate > r.date || r.endTime > r.time!)) return { date: endDate, time: r.endTime }
  return addMinutesTo(r.date, r.time!, 60)
}

// ─── Proveedores ───

class SyncError extends Error {
  constructor(message: string, readonly status = 0, readonly reconnect = false) {
    super(message)
  }
}

interface Provider {
  /** Comprueba que el calendario sigue ahí; si se borró, lo crea otra vez (y devuelve true) */
  ensureCalendar(): Promise<boolean>
  upsert(r: RemoteEvent, remoteId: string | null): Promise<string>
  remove(remoteId: string): Promise<void>
  /** Al desconectar: quita lo de NUMIQ del calendario conectado */
  teardown(remoteIds: string[]): Promise<void>
}

// ─── Google Calendar ───

const GOOGLE_COLORS: Record<CalendarColor, string> = { brand: '9', violet: '3', sky: '7', teal: '2', green: '10', amber: '5', orange: '6', red: '11', pink: '4', slate: '8' }
export const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.app.created'

export function googleConfig() {
  const c = useRuntimeConfig()
  const clientId = String(c.googleClientId || process.env.NUXT_GOOGLE_CLIENT_ID || '')
  const clientSecret = String(c.googleClientSecret || process.env.NUXT_GOOGLE_CLIENT_SECRET || '')
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

const accessTokens = new Map<number, { token: string, until: number }>()

async function googleToken(account: Account) {
  const cached = accessTokens.get(account.id)
  if (cached && cached.until > Date.now() + 60_000) return cached.token
  const cfg = googleConfig()
  if (!cfg) throw new SyncError('Google Calendar no está configurado en este servidor', 0, true)
  const { refreshToken } = openJson<GoogleSecret>(account.secret)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15_000),
  })
  const j = await res.json().catch(() => ({})) as { access_token?: string, expires_in?: number, error?: string }
  if (!res.ok || !j.access_token) {
    if (j.error === 'invalid_grant') throw new SyncError('Google ha retirado el permiso: vuelve a conectar tu cuenta', 401, true)
    throw new SyncError(`Google no dio acceso (${j.error ?? res.status})`, res.status)
  }
  accessTokens.set(account.id, { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 })
  return j.access_token
}

/** Intercambio del código de la vuelta del consentimiento */
export async function googleExchange(code: string, redirectUri: string) {
  const cfg = googleConfig()!
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15_000),
  })
  const j = await res.json().catch(() => ({})) as { access_token?: string, refresh_token?: string, id_token?: string, error?: string }
  if (!res.ok || !j.access_token) throw new Error(`Google no aceptó la conexión (${j.error ?? res.status})`)
  let email: string | null = null
  if (j.id_token) {
    try {
      email = JSON.parse(Buffer.from(j.id_token.split('.')[1]!, 'base64url').toString('utf8')).email ?? null
    }
    catch {}
  }
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, email }
}

export async function googleCreateCalendar(accessToken: string, name: string) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ summary: name, description: 'Cobros, pagos, plazos de Hacienda y eventos de NUMIQ. Se actualiza solo.', timeZone: 'Europe/Madrid' }),
    signal: AbortSignal.timeout(15_000),
  })
  const j = await res.json().catch(() => ({})) as { id?: string, error?: { message?: string } }
  if (!res.ok || !j.id) throw new Error(`No se pudo crear el calendario en Google (${j.error?.message ?? res.status})`)
  return j.id
}

function googleProvider(account: Account, company: Company, onCalendar: (ref: string) => Promise<void>): Provider {
  let calendarId = account.calendarRef ?? ''
  const api = async (method: string, path: string, body?: unknown) => {
    const token = await googleToken(account)
    const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      method,
      headers: { 'authorization': `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 401) accessTokens.delete(account.id)
    return res
  }
  const fail = async (res: Response, what: string) => {
    const j = await res.json().catch(() => ({})) as { error?: { message?: string } }
    return new SyncError(`${what}: ${j.error?.message ?? res.status}`, res.status, res.status === 401 || res.status === 403)
  }
  const body = (r: RemoteEvent) => {
    let start: Record<string, string>
    let end: Record<string, string>
    if (r.time) {
      const e = timedEnd(r)
      start = { dateTime: `${r.date}T${r.time}:00`, timeZone: 'Europe/Madrid' }
      end = { dateTime: `${e.date}T${e.time}:00`, timeZone: 'Europe/Madrid' }
    }
    else {
      start = { date: r.date }
      end = { date: shiftDays(r.endDate ?? r.date, 1) }
    }
    return {
      summary: r.title,
      description: r.description ?? undefined,
      location: r.location ?? undefined,
      start,
      end,
      recurrence: r.rrule ? [`RRULE:${r.rrule}`] : undefined,
      colorId: GOOGLE_COLORS[r.color],
      transparency: r.time ? 'opaque' : 'transparent',
      reminders: { useDefault: false, overrides: r.alarms.filter(m => m >= 0).slice(0, 5).map(m => ({ method: 'popup', minutes: Math.min(m, 40320) })) },
      extendedProperties: { private: { numiq: r.key } },
      ...(r.url && /^https:\/\//.test(r.url) ? { source: { title: 'NUMIQ', url: r.url } } : {}),
    }
  }
  return {
    async ensureCalendar() {
      if (calendarId) {
        const res = await api('GET', `/calendars/${encodeURIComponent(calendarId)}`)
        if (res.ok) return false
        if (res.status !== 404 && res.status !== 410) throw await fail(res, 'Google Calendar')
      }
      calendarId = await googleCreateCalendar(await googleToken(account), `NUMIQ · ${company.tradeName || company.legalName}`)
      await onCalendar(calendarId)
      return true
    },
    async upsert(r, remoteId) {
      const cal = encodeURIComponent(calendarId)
      if (remoteId) {
        const res = await api('PUT', `/calendars/${cal}/events/${encodeURIComponent(remoteId)}`, body(r))
        if (res.ok) return remoteId
        if (res.status !== 404 && res.status !== 410) throw await fail(res, `No se pudo actualizar «${r.title}»`)
      }
      const res = await api('POST', `/calendars/${cal}/events`, body(r))
      if (!res.ok) throw await fail(res, `No se pudo crear «${r.title}»`)
      return ((await res.json()) as { id: string }).id
    },
    async remove(remoteId) {
      const res = await api('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(remoteId)}`)
      if (!res.ok && res.status !== 404 && res.status !== 410) throw await fail(res, 'No se pudo borrar un evento')
    },
    async teardown(remoteIds) {
      if (calendarId && account.ownsCalendar) {
        await api('DELETE', `/calendars/${encodeURIComponent(calendarId)}`).catch(() => {})
      }
      else {
        for (const id of remoteIds) await this.remove(id).catch(() => {})
      }
      // Retira el permiso en Google: la cuenta deja de aparecer en «Apps con acceso»
      const { refreshToken } = openJson<GoogleSecret>(account.secret)
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => {})
      accessTokens.delete(account.id)
    },
  }
}

// ─── CalDAV (iCloud, Nextcloud, Fastmail, Synology…) ───

export const ICLOUD_CALDAV = 'https://caldav.icloud.com/'
const allowPrivateCaldav = () => process.env.NUXT_CALDAV_ALLOW_PRIVATE === 'true'
const sameSite = (a: URL, b: URL) => a.hostname.split('.').slice(-2).join('.') === b.hostname.split('.').slice(-2).join('.')

/** Petición CalDAV con usuario y contraseña; sigue redirecciones (iCloud manda a su partición) */
async function dav(url: string, method: string, creds: CaldavSecret, opts: { body?: string, depth?: '0' | '1', contentType?: string, headers?: Record<string, string> } = {}) {
  let target = new URL(url)
  const origin = target
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(target, allowPrivateCaldav())
    const res = await fetch(target, {
      method,
      redirect: 'manual',
      headers: {
        ...(sameSite(origin, target) ? { authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}` } : {}),
        ...(opts.depth ? { depth: opts.depth } : {}),
        ...(opts.body ? { 'content-type': opts.contentType ?? 'application/xml; charset=utf-8' } : {}),
        ...opts.headers,
      },
      body: opts.body,
      signal: AbortSignal.timeout(20_000),
    })
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      target = new URL(loc, target)
      continue
    }
    if (res.status === 401) throw new SyncError('Usuario o contraseña de aplicación incorrectos', 401, true)
    return { res, url: target.toString() }
  }
  throw new SyncError('El servidor del calendario redirige demasiadas veces')
}

const PROP_BODY = (props: string) => `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:x="http://apple.com/ns/ical/"><d:prop>${props}</d:prop></d:propfind>`

/** href dentro de una propiedad (current-user-principal, calendar-home-set…) sin depender del prefijo */
function hrefIn(xml: string, prop: string) {
  const m = new RegExp(`<(?:[\\w-]+:)?${prop}\\b[^>]*>\\s*<(?:[\\w-]+:)?href[^>]*>([^<]+)<`, 'i').exec(xml)
  return m ? m[1]!.trim() : null
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Encuentra el espacio de calendarios de la cuenta y crea en él «NUMIQ · Empresa» (o usa uno que se llame NUMIQ) */
export async function caldavDiscover(server: string, creds: CaldavSecret, name: string) {
  const base = new URL(server.trim().replace(/^webcals?:\/\//i, 'https://').replace(/^(?!https?:\/\/)/i, 'https://'))
  if (!['https:', 'http:'].includes(base.protocol)) throw new SyncError('La dirección del servidor debe empezar por https://')
  const principalOf = async (url: string) => {
    const { res, url: final } = await dav(url, 'PROPFIND', creds, { depth: '0', body: PROP_BODY('<d:current-user-principal/>') })
    if (res.status !== 207) return null
    const href = hrefIn(await res.text(), 'current-user-principal')
    return href ? new URL(href, final).toString() : null
  }
  const principal = await principalOf(base.toString()) ?? await principalOf(new URL('/.well-known/caldav', base).toString())
  if (!principal) throw new SyncError('Ese servidor no responde como un calendario CalDAV. Revisa la dirección.')
  const { res: hr, url: hu } = await dav(principal, 'PROPFIND', creds, { depth: '0', body: PROP_BODY('<c:calendar-home-set/>') })
  const homeHref = hr.status === 207 ? hrefIn(await hr.text(), 'calendar-home-set') : null
  if (!homeHref) throw new SyncError('No se encuentran los calendarios de esa cuenta')
  const home = new URL(homeHref, hu).toString().replace(/\/?$/, '/')

  // Calendario propio de NUMIQ
  const collection = `${home}numiq-${randomBytes(5).toString('hex')}/`
  const mk = `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:x="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>${xmlEsc(name)}</d:displayname><x:calendar-color>#4F46E5FF</x:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`
  const { res: mr } = await dav(collection, 'MKCALENDAR', creds, { body: mk })
  if (mr.status === 201 || mr.status === 200) return { calendarRef: collection, owns: true }

  // Sin permiso para crear calendarios: uno que se llame NUMIQ o el primero de eventos
  const { res: lr, url: lu } = await dav(home, 'PROPFIND', creds, { depth: '1', body: PROP_BODY('<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/>') })
  const xml = lr.status === 207 ? await lr.text() : ''
  const calendars = xml.split(/<(?:[\w-]+:)?response[\s>]/i).slice(1)
    .filter(r => /<(?:[\w-]+:)?calendar\s*\/>/i.test(r) && (!/supported-calendar-component-set/i.test(r) || /name="VEVENT"/i.test(r)))
    .map(r => ({ href: /<(?:[\w-]+:)?href[^>]*>([^<]+)</i.exec(r)?.[1]?.trim(), name: /<(?:[\w-]+:)?displayname[^>]*>([^<]*)</i.exec(r)?.[1]?.trim() ?? '' }))
    .filter((c): c is { href: string, name: string } => !!c.href)
  const pick = calendars.find(c => /numiq/i.test(c.name)) ?? calendars[0]
  if (!pick) throw new SyncError('No se pudo crear el calendario «NUMIQ» en tu cuenta. Créalo tú con ese nombre y vuelve a conectar.')
  return { calendarRef: new URL(pick.href, lu).toString().replace(/\/?$/, '/'), owns: false }
}

/** El evento como .ics para CalDAV, con su zona horaria, repetición y avisos */
function remoteIcs(r: RemoteEvent) {
  const compact = (iso: string) => iso.replace(/-/g, '')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ev = ['BEGIN:VEVENT', `UID:${r.uid}`, `DTSTAMP:${stamp}`]
  if (r.time) {
    const e = timedEnd(r)
    ev.push(`DTSTART;TZID=Europe/Madrid:${compact(r.date)}T${r.time.replace(':', '')}00`, `DTEND;TZID=Europe/Madrid:${compact(e.date)}T${e.time.replace(':', '')}00`)
  }
  else {
    ev.push(`DTSTART;VALUE=DATE:${compact(r.date)}`, `DTEND;VALUE=DATE:${compact(shiftDays(r.endDate ?? r.date, 1))}`, 'TRANSP:TRANSPARENT')
  }
  if (r.rrule) ev.push(`RRULE:${r.rrule}`)
  ev.push(`SUMMARY:${icsEscape(r.title)}`)
  if (r.description) ev.push(`DESCRIPTION:${icsEscape(r.description)}`)
  if (r.location) ev.push(`LOCATION:${icsEscape(r.location)}`)
  if (r.url) ev.push(`URL:${r.url}`)
  ev.push(`X-NUMIQ-KEY:${r.key}`)
  for (const m of r.alarms) {
    ev.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(r.title)}`, `TRIGGER:${m >= 0 ? '-' : ''}PT${Math.abs(m)}M`, 'END:VALARM')
  }
  ev.push('END:VEVENT')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NUMIQ//Calendario//ES', 'CALSCALE:GREGORIAN', ...ICS_VTIMEZONE, ...ev, 'END:VCALENDAR']
  return `${lines.map(icsFold).join('\r\n')}\r\n`
}

function caldavProvider(account: Account, company: Company, onCalendar: (ref: string, owns: boolean) => Promise<void>): Provider {
  const creds = openJson<CaldavSecret>(account.secret)
  let collection = account.calendarRef ?? ''
  return {
    async ensureCalendar() {
      if (collection) {
        const { res } = await dav(collection, 'PROPFIND', creds, { depth: '0', body: PROP_BODY('<d:resourcetype/>') })
        if (res.status === 207) return false
        if (res.status !== 404 && res.status !== 410) throw new SyncError(`El servidor del calendario respondió ${res.status}`, res.status)
      }
      const found = await caldavDiscover(account.server ?? ICLOUD_CALDAV, creds, `NUMIQ · ${company.tradeName || company.legalName}`)
      collection = found.calendarRef
      await onCalendar(collection, found.owns)
      return true
    },
    async upsert(r, remoteId) {
      const href = remoteId ?? `${collection}${encodeURIComponent(r.uid)}.ics`
      const { res } = await dav(href, 'PUT', creds, { body: remoteIcs(r), contentType: 'text/calendar; charset=utf-8' })
      if (![200, 201, 204].includes(res.status)) throw new SyncError(`No se pudo guardar «${r.title}» (${res.status})`, res.status)
      return href
    },
    async remove(remoteId) {
      const { res } = await dav(remoteId, 'DELETE', creds)
      if (![200, 204, 404, 410].includes(res.status)) throw new SyncError(`No se pudo borrar un evento (${res.status})`, res.status)
    },
    async teardown(remoteIds) {
      if (collection && account.ownsCalendar) {
        await dav(collection, 'DELETE', creds).catch(() => {})
        return
      }
      for (const id of remoteIds) await this.remove(id).catch(() => {})
    },
  }
}

function providerFor(account: Account, company: Company): Provider {
  const db = useDb()
  // El calendario cambió (se borró fuera y se creó de nuevo): lo apuntado ya no vale
  const onCalendar = async (ref: string, owns = true) => {
    account.calendarRef = ref
    account.ownsCalendar = owns
    await db.update(tables.calendarAccounts).set({ calendarRef: ref, ownsCalendar: owns }).where(eq(tables.calendarAccounts.id, account.id))
    await db.delete(tables.calendarSyncItems).where(eq(tables.calendarSyncItems.accountId, account.id))
  }
  return account.provider === 'google' ? googleProvider(account, company, onCalendar) : caldavProvider(account, company, onCalendar)
}

// ─── Sincronizar ───

export interface SyncResult { ok: boolean, created: number, updated: number, deleted: number, total: number, error?: string }

const running = new Map<number, Promise<SyncResult>>()

/** Una sincronización por cuenta a la vez; si llega otra mientras, se encadena */
export function syncAccount(accountId: number): Promise<SyncResult> {
  const prev = running.get(accountId)
  const next = (prev ?? Promise.resolve()).catch(() => {}).then(() => runSync(accountId))
  running.set(accountId, next)
  next.finally(() => {
    if (running.get(accountId) === next) running.delete(accountId)
  }).catch(() => {})
  return next
}

async function pool<T>(list: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
    while (i < list.length) await fn(list[i++]!)
  }))
}

async function runSync(accountId: number): Promise<SyncResult> {
  const db = useDb()
  const [row] = await db.select({ account: tables.calendarAccounts, company: tables.companies }).from(tables.calendarAccounts)
    .innerJoin(tables.companies, eq(tables.companies.id, tables.calendarAccounts.companyId))
    .where(eq(tables.calendarAccounts.id, accountId))
  if (!row || !row.account.active) return { ok: false, created: 0, updated: 0, deleted: 0, total: 0, error: 'Cuenta desactivada' }
  const { account, company } = row
  const result: SyncResult = { ok: true, created: 0, updated: 0, deleted: 0, total: 0 }
  try {
    const provider = providerFor(account, company)
    await provider.ensureCalendar()
    const site = (useRuntimeConfig().siteUrl || '').replace(/\/+$/, '')
    const desired = await desiredEvents(account, company, site)
    const maps = await db.select().from(tables.calendarSyncItems).where(eq(tables.calendarSyncItems.accountId, account.id))
    const byKey = new Map(maps.map(m => [m.itemKey, m]))
    const wanted = new Set(desired.map(d => d.key))

    await pool(desired, 4, async (r) => {
      const hash = hashOf(r)
      const m = byKey.get(r.key)
      if (m && m.hash === hash) return
      const remoteId = await provider.upsert(r, m?.remoteId ?? null)
      if (m) {
        await db.update(tables.calendarSyncItems).set({ remoteId, hash, date: r.date }).where(eq(tables.calendarSyncItems.id, m.id))
        result.updated++
      }
      else {
        await db.insert(tables.calendarSyncItems).values({ accountId: account.id, itemKey: r.key, remoteId, hash, date: r.date })
        result.created++
      }
    })

    // Lo que ya no está: se borra fuera, salvo lo pasado (se deja como recuerdo) y los eventos que siguen existiendo
    const gone = maps.filter(m => !wanted.has(m.itemKey))
    const ownIds = gone.filter(m => m.itemKey.startsWith('ev-')).map(m => Number(m.itemKey.slice(3)))
    const alive = new Set(ownIds.length ? (await db.select({ id: tables.calendarEvents.id }).from(tables.calendarEvents).where(and(eq(tables.calendarEvents.companyId, company.id), inArray(tables.calendarEvents.id, ownIds)))).map(r => `ev-${r.id}`) : [])
    const layers = syncLayersOf(account)
    const windowFrom = shiftDays(madridToday(), -FROM_DAYS)
    await pool(gone, 4, async (m) => {
      const own = m.itemKey.startsWith('ev-')
      if (own && alive.has(m.itemKey) && layers.includes('event')) return
      // Pasado y fuera de la ventana: deja de seguirse, pero no se borra del calendario
      if (!own && m.date && m.date < windowFrom) {
        await db.delete(tables.calendarSyncItems).where(eq(tables.calendarSyncItems.id, m.id))
        return
      }
      await provider.remove(m.remoteId)
      await db.delete(tables.calendarSyncItems).where(eq(tables.calendarSyncItems.id, m.id))
      result.deleted++
    })
    const [{ n }] = await db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(tables.calendarSyncItems).where(eq(tables.calendarSyncItems.accountId, account.id)) as [{ n: number }]
    result.total = n
    await db.update(tables.calendarAccounts).set({ lastSyncAt: new Date(), lastError: null, syncedCount: n }).where(eq(tables.calendarAccounts.id, account.id))
    return result
  }
  catch (err) {
    const message = (err as Error).name === 'TimeoutError' ? 'El calendario tarda demasiado en responder' : (err as Error).message || 'No se pudo sincronizar'
    await db.update(tables.calendarAccounts).set({ lastSyncAt: new Date(), lastError: message.slice(0, 400) }).where(eq(tables.calendarAccounts.id, account.id))
    return { ...result, ok: false, error: message }
  }
}

/** Desconecta: quita lo de NUMIQ del calendario conectado (o su calendario entero) y borra la cuenta */
export async function disconnectAccount(account: Account) {
  const db = useDb()
  const [company] = await db.select().from(tables.companies).where(eq(tables.companies.id, account.companyId))
  const maps = await db.select({ remoteId: tables.calendarSyncItems.remoteId }).from(tables.calendarSyncItems).where(eq(tables.calendarSyncItems.accountId, account.id))
  if (company) {
    try {
      await providerFor(account, company).teardown(maps.map(m => m.remoteId))
    }
    catch (err) {
      console.warn('[calendario] desconectar', (err as Error).message)
    }
  }
  await db.delete(tables.calendarSyncItems).where(eq(tables.calendarSyncItems.accountId, account.id))
  await db.delete(tables.calendarAccounts).where(eq(tables.calendarAccounts.id, account.id))
}

// ─── Al momento: tras cambiar un evento ───

const pending = new Map<number, ReturnType<typeof setTimeout>>()

/** Sincroniza en segundo plano (agrupando cambios seguidos) las cuentas conectadas de la empresa */
export function scheduleCalendarPush(companyId: number, delay = 1200) {
  clearTimeout(pending.get(companyId))
  pending.set(companyId, setTimeout(async () => {
    pending.delete(companyId)
    try {
      const accounts = await useDb().select({ id: tables.calendarAccounts.id, layers: tables.calendarAccounts.layers }).from(tables.calendarAccounts)
        .where(and(eq(tables.calendarAccounts.companyId, companyId), eq(tables.calendarAccounts.active, true)))
      for (const a of accounts) {
        if (syncLayersOf(a).includes('event')) await syncAccount(a.id)
      }
    }
    catch (err) {
      console.warn('[calendario] sincronizar', (err as Error).message)
    }
  }, delay))
}

/** Cuentas que tocan sincronizar (plugin): las que hace más de `minutes` que no se sincronizan */
export async function dueAccounts(minutes: number) {
  const limit = new Date(Date.now() - minutes * 60_000)
  return useDb().select({ id: tables.calendarAccounts.id }).from(tables.calendarAccounts)
    .where(and(eq(tables.calendarAccounts.active, true), or(isNull(tables.calendarAccounts.lastSyncAt), lte(tables.calendarAccounts.lastSyncAt, limit))))
}

export function accountDto(a: Account) {
  return {
    id: a.id,
    provider: a.provider,
    label: a.label,
    server: a.provider === 'caldav' ? a.server : null,
    layers: syncLayersOf(a),
    active: a.active,
    lastSyncAt: a.lastSyncAt,
    lastError: a.lastError,
    syncedCount: a.syncedCount,
    createdAt: a.createdAt,
  }
}
