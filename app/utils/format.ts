// useGrouping 'always': en es-ES 1102,87 € saldría sin punto de miles (solo agrupa desde 5 cifras)
const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })
const eurFmt0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' })
const numFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' })
const compactFmt = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 })

/** 1.234,56 € */
export const eur = (n: number | null | undefined, decimals = true) => (decimals ? eurFmt : eurFmt0).format(Number(n) || 0)

/** 12,3 mil € — para ejes de gráficos y tarjetas estrechas */
export const eurCompact = (n: number) => `${compactFmt.format(n)} €`

export const num = (n: number | null | undefined) => numFmt.format(Number(n) || 0)

export const pct = (n: number | null | undefined, digits = 0) =>
  `${(Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`

const asDate = (d: string | Date) => (typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00` : d) : d)

/** 22 oct 2026 */
export const fdate = (d: string | Date | null | undefined) =>
  d ? asDate(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '') : '—'

/** 22/10/2026 */
export const fdateShort = (d: string | Date | null | undefined) =>
  d ? asDate(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

/** oct · con `long`: Octubre 2026 (sin el «de» que pone el navegador) */
export const fmonth = (ym: string, long = false) => {
  const d = new Date(`${ym}-15T12:00:00`)
  if (!long) return d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')
  const m = d.toLocaleDateString('es-ES', { month: 'long' })
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${d.getFullYear()}`
}

export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Días desde hoy hasta la fecha (negativo = pasada) */
export const daysUntil = (iso: string) => {
  const a = new Date(`${todayISO()}T12:00:00`).getTime()
  const b = new Date(`${iso}T12:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** "vence hoy", "en 5 días", "hace 3 días" */
export const relDays = (iso: string) => {
  const n = daysUntil(iso)
  if (n === 0) return 'hoy'
  if (n === 1) return 'mañana'
  if (n === -1) return 'ayer'
  return n > 0 ? `en ${n} días` : `hace ${-n} días`
}

export const initials = (name: string) =>
  name.replace(/\b(SL|SA|SLP|SLU|SCP|CB|SAU)\b\.?/gi, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')

/** Color estable a partir de un texto (avatares) */
export const hueOf = (s: string) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export const delta = (value: number, previous: number) => {
  if (!previous) return null
  return (value - previous) / Math.abs(previous)
}

/** "hace un momento", "hace 5 min", "hace 2 h", "ayer", "el 3 oct" */
export const relTime = (d: string | Date) => {
  const t = (typeof d === 'string' ? new Date(d) : d).getTime()
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'hace un momento'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`
  if (s < 172_800) return 'ayer'
  return `el ${fdate(new Date(t))}`
}
