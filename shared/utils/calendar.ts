/**
 * Calendario de NUMIQ: lo que se ve cada día (facturas, gastos, plazos de Hacienda, recurrentes,
 * festivos y eventos propios). Mismos tipos en la pantalla, en la API y en la suscripción .ics.
 */
import { nextOccurrence, shiftDays } from './recurrence'

export type CalendarLayer = 'income' | 'expense' | 'tax' | 'quote' | 'recurring' | 'event' | 'holiday' | 'feed'

export const CALENDAR_LAYERS: ReadonlyArray<{ key: Exclude<CalendarLayer, 'feed'>, label: string, icon: string, color: CalendarColor, hint: string }> = [
  { key: 'income', label: 'Cobros', icon: 'ph:receipt', color: 'brand', hint: 'Facturas emitidas, vencimientos y cobros' },
  { key: 'expense', label: 'Pagos', icon: 'ph:wallet', color: 'amber', hint: 'Gastos, vencimientos y pagos' },
  { key: 'tax', label: 'Hacienda', icon: 'ph:bank', color: 'red', hint: 'Plazos de los modelos de la AEAT' },
  { key: 'quote', label: 'Presupuestos', icon: 'ph:file-text', color: 'sky', hint: 'Enviados y fecha de validez' },
  { key: 'recurring', label: 'Recurrentes', icon: 'ph:arrows-clockwise', color: 'violet', hint: 'Facturas y gastos fijos previstos' },
  { key: 'event', label: 'Mis eventos', icon: 'ph:calendar-check', color: 'green', hint: 'Citas, reuniones y tareas' },
  { key: 'holiday', label: 'Festivos', icon: 'ph:confetti', color: 'pink', hint: 'Festivos nacionales' },
]

/** Lo que se publica en la suscripción si no se elige nada */
export const DEFAULT_FEED_LAYERS: CalendarLayer[] = ['income', 'expense', 'tax', 'quote', 'recurring', 'event']

export type CalendarColor = 'brand' | 'violet' | 'sky' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'pink' | 'slate'

/** Paleta (los tonos claro y oscuro están en tokens.css como --cal-<clave>) */
export const CALENDAR_COLORS: ReadonlyArray<{ key: CalendarColor, label: string }> = [
  { key: 'brand', label: 'Índigo' },
  { key: 'violet', label: 'Violeta' },
  { key: 'sky', label: 'Cielo' },
  { key: 'teal', label: 'Turquesa' },
  { key: 'green', label: 'Verde' },
  { key: 'amber', label: 'Ámbar' },
  { key: 'orange', label: 'Naranja' },
  { key: 'red', label: 'Rojo' },
  { key: 'pink', label: 'Rosa' },
  { key: 'slate', label: 'Grafito' },
]

export const isCalendarColor = (v: unknown): v is CalendarColor => CALENDAR_COLORS.some(c => c.key === v)

export interface CalendarItem {
  /** Estable entre cargas: inv-12-due, ev-4-2026-10-25… */
  id: string
  layer: CalendarLayer
  /** issue, due, paid, deadline, window, run, event, task, holiday… */
  type: string
  title: string
  subtitle?: string | null
  date: string
  /** Último día incluido si dura varios */
  endDate?: string | null
  time?: string | null
  endTime?: string | null
  amount?: number | null
  /** Signo del importe: entra o sale */
  flow?: 'in' | 'out' | null
  status?: 'overdue' | 'pending' | 'done' | 'today' | null
  color: CalendarColor
  icon: string
  /** Pantalla de NUMIQ que lo abre */
  to?: string | null
  location?: string | null
  notes?: string | null
  /** Evento propio (editable) y repetición concreta */
  eventId?: number | null
  occurrence?: string | null
  feedId?: number | null
  done?: boolean
  repeat?: string | null
}

// ─── Festivos nacionales ───

/** Domingo de Pascua (algoritmo de Meeus/Butcher) */
function easter(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Festivos comunes a toda España (los autonómicos y locales cambian cada año y no se incluyen) */
export function nationalHolidays(year: number): Array<{ date: string, name: string }> {
  const d = (m: number, day: number) => `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return [
    { date: d(1, 1), name: 'Año Nuevo' },
    { date: d(1, 6), name: 'Epifanía del Señor' },
    { date: shiftDays(easter(year), -2), name: 'Viernes Santo' },
    { date: d(5, 1), name: 'Fiesta del Trabajo' },
    { date: d(8, 15), name: 'Asunción de la Virgen' },
    { date: d(10, 12), name: 'Fiesta Nacional de España' },
    { date: d(11, 1), name: 'Todos los Santos' },
    { date: d(12, 6), name: 'Día de la Constitución' },
    { date: d(12, 8), name: 'Inmaculada Concepción' },
    { date: d(12, 25), name: 'Navidad' },
  ]
}

// ─── Repeticiones de los eventos propios ───

export type EventRepeat = 'none' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export const REPEAT_LABELS: Record<EventRepeat, string> = {
  none: 'No se repite',
  weekly: 'Cada semana',
  monthly: 'Cada mes',
  quarterly: 'Cada trimestre',
  yearly: 'Cada año',
}

/** Días en que cae un evento propio dentro de [from, to] (fecha de inicio de cada repetición) */
export function eventOccurrences(ev: { startDate: string, endDate?: string | null, repeat: EventRepeat, repeatInterval?: number | null, repeatUntil?: string | null }, from: string, to: string) {
  const span = ev.endDate && ev.endDate > ev.startDate ? daysBetween(ev.startDate, ev.endDate) : 0
  if (ev.repeat === 'none') return ev.startDate <= to && shiftDays(ev.startDate, span) >= from ? [ev.startDate] : []
  const out: string[] = []
  const until = ev.repeatUntil && ev.repeatUntil < to ? ev.repeatUntil : to
  let d = ev.startDate
  // Salto rápido hasta cerca de `from` sin recorrer años de repeticiones semanales
  if (ev.repeat === 'weekly' && d < from) {
    const step = 7 * Math.max(1, ev.repeatInterval ?? 1)
    const jumps = Math.max(0, Math.floor((daysBetween(d, from) - span) / step) - 1)
    d = shiftDays(d, jumps * step)
  }
  for (let guard = 0; d <= until && guard < 2000; guard++) {
    if (shiftDays(d, span) >= from) out.push(d)
    d = nextOccurrence(ev.startDate, ev.repeat, ev.repeatInterval ?? 1, d)
  }
  return out
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

/** Lunes de la semana de una fecha */
export function weekStart(iso: string) {
  const dow = (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7
  return shiftDays(iso, -dow)
}

/** Primer y último día que muestra la cuadrícula de un mes (semanas completas, de lunes a domingo) */
export function monthGrid(ym: string) {
  const first = `${ym}-01`
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
  const from = weekStart(first)
  const to = shiftDays(weekStart(last), 6)
  return { from, to, first, last }
}
