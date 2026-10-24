/**
 * Fechas de los documentos recurrentes. Mismo cálculo en el formulario (vista previa) y en el
 * servidor (lo que se genera). Las mensualidades se anclan al día de la primera fecha:
 * 31 ene → 29 feb → 31 mar, nunca se "desliza" al 28.
 */

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

const UNIT_MONTHS: Record<Frequency, number> = { weekly: 0, monthly: 1, quarterly: 3, yearly: 12 }

function ymd(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return [y!, m!, d!] as const
}

const isoOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** Suma días a una fecha 'AAAA-MM-DD' sin pasar por zonas horarias */
export function shiftDays(iso: string, days: number) {
  const [y, m, d] = ymd(iso)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** Suma meses conservando el día de anclaje: 31 ene + 1 = 28/29 feb */
export function addMonthsAnchored(start: string, months: number) {
  const [y, m, d] = ymd(start)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return isoOf(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

/** Fecha siguiente a `current` en la serie que empezó en `start` */
export function nextOccurrence(start: string, frequency: Frequency, interval: number, current: string) {
  const step = Math.max(1, Math.round(interval) || 1)
  if (frequency === 'weekly') return shiftDays(current, 7 * step)
  const unit = UNIT_MONTHS[frequency] * step
  const [sy, sm] = ymd(start)
  const [cy, cm] = ymd(current)
  let k = Math.max(1, Math.floor(((cy - sy) * 12 + (cm - sm)) / unit) + 1)
  let next = addMonthsAnchored(start, k * unit)
  while (next <= current) next = addMonthsAnchored(start, ++k * unit)
  return next
}

/** Próximas fechas desde `from` (incluida), hasta `n` o hasta la fecha final */
export function upcomingOccurrences(start: string, frequency: Frequency, interval: number, from: string, n: number, end?: string | null) {
  const out: string[] = []
  let d = from
  while (out.length < n && (!end || d <= end)) {
    out.push(d)
    d = nextOccurrence(start, frequency, interval, d)
  }
  return out
}

/** Cuántas veces al mes ocurre (para pasar a importe mensual) */
export function monthlyEquivalent(frequency: Frequency, interval: number) {
  const step = Math.max(1, interval)
  return frequency === 'weekly' ? 52 / 12 / step : 1 / (UNIT_MONTHS[frequency] * step)
}

/** "Cada mes", "Cada 2 semanas", "Cada trimestre"… */
export function frequencyLabel(frequency: Frequency, interval = 1) {
  const n = Math.max(1, interval)
  const one: Record<Frequency, string> = { weekly: 'Cada semana', monthly: 'Cada mes', quarterly: 'Cada trimestre', yearly: 'Cada año' }
  const many: Record<Frequency, string> = { weekly: 'semanas', monthly: 'meses', quarterly: 'trimestres', yearly: 'años' }
  return n === 1 ? one[frequency] : `Cada ${n} ${many[frequency]}`
}
