import type { Ref } from 'vue'
import type { RouteLocationNormalized, Router } from 'vue-router'

interface QueryStateOptions<T> {
  /** Valores admitidos: cualquier otro en la URL deja el de por defecto */
  allowed?: readonly T[]
  /** Espera antes de escribir en la URL (búsquedas mientras se teclea) */
  debounce?: number
  parse?: (raw: string) => T | undefined
  format?: (value: T) => string
}

type Patch = Record<string, string | undefined>

// Cambios de varios filtros en el mismo instante (p. ej. «Quitar filtros»): una sola navegación con todos.
// Nunca se escribe con otra navegación en curso: un `replace` la cancelaría (clic en una fila nada más teclear).
let pending: { path: string, patch: Patch } | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let inFlight: RouteLocationNormalized | null = null
const watched = new WeakSet<Router>()

const merge = (query: RouteLocationNormalized['query'], patch: Patch) => {
  const out = { ...query, ...patch }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

function track(router: Router) {
  if (watched.has(router)) return
  watched.add(router)
  router.beforeEach((to, from) => {
    inFlight = to
    // Se deja la página con cambios aún sin escribir (se tecleó y se pulsó una fila enseguida): se guardan en la
    // entrada del historial que se abandona, sin navegar, para que «atrás» la recupere tal cual. En un atrás/adelante
    // del navegador la entrada ya es otra y no se toca.
    if (!pending || to.path === from.path || pending.path !== from.path) return
    const state = window.history.state as { current?: string } | null
    if (state?.current?.split(/[?#]/)[0] !== from.path) return
    const url = router.resolve({ path: from.path, query: merge(from.query, pending.patch), hash: from.hash }).fullPath
    window.history.replaceState({ ...state, current: url }, '', router.options.history.createHref(url))
    pending = null
    clearTimeout(timer)
  })
  router.afterEach((to) => {
    if (to !== inFlight) return
    inFlight = null
    if (pending) nextTick(() => flush(router))
  })
  router.onError(() => {
    inFlight = null
  })
}

function flush(router: Router) {
  clearTimeout(timer)
  if (!pending || inFlight) return
  const p = pending
  pending = null
  const route = router.currentRoute.value
  if (route.path !== p.path || Object.entries(p.patch).every(([k, v]) => (route.query[k] ?? undefined) === v)) return
  router.replace({ query: merge(route.query, p.patch), hash: route.hash })
}

function patchQuery(router: Router, path: string, patch: Patch, delay = 0) {
  if (import.meta.client) track(router)
  if (pending && pending.path !== path) pending = null
  pending ??= { path, patch: {} }
  Object.assign(pending.patch, patch)
  clearTimeout(timer)
  if (delay) timer = setTimeout(() => flush(router), delay)
  else nextTick(() => flush(router))
}

/** Cambia parte de la query de la página actual junto con los `useQueryState` (undefined quita la clave) */
export function useQueryPatch() {
  const router = useRouter()
  return (patch: Patch) => patchQuery(router, router.currentRoute.value.path, patch)
}

/**
 * Estado de un listado (búsqueda, filtros, página) guardado en la URL con `replace`: al abrir un elemento
 * y volver atrás, el listado aparece tal como se dejó. El valor por defecto no se escribe, así el enlace
 * del menú abre el listado limpio.
 */
export function useQueryState<T>(key: string, fallback: T, opts: QueryStateOptions<T> = {}): Ref<T> {
  const router = useRouter()
  if (import.meta.client) track(router)
  const current = router.currentRoute
  const path = current.value.path
  const format = opts.format ?? ((v: T) => (v == null ? '' : String(v)))
  const parse = opts.parse ?? ((raw: string) => (typeof fallback === 'number' ? (Number.isFinite(Number(raw)) ? Number(raw) : undefined) : raw) as T | undefined)
  const empty = format(fallback)

  const read = (raw: unknown): T => {
    const s = Array.isArray(raw) ? raw[0] : raw
    if (typeof s !== 'string' || !s) return fallback
    const v = parse(s)
    return v === undefined || (opts.allowed && !opts.allowed.includes(v)) ? fallback : v
  }

  const state = ref(read(current.value.query[key])) as Ref<T>
  let written = format(state.value)

  watch(state, () => {
    if (current.value.path !== path) return
    written = format(state.value)
    patchQuery(router, path, { [key]: written === empty ? undefined : written }, opts.debounce)
  }, { deep: true })

  // La URL cambia por fuera estando en la misma página (un enlace con filtro, atrás/adelante): se sigue
  watch(() => current.value.query[key], (raw) => {
    if (current.value.path !== path) return
    const v = read(raw)
    const s = format(v)
    if (s === written) return
    written = s
    state.value = v
  })

  return state
}
