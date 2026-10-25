import type { CalendarItem } from '../../shared/utils/calendar'
import type { FeedEvent } from '../db/schema'

/**
 * iCalendar (RFC 5545): la suscripción que se añade a Google, Apple u Outlook y la lectura de
 * calendarios externos para verlos dentro de NUMIQ.
 */

// ─── Escritura ───

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Líneas de 75 octetos como máximo; las siguientes empiezan por un espacio */
function fold(line: string) {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8')
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur)
      cur = ''
      size = 0
    }
    cur += ch
    size += n
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

const compact = (iso: string) => iso.replace(/-/g, '')
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Zona de Madrid con sus reglas de horario de verano (para las horas de los eventos) */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Madrid',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

const eurText = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)} €`

/** Título en el calendario del móvil: con importe y una marca para distinguir de un vistazo */
function summaryOf(it: CalendarItem) {
  const mark = it.status === 'done' ? '✓ ' : it.layer === 'tax' ? '⚠ ' : ''
  const amount = it.amount ? ` · ${it.flow === 'out' ? '−' : it.flow === 'in' ? '+' : ''}${eurText(it.amount)}` : ''
  return `${mark}${it.title}${amount}`
}

export function itemsToIcs(items: CalendarItem[], opts: { name: string, site: string, description?: string }) {
  const now = stamp(new Date())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NUMIQ//Calendario//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(opts.name)}`,
    `NAME:${esc(opts.name)}`,
    'X-WR-TIMEZONE:Europe/Madrid',
    ...(opts.description ? [`X-WR-CALDESC:${esc(opts.description)}`] : []),
    // Cada hora (Google lo actualiza a su ritmo, Apple y Outlook lo respetan)
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    'COLOR:indigo',
    ...VTIMEZONE,
  ]
  for (const it of items) {
    // La franja del plazo no se publica: en el móvil basta el último día con su aviso
    if (it.type === 'window') continue
    const ev = ['BEGIN:VEVENT', `UID:${it.id}@numiq`, `DTSTAMP:${now}`]
    if (it.time) {
      ev.push(`DTSTART;TZID=Europe/Madrid:${compact(it.date)}T${it.time.replace(':', '')}00`)
      const endDate = it.endDate ?? it.date
      const endTime = it.endTime ?? addMinutes(it.time, 60)
      const rolled = !it.endTime && endTime < it.time
      ev.push(`DTEND;TZID=Europe/Madrid:${compact(rolled ? shiftDays(endDate, 1) : endDate)}T${endTime.replace(':', '')}00`)
    }
    else {
      ev.push(`DTSTART;VALUE=DATE:${compact(it.date)}`, `DTEND;VALUE=DATE:${compact(shiftDays(it.endDate ?? it.date, 1))}`, 'TRANSP:TRANSPARENT')
    }
    ev.push(`SUMMARY:${esc(summaryOf(it))}`)
    const url = it.to ? `${opts.site}${it.to}` : null
    const desc = [it.subtitle, it.notes, url ? `Abrir en NUMIQ: ${url}` : null].filter(Boolean).join('\n\n')
    if (desc) ev.push(`DESCRIPTION:${esc(desc)}`)
    if (url) ev.push(`URL:${url}`)
    if (it.location) ev.push(`LOCATION:${esc(it.location)}`)
    ev.push(`CATEGORIES:${esc(LAYER_NAMES[it.layer] ?? 'NUMIQ')}`)
    if (it.status === 'done' && it.layer === 'event') ev.push('STATUS:CONFIRMED')
    // Avisos en el dispositivo: plazos de Hacienda a 5 días y el mismo día; vencimientos el día antes
    if (it.layer === 'tax' && it.status !== 'done') ev.push(...alarm('-P5D', it.title), ...alarm('-PT15H', it.title))
    else if (it.type === 'due' && it.status !== 'done') ev.push(...alarm('-PT15H', it.title))
    ev.push('END:VEVENT')
    lines.push(...ev)
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}

const LAYER_NAMES: Record<string, string> = { income: 'Cobros', expense: 'Pagos', tax: 'Hacienda', quote: 'Presupuestos', recurring: 'Recurrentes', event: 'Eventos', holiday: 'Festivos', feed: 'Externo' }

const alarm = (trigger: string, text: string) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(text)}`, `TRIGGER:${trigger}`, 'END:VALARM']

function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number)
  const t = (h! * 60 + m! + minutes) % (24 * 60)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

// ─── Lectura ───

interface Prop { name: string, params: Record<string, string>, value: string }

const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

function parseLine(line: string): Prop | null {
  // NOMBRE;PARAM=valor;PARAM="valor:con:dos puntos":VALOR
  let i = 0
  let inQuote = false
  for (; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) break
  }
  if (i >= line.length) return null
  const head = line.slice(0, i)
  const value = line.slice(i + 1)
  const [rawName, ...rawParams] = head.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)
  const params: Record<string, string> = {}
  for (const p of rawParams) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: rawName!.toUpperCase(), params, value }
}

interface RawEvent { props: Prop[] }

function parseComponents(text: string) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
  const events: RawEvent[] = []
  let cur: RawEvent | null = null
  let depth = 0
  for (const line of lines) {
    if (!line) continue
    const up = line.toUpperCase()
    if (up === 'BEGIN:VEVENT') {
      cur = { props: [] }
      depth = 0
      continue
    }
    if (!cur) continue
    if (up.startsWith('BEGIN:')) {
      depth++
      continue
    }
    if (up.startsWith('END:')) {
      if (up === 'END:VEVENT' && depth === 0) {
        events.push(cur)
        cur = null
      }
      else depth = Math.max(0, depth - 1)
      continue
    }
    if (depth > 0) continue // VALARM y similares
    const p = parseLine(line)
    if (p) cur.props.push(p)
  }
  return events
}

interface When { date: string, time: string | null, tz: string | null, utc: boolean }

/** Valor de fecha iCal → fecha y hora de pared en su zona */
function parseWhen(p: Prop | undefined): When | null {
  if (!p) return null
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(p.value.trim())
  if (!m) return null
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[4] ? `${m[4]}:${m[5]}` : null,
    tz: p.params.TZID ?? null,
    utc: !!m[7],
  }
}

const validZone = (tz: string | null) => {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  }
  catch {
    return false
  }
}

/** Hora de pared en Madrid de un momento (date + time en su zona o en UTC) */
function toMadrid(date: string, time: string, w: Pick<When, 'tz' | 'utc'>) {
  if (!w.utc && (!w.tz || !validZone(w.tz) || w.tz === 'Europe/Madrid')) return { date, time }
  const instant = w.utc ? new Date(`${date}T${time}:00Z`) : zonedToDate(date, time, w.tz!)
  const r = wallClock(instant)
  return { date: r.date, time: r.time }
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay()
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Días de un mes que cumplen BYDAY (2MO, -1FR, MO…) */
function monthByDay(y: number, m: number, rules: string[]) {
  const out: string[] = []
  const n = daysInMonth(y, m)
  for (const r of rules) {
    const mm = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(r)
    if (!mm) continue
    const wd = WEEKDAYS.indexOf(mm[2]!)
    const days: number[] = []
    for (let d = 1; d <= n; d++) if (dow(isoOf(y, m, d)) === wd) days.push(d)
    const ord = mm[1] ? Number(mm[1]) : 0
    if (!ord) days.forEach(d => out.push(isoOf(y, m, d)))
    else {
      const pick = ord > 0 ? days[ord - 1] : days[days.length + ord]
      if (pick) out.push(isoOf(y, m, pick))
    }
  }
  return out
}

/** Fechas de inicio de una regla RRULE (en el día de pared de la zona del evento) dentro de la ventana */
function expandRule(start: string, rule: string, until: string, limit = 800) {
  const r = Object.fromEntries(rule.split(';').map(kv => kv.split('=')).filter(kv => kv.length === 2).map(([k, v]) => [k!.toUpperCase(), v!.toUpperCase()]))
  const freq = r.FREQ
  const interval = Math.max(1, Number(r.INTERVAL) || 1)
  const count = r.COUNT ? Number(r.COUNT) : Infinity
  const ruleUntil = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : null
  const end = ruleUntil && ruleUntil < until ? ruleUntil : until
  const byDay = r.BYDAY ? r.BYDAY.split(',') : []
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : []
  const byMonth = r.BYMONTH ? r.BYMONTH.split(',').map(Number) : []
  const out: string[] = []
  let produced = 0
  const push = (d: string) => {
    if (d < start || produced >= count) return false
    produced++
    if (d > end) return false
    out.push(d)
    return true
  }
  const [sy, sm, sd] = start.split('-').map(Number) as [number, number, number]
  if (freq === 'DAILY') {
    for (let d = start, i = 0; d <= end && produced < count && i < 5000; d = shiftDays(d, interval), i++) {
      if (byDay.length && !byDay.some(b => WEEKDAYS.indexOf(b.replace(/^[+-]?\d+/, '')) === dow(d))) continue
      if (byMonth.length && !byMonth.includes(Number(d.slice(5, 7)))) continue
      push(d)
    }
  }
  else if (freq === 'WEEKLY') {
    const days = byDay.length ? byDay.map(b => WEEKDAYS.indexOf(b.replace(/^[+-]?\d+/, ''))).filter(x => x >= 0) : [dow(start)]
    // Semanas de lunes a domingo (WKST=MO por defecto en Google y Outlook)
    let week = shiftDays(start, -((dow(start) + 6) % 7))
    for (let i = 0; week <= end && produced < count && i < 3000; i++, week = shiftDays(week, 7 * interval)) {
      for (const wd of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) push(shiftDays(week, (wd + 6) % 7))
    }
  }
  else if (freq === 'MONTHLY') {
    for (let i = 0; produced < count && i < 1200; i += interval) {
      const total = sy * 12 + (sm - 1) + i
      const y = Math.floor(total / 12)
      const m = (total % 12) + 1
      if (isoOf(y, m, 1) > end) break
      let days: string[]
      if (byDay.length) days = monthByDay(y, m, byDay)
      else if (byMonthDay.length) days = byMonthDay.map(d => (d < 0 ? daysInMonth(y, m) + d + 1 : d)).filter(d => d >= 1 && d <= daysInMonth(y, m)).map(d => isoOf(y, m, d))
      else days = sd <= daysInMonth(y, m) ? [isoOf(y, m, sd)] : []
      if (r.BYSETPOS && days.length) {
        const pos = Number(r.BYSETPOS)
        const sorted = days.sort()
        days = [pos > 0 ? sorted[pos - 1] : sorted[sorted.length + pos]].filter((x): x is string => !!x)
      }
      for (const d of days.sort()) push(d)
    }
  }
  else if (freq === 'YEARLY') {
    for (let y = sy, i = 0; produced < count && i < 200; y += interval, i++) {
      if (isoOf(y, 1, 1) > end) break
      const months = byMonth.length ? byMonth : [sm]
      for (const m of months) {
        let days: string[]
        if (byDay.length) days = monthByDay(y, m, byDay)
        else if (byMonthDay.length) days = byMonthDay.filter(d => d >= 1 && d <= daysInMonth(y, m)).map(d => isoOf(y, m, d))
        else days = sd <= daysInMonth(y, m) ? [isoOf(y, m, sd)] : []
        for (const d of days.sort()) push(d)
      }
    }
  }
  else {
    push(start)
  }
  return out.slice(0, limit)
}

/** Eventos de un .ics en hora de Madrid, con las repeticiones ya expandidas en [from, to] */
export function parseIcs(text: string, from: string, to: string, max = 4000): FeedEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('No es un calendario iCal (.ics)')
  const raw = parseComponents(text)
  const out: FeedEvent[] = []
  // Repeticiones cambiadas a mano: sustituyen a la original de ese día
  const overridden = new Set<string>()
  for (const ev of raw) {
    const rid = ev.props.find(p => p.name === 'RECURRENCE-ID')
    const uid = ev.props.find(p => p.name === 'UID')?.value
    const w = parseWhen(rid)
    if (rid && uid && w) overridden.add(`${uid}|${w.date}`)
  }
  for (const ev of raw) {
    const get = (n: string) => ev.props.find(p => p.name === n)
    if ((get('STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') continue
    const start = parseWhen(get('DTSTART'))
    if (!start) continue
    const uid = get('UID')?.value || `${start.date}-${get('SUMMARY')?.value ?? ''}`
    const end = parseWhen(get('DTEND'))
    const duration = get('DURATION')?.value
    const title = unesc(get('SUMMARY')?.value ?? '').trim() || '(Sin título)'
    const location = unesc(get('LOCATION')?.value ?? '').trim() || null
    const notes = unesc(get('DESCRIPTION')?.value ?? '').trim().slice(0, 2000) || null
    // Duración en días (todo el día: DTEND es exclusivo) o en minutos
    let spanDays = 0
    let spanMinutes = 60
    if (!start.time) {
      if (end) spanDays = Math.max(0, daysBetween(start.date, end.date) - 1)
      else if (duration) spanDays = Math.max(0, (Number(/(\d+)D/.exec(duration)?.[1]) || 1) - 1)
    }
    else if (end?.time) {
      spanMinutes = Math.max(0, Math.round((Date.parse(`${end.date}T${end.time}:00Z`) - Date.parse(`${start.date}T${start.time}:00Z`)) / 60_000))
    }
    else if (duration) {
      const d = /P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(duration)
      if (d) spanMinutes = (Number(d[1] ?? 0) * 7 * 1440) + (Number(d[2] ?? 0) * 1440) + (Number(d[3] ?? 0) * 60) + Number(d[4] ?? 0)
    }
    const exdates = new Set(ev.props.filter(p => p.name === 'EXDATE').flatMap(p => p.value.split(',').map(v => parseWhen({ ...p, value: v })?.date)).filter((x): x is string => !!x))
    const rrule = get('RRULE')?.value
    const isOverride = !!get('RECURRENCE-ID')
    // Ventana algo más amplia para no perder lo que empieza antes y sigue dentro
    const lookback = shiftDays(from, -Math.max(spanDays, 1))
    const starts = rrule && !isOverride ? expandRule(start.date, rrule, to) : [start.date]
    for (const d of starts) {
      if (rrule && !isOverride && (exdates.has(d) || overridden.has(`${uid}|${d}`))) continue
      if (d < lookback || d > to) continue
      let item: FeedEvent
      if (!start.time) {
        item = { uid: `${uid}|${d}`, title, date: d, endDate: spanDays ? shiftDays(d, spanDays) : null, time: null, endTime: null, location, notes }
      }
      else {
        const s = toMadrid(d, start.time, start)
        const endInstant = new Date(Date.parse(`${d}T${start.time}:00Z`) + spanMinutes * 60_000)
        const eWall = { date: endInstant.toISOString().slice(0, 10), time: endInstant.toISOString().slice(11, 16) }
        const e = toMadrid(eWall.date, eWall.time, start)
        item = { uid: `${uid}|${d}`, title, date: s.date, endDate: e.date > s.date ? e.date : null, time: s.time, endTime: e.time, location, notes }
      }
      if ((item.endDate ?? item.date) < from || item.date > to) continue
      out.push(item)
      if (out.length >= max) return out
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
}
