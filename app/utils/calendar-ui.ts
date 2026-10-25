import type { CalendarItem } from '#shared/utils/calendar'

/** Color CSS de una clave del calendario (claro u oscuro según el tema) */
export const calColor = (key: string | null | undefined) => `var(--cal-${key || 'brand'})`

const asDay = (iso: string) => new Date(`${iso}T12:00:00`)
const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`

/** Martes, 28 de octubre (con el año si no es el actual) */
export function longDate(iso: string, withYear = false) {
  const d = asDay(iso)
  const s = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', ...(withYear || d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
  return cap(s)
}

/** 28 oct */
export const dayMonth = (iso: string) => asDay(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')

export const weekdayShort = (iso: string) => asDay(iso).toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')

/** Octubre 2026 */
export const monthTitle = (ym: string) => fmonth(ym, true)

export const monthName = (ym: string) => cap(asDay(`${ym}-15`).toLocaleDateString('es-ES', { month: 'long' }))

export function addMonthsYm(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number)
  const t = y! * 12 + (m! - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
export const WEEKDAYS_MID = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

/** Lista de días AAAA-MM-DD de `from` a `to`, incluidos */
export function daysOf(from: string, to: string) {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDays(d, 1)) out.push(d)
  return out
}

/** ¿Cae el elemento en ese día? (los de varios días, en todos los que dura) */
export const onDay = (it: CalendarItem, day: string) => it.date === day || (!!it.endDate && it.date <= day && it.endDate >= day)

export const isMultiDay = (it: CalendarItem) => !!it.endDate && it.endDate > it.date

export function timeRange(it: CalendarItem) {
  if (!it.time) return null
  return it.endTime ? `${it.time}–${it.endTime}` : it.time
}

export const STATUS_LABEL: Record<string, { label: string, tone: 'danger' | 'warning' | 'success' | 'brand' }> = {
  overdue: { label: 'Vencido', tone: 'danger' },
  today: { label: 'Hoy', tone: 'warning' },
  pending: { label: 'Pendiente', tone: 'brand' },
  done: { label: 'Hecho', tone: 'success' },
}

/** Estado legible según lo que es (un plazo presentado, una factura cobrada…) */
export function statusText(it: CalendarItem) {
  if (!it.status) return null
  if (it.status === 'done') {
    if (it.layer === 'tax') return 'Presentado'
    if (it.layer === 'income') return 'Cobrada'
    if (it.layer === 'expense') return 'Pagado'
    if (it.layer === 'quote') return 'Aceptado'
    return 'Hecha'
  }
  if (it.status === 'overdue') return it.layer === 'tax' ? 'Fuera de plazo' : it.type === 'task' ? 'Sin hacer' : 'Vencido'
  if (it.status === 'today') return 'Hoy'
  if (it.layer === 'recurring') return 'Previsto'
  return it.layer === 'tax' ? 'Por presentar' : 'Pendiente'
}

// ─── Llevar un elemento a otro calendario ───

const compact = (iso: string) => iso.replace(/-/g, '')

function details(it: CalendarItem) {
  const url = it.to ? `${location.origin}${it.to}` : null
  return [it.subtitle, it.amount ? eur(it.amount) : null, it.notes, url ? `Abrir en NUMIQ: ${url}` : null].filter(Boolean).join('\n\n')
}

/** Enlace «Añadir a Google Calendar» con el evento ya rellenado */
export function googleEventUrl(it: CalendarItem) {
  const end = it.endDate ?? it.date
  const dates = it.time
    ? `${compact(it.date)}T${it.time.replace(':', '')}00/${compact(end)}T${(it.endTime ?? it.time).replace(':', '')}00`
    : `${compact(it.date)}/${compact(shiftDays(end, 1))}`
  const q = new URLSearchParams({ action: 'TEMPLATE', text: it.title, dates, details: details(it), ctz: 'Europe/Madrid' })
  if (it.location) q.set('location', it.location)
  return `https://calendar.google.com/calendar/render?${q}`
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Un .ics con ese único evento (Apple Calendar, Outlook…) */
export function itemIcs(it: CalendarItem) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NUMIQ//Calendario//ES', 'BEGIN:VEVENT', `UID:${it.id}@numiq`, `DTSTAMP:${stamp}`]
  if (it.time) {
    lines.push(`DTSTART;TZID=Europe/Madrid:${compact(it.date)}T${it.time.replace(':', '')}00`)
    lines.push(`DTEND;TZID=Europe/Madrid:${compact(it.endDate ?? it.date)}T${(it.endTime ?? it.time).replace(':', '')}00`)
  }
  else {
    lines.push(`DTSTART;VALUE=DATE:${compact(it.date)}`, `DTEND;VALUE=DATE:${compact(shiftDays(it.endDate ?? it.date, 1))}`)
  }
  lines.push(`SUMMARY:${esc(it.title)}`)
  const d = details(it)
  if (d) lines.push(`DESCRIPTION:${esc(d)}`)
  if (it.location) lines.push(`LOCATION:${esc(it.location)}`)
  if (it.layer === 'tax' || it.type === 'due') lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.title)}`, 'TRIGGER:-PT15H', 'END:VALARM')
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' })
}
