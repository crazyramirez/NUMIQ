import type { Quarter } from '#shared/utils/fiscal'
import type { Period } from '~/utils/period'

// Enlaces y avisos antiguos con ?periodo=: se traducen una vez a ?anio=&t=
const LEGACY: Record<string, (y: number, q: Quarter) => Period> = {
  'all': () => ({ year: null, quarter: null, month: null }),
  'y': y => ({ year: y, quarter: null, month: null }),
  'year': y => ({ year: y, quarter: null, month: null }),
  'py': y => ({ year: y - 1, quarter: null, month: null }),
  'prev-year': y => ({ year: y - 1, quarter: null, month: null }),
  'q': (y, q) => ({ year: y, quarter: q, month: null }),
  'quarter': (y, q) => ({ year: y, quarter: q, month: null }),
  'pq': (y, q) => (q === 1 ? { year: y - 1, quarter: 4, month: null } : { year: y, quarter: (q - 1) as Quarter, month: null }),
  'prev-quarter': (y, q) => (q === 1 ? { year: y - 1, quarter: 4, month: null } : { year: y, quarter: (q - 1) as Quarter, month: null }),
}

/**
 * Periodo de un listado o informe en la URL: ?anio=2025 (o ?anio=todos), &t=3 o &mes=9. Por defecto, el año
 * en curso entero, que no se escribe: el enlace del menú abre siempre el año actual. Sin `allowAll`, siempre
 * hay un año (informes).
 */
export function usePeriodQuery(opts: { allowAll?: boolean } = {}) {
  const allowAll = opts.allowAll ?? true
  const route = useRoute()
  const now = new Date()
  const thisYear = now.getFullYear()

  const year = useQueryState<number | null>('anio', thisYear, {
    parse: (r) => {
      if (r === 'todos') return allowAll ? null : undefined
      const n = Number(r)
      return Number.isInteger(n) && n >= 2000 && n <= thisYear + 1 ? n : undefined
    },
    format: v => (v == null ? 'todos' : String(v)),
  })
  const quarter = useQueryState<Quarter | null>('t', null, { parse: r => ([1, 2, 3, 4].includes(Number(r)) ? Number(r) as Quarter : undefined), format: v => (v ? String(v) : '') })
  const month = useQueryState<number | null>('mes', null, { parse: r => (Number(r) >= 1 && Number(r) <= 12 ? Math.floor(Number(r)) : undefined), format: v => (v ? String(v) : '') })

  const period = computed<Period>({
    get: () => ({ year: year.value, quarter: year.value && !month.value ? quarter.value : null, month: year.value ? month.value : null }),
    set: (p) => {
      year.value = p.year ?? (allowAll ? null : thisYear)
      quarter.value = p.year && !p.month ? p.quarter : null
      month.value = p.year ? p.month : null
    },
  })

  const legacy = route.query.periodo
  if (typeof legacy === 'string') {
    const map = LEGACY[legacy]
    if (map) period.value = map(thisYear, quarterOf(now))
    useQueryPatch()({ periodo: undefined })
  }

  const range = computed(() => periodRange(period.value))
  const label = computed(() => periodLabel(period.value))
  const isAll = computed(() => !period.value.year)

  return { period, range, label, isAll }
}
