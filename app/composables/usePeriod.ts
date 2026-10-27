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

const encode = (p: Period) => (!p.year ? 'todos' : p.month ? `${p.year}-m${p.month}` : p.quarter ? `${p.year}-t${p.quarter}` : String(p.year))
function decode(raw: string | null | undefined): Period | null {
  if (raw === 'todos') return { year: null, quarter: null, month: null }
  const m = /^(\d{4})(?:-([tm])(\d{1,2}))?$/.exec(raw ?? '')
  if (!m) return null
  const year = Number(m[1])
  const n = Number(m[3])
  if (m[2] === 't' && n >= 1 && n <= 4) return { year, quarter: n as Quarter, month: null }
  if (m[2] === 'm' && n >= 1 && n <= 12) return { year, quarter: null, month: n }
  return m[2] ? null : { year, quarter: null, month: null }
}

/**
 * Último periodo elegido en cualquier listado, informe o en Impuestos (cookie de la sesión del navegador):
 * al pasar de Facturas a Gastos, Clientes o Impuestos se sigue en el mismo año. Sin elegir nada, el año en curso.
 */
export function usePeriodMemory() {
  const cookie = useCookie<string | null>('numiq-period', { default: () => null, sameSite: 'lax' })
  return computed<Period | null>({
    get: () => decode(cookie.value),
    set: (p) => {
      cookie.value = p ? encode(p) : null
    },
  })
}

/** ¿La URL ya trae un periodo? (un enlace con filtro o atrás del navegador): entonces manda la URL */
export const hasPeriodQuery = (query: Record<string, unknown>) => ['anio', 't', 'mes', 'periodo'].some(k => query[k] != null)

/**
 * Periodo de un listado o informe en la URL: ?anio=2025 (o ?anio=todos), &t=3 o &mes=9. Por defecto, el año
 * en curso entero, que no se escribe. Sin periodo en la URL (el enlace del menú), el último elegido en
 * cualquier otra página (`usePeriodMemory`). Sin `allowAll`, siempre hay un año (informes).
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
    remember: false,
  })
  const quarter = useQueryState<Quarter | null>('t', null, { parse: r => ([1, 2, 3, 4].includes(Number(r)) ? Number(r) as Quarter : undefined), format: v => (v ? String(v) : ''), remember: false })
  const month = useQueryState<number | null>('mes', null, { parse: r => (Number(r) >= 1 && Number(r) <= 12 ? Math.floor(Number(r)) : undefined), format: v => (v ? String(v) : ''), remember: false })

  const period = computed<Period>({
    get: () => ({ year: year.value, quarter: year.value && !month.value ? quarter.value : null, month: year.value ? month.value : null }),
    set: (p) => {
      year.value = p.year ?? (allowAll ? null : thisYear)
      quarter.value = p.year && !p.month ? p.quarter : null
      month.value = p.year ? p.month : null
    },
  })

  const memory = usePeriodMemory()
  if (!hasPeriodQuery(route.query) && memory.value) period.value = memory.value

  const legacy = route.query.periodo
  if (typeof legacy === 'string') {
    const map = LEGACY[legacy]
    if (map) period.value = map(thisYear, quarterOf(now))
    useQueryPatch()({ periodo: undefined })
  }

  // Lo que se elige aquí se recuerda para las demás páginas
  watch(period, p => (memory.value = p))

  const range = computed(() => periodRange(period.value))
  const label = computed(() => periodLabel(period.value))
  const isAll = computed(() => !period.value.year)

  return { period, range, label, isAll }
}
