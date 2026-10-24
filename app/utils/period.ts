import type { Quarter } from '#shared/utils/fiscal'

/** Periodo de un listado o informe: un año entero, uno de sus trimestres o meses, o todos los años (`year` null) */
export interface Period {
  year: number | null
  quarter: Quarter | null
  month: number | null
}

export const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const QUARTER_MONTHS = ['ene – mar', 'abr – jun', 'jul – sep', 'oct – dic']

/** Primer y último día del periodo (YYYY-MM-DD); sin fechas, todos los años */
export function periodRange(p: Period): { from?: string, to?: string } {
  if (!p.year) return {}
  if (p.month) return { from: toISODate(new Date(p.year, p.month - 1, 1)), to: toISODate(new Date(p.year, p.month, 0)) }
  if (p.quarter) return quarterRange(p.year, p.quarter)
  return { from: `${p.year}-01-01`, to: `${p.year}-12-31` }
}

/** «2026», «3T 2026», «Octubre 2026» o «Todos los años» */
export function periodLabel(p: Period) {
  if (!p.year) return 'Todos los años'
  if (p.month) return `${MONTH_NAMES[p.month - 1]} ${p.year}`
  if (p.quarter) return `${p.quarter}T ${p.year}`
  return String(p.year)
}

/** Para frases: «en 2026», «en el 3T 2026», «en octubre de 2026», «en total» */
export function periodPhrase(p: Period) {
  if (!p.year) return 'en total'
  if (p.month) return `en ${MONTH_NAMES[p.month - 1]!.toLowerCase()} de ${p.year}`
  if (p.quarter) return `en el ${p.quarter}T ${p.year}`
  return `en ${p.year}`
}

/** El periodo anterior (-1) o siguiente (+1) de la misma clase: año, trimestre o mes */
export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  if (!p.year) return p
  if (p.month) {
    const m = p.month - 1 + dir
    return { year: p.year + Math.floor(m / 12), quarter: null, month: ((m % 12) + 12) % 12 + 1 }
  }
  if (p.quarter) {
    const q = p.quarter - 1 + dir
    return { year: p.year + Math.floor(q / 4), quarter: ((((q % 4) + 4) % 4) + 1) as Quarter, month: null }
  }
  return { year: p.year + dir, quarter: null, month: null }
}

/** Empieza después de hoy: no hay nada que ver todavía */
export const periodIsFuture = (p: Period) => !!p.year && (periodRange(p).from ?? '') > toISODate(new Date())

/** Pendientes de años anteriores al periodo a la vista (los posteriores no se avisan) y cómo nombrarlos: «de 2025» o «de años anteriores» */
export function earlierYears<T extends { issueDate: string }>(rows: T[], p: Period) {
  if (!p.year) return { rows: [] as T[], from: '' }
  const start = `${p.year}-01-01`
  const out = rows.filter(r => r.issueDate < start)
  const years = new Set(out.map(r => r.issueDate.slice(0, 4)))
  return { rows: out, from: years.size === 1 ? `de ${[...years][0]}` : 'de años anteriores' }
}

/** El año en curso entero: lo que se ve por defecto */
export const currentPeriod = (): Period => ({ year: new Date().getFullYear(), quarter: null, month: null })
