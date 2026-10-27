/**
 * Lo último de cada listado en esta pestaña: búsqueda, filtros y página (el periodo se recuerda aparte, en
 * `usePeriodMemory`). Al volver a él desde el menú, otra sección o una ficha, se recupera tal como se dejó.
 * Lo escribe cada `useQueryState`; lo lee el plugin `list-memory`. Por usuario y empresa: lo de una no
 * aparece en otra.
 */
export interface ListState {
  /** Claves de estado de la página, recordadas o no: si un enlace trae alguna, manda el enlace */
  keys: string[]
  /** Valores distintos del de por defecto, ya en el formato de la URL */
  values: Record<string, string>
}

interface Memory { scope: string, lists: Record<string, ListState> }

const STORAGE_KEY = 'numiq-lists'
let memory: Memory | null = null

function load(scope: string): Record<string, ListState> {
  if (memory?.scope === scope) return memory.lists
  let saved: Memory | null = null
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
  }
  catch {}
  memory = saved?.scope === scope && saved.lists && typeof saved.lists === 'object' ? saved : { scope, lists: {} }
  return memory.lists
}

/** Ámbito de la memoria: usuario y empresa activa (null sin sesión) */
export function listScope(me: { user: { id: number }, company: { id: number } | null } | null) {
  return me?.company ? `${me.user.id}:${me.company.id}` : null
}

/** Apunta una clave de estado de la página `path`; con `value` (no el de por defecto), lo recuerda */
export function rememberListState(scope: string | null, path: string, key: string, value?: string) {
  if (!scope || !import.meta.client) return
  const list = (load(scope)[path] ??= { keys: [], values: {} })
  const known = list.keys.includes(key)
  if (known && (list.values[key] === value || (!value && !(key in list.values)))) return
  if (!known) list.keys.push(key)
  if (value) list.values[key] = value
  else delete list.values[key]
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  }
  catch {}
}

/** Lo último que tenía el listado `path`, si se cambió algo de lo de por defecto */
export function savedListState(scope: string | null, path: string): ListState | null {
  if (!scope || !import.meta.client) return null
  const list = load(scope)[path]
  return list && Object.keys(list.values).length ? list : null
}
