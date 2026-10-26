import { startAuthentication } from '@simplewebauthn/browser'

/**
 * Bloqueo de NUMIQ con la huella, Face ID o el PIN del dispositivo (server/utils/app-lock.ts). El servidor
 * es quien bloquea: con la sesión bloqueada no entrega ningún dato. Aquí va la pantalla y cuándo pedirlo
 * (plugins/app-lock.client.ts): las peticiones que llegan bloqueadas esperan al desbloqueo y se repiten.
 */
export type LockMode = 'always' | 'daily' | 'off'

/** «Siempre»: fuera de NUMIQ más de este tiempo y se vuelve a pedir */
export const LOCK_GRACE_MS = 60_000

interface LockPayload { mode: LockMode, hasKeys: boolean, bound: boolean, locked: boolean, unlockedAt: number | null, awayMs: number, dailyMs: number }

export interface LockState {
  /** De quién es este estado: con otra cuenta se vuelve a preguntar */
  userId: number | null
  mode: LockMode
  hasKeys: boolean
  /** Este dispositivo tiene la llave: la sesión se bloquea según el modo */
  bound: boolean
  locked: boolean
  /** Tapa sin pedir nada (fuera de la app con «Siempre»): la vista del multitarea no enseña datos */
  covered: boolean
  /** Confirmación de identidad pedida por un cambio que baja la protección */
  confirm: boolean
  /** La app ya se ha mostrado: si no, al desbloquear falta cargar la cuenta */
  revealed: boolean
  unlockedAt: number
  awayMs: number
  dailyMs: number
}

const initial = (): LockState => ({
  userId: null,
  mode: 'off',
  hasKeys: false,
  bound: false,
  locked: false,
  covered: false,
  confirm: false,
  revealed: false,
  unlockedAt: 0,
  awayMs: 2 * 60_000,
  dailyMs: 24 * 60 * 60_000,
})

const UNLOCK = '/api/lock/unlock'
/** El servidor guarda cada reto 5 minutos: se renueva antes */
const FRESH_MS = 4 * 60_000
/** Última vez que se usó NUMIQ en cualquier pestaña de este navegador */
const ACTIVE_KEY = 'numiq-lock-active'

let waiters: Array<() => void> = []
let confirmDone: ((ok: boolean) => void) | null = null
let channel: BroadcastChannel | null | undefined
interface PreparedUnlock { requestOptions: Parameters<typeof startAuthentication>[0]['optionsJSON'], attemptId: string, at: number }
let prepared: PreparedUnlock | null = null
/** Reto del diálogo del sistema abierto ahora (el intento automático) */
let inFlight: PreparedUnlock | null = null

/** Pestañas abiertas: al desbloquear en una, las demás lo comprueban y se abren sin pedir nada */
export function lockChannel() {
  if (channel === undefined) {
    try {
      channel = new BroadcastChannel('numiq-lock')
    }
    catch {
      channel = null
    }
  }
  return channel
}

export function lastActiveAt() {
  try {
    return Number(localStorage.getItem(ACTIVE_KEY)) || 0
  }
  catch {
    return 0
  }
}

export function markActive(at = Date.now()) {
  try {
    localStorage.setItem(ACTIVE_KEY, String(at))
  }
  catch { /* sin almacenamiento: cuenta solo esta pestaña */ }
}

/** La petición pide confirmar la identidad antes (403 con `reverify`) */
export const needsReverify = (err: unknown) => (err as { data?: { data?: { reverify?: boolean } } })?.data?.data?.reverify === true

export function useAppLock() {
  const state = useState<LockState>('app-lock', initial)
  const { user } = useUserSession()
  const { me, refresh: refreshMe } = useMe()
  // Se usan después de un await (fuera del contexto de Nuxt): se cogen ya
  const route = useRoute()
  const router = useRouter()

  function apply(r: LockPayload, adopt = false) {
    const s = state.value
    Object.assign(s, { mode: r.mode, hasKeys: r.hasKeys, bound: r.bound, unlockedAt: r.unlockedAt ?? 0, awayMs: r.awayMs, dailyMs: r.dailyMs })
    if (r.locked) lock()
    // Aquí se bloquea antes que en el servidor (al volver a la app): solo se abre si ya no aplica o se desbloqueó en otra pestaña
    else if (s.locked && (adopt || !s.bound || s.mode === 'off')) void release()
  }

  /** Estado del servidor; de paso le dice qué llave tiene este dispositivo */
  async function sync(adopt = false) {
    const id = user.value?.id
    if (!id) return
    const r = await $fetch<LockPayload & { deviceKey: boolean }>('/api/lock', { method: 'POST', body: { key: passkeyOnDevice() } })
    // La llave de este dispositivo se quitó de la cuenta
    if (!r.deviceKey) markPasskeyOnDevice('')
    const opening = state.value.userId !== id
    state.value.userId = id
    apply(r, adopt)
    // Al abrir NUMIQ con «Siempre», salvo si se acaba de entrar o de usar (recargar la página no la pide)
    if (opening && r.bound && r.mode === 'always' && Date.now() - Math.max(lastActiveAt(), r.unlockedAt ?? 0) > LOCK_GRACE_MS) lock()
  }

  function lock() {
    const s = state.value
    s.locked = true
    s.covered = false
  }

  async function release() {
    const s = state.value
    // Abierta bloqueada: la cuenta y la empresa se cargan ahora, antes de enseñar nada
    if (!s.revealed) {
      await refreshMe().catch(() => null)
      if (me.value && !me.value.company && route.path !== '/bienvenida') await router.replace('/bienvenida')
    }
    s.locked = false
    s.covered = false
    const pending = waiters
    waiters = []
    pending.forEach(w => w())
  }

  /** Identidad comprobada: abre la app (o termina la confirmación) y avisa a las otras pestañas */
  async function verified() {
    const s = state.value
    s.unlockedAt = Date.now()
    markActive()
    if (s.confirm) {
      s.confirm = false
      confirmDone?.(true)
      confirmDone = null
    }
    if (s.locked) {
      await release()
      lockChannel()?.postMessage('unlocked')
    }
  }

  /** Las peticiones que el servidor rechazó por el bloqueo esperan aquí para repetirse */
  function untilUnlocked() {
    if (!state.value.locked) return Promise.resolve()
    return new Promise<void>(resolve => waiters.push(resolve))
  }

  async function fetchOptions() {
    const r = await $fetch<Omit<PreparedUnlock, 'at'>>(UNLOCK, { method: 'POST', body: { verify: false } })
    return { ...r, at: Date.now() }
  }

  /** Reto pedido antes del toque: Safari en iPhone no abre Face ID si entre el toque y la llamada hay red */
  async function prepare() {
    prepared = await fetchOptions().catch(() => null)
  }

  /**
   * Huella, cara o PIN. false si se canceló (el reto sigue valiendo para el botón). Tocar el botón con el
   * intento automático aún abierto lo sustituye con el mismo reto: sin red entre el toque y Face ID
   */
  async function withPasskey(): Promise<boolean> {
    const fresh = (x: PreparedUnlock | null) => (x && Date.now() - x.at < FRESH_MS ? x : null)
    let p = fresh(prepared) ?? fresh(inFlight)
    prepared = null
    if (!p) p = await fetchOptions()
    inFlight = p
    let response: Awaited<ReturnType<typeof startAuthentication>>
    try {
      response = await startAuthentication({ optionsJSON: p.requestOptions })
    }
    catch (err) {
      if (inFlight === p) inFlight = null
      if (!passkeyCancelled(err)) throw err
      prepared ??= p
      return false
    }
    if (inFlight === p) inFlight = null
    try {
      await $fetch(UNLOCK, { method: 'POST', body: { attemptId: p.attemptId, response, verify: true } })
    }
    finally {
      void prepare()
    }
    if (response.authenticatorAttachment === 'platform') markPasskeyOnDevice(response.id)
    await verified()
    return true
  }

  async function withPassword(password: string) {
    await $fetch('/api/lock/password', { method: 'POST', body: { password } })
    await verified()
  }

  /** Pide la huella o la contraseña para un cambio que baja la protección. false si se cancela */
  function reverify() {
    confirmDone?.(false)
    state.value.confirm = true
    return new Promise<boolean>(resolve => (confirmDone = resolve))
  }

  function cancelConfirm() {
    state.value.confirm = false
    confirmDone?.(false)
    confirmDone = null
  }

  /** Ejecuta un cambio y, si el servidor pide confirmar la identidad, la pide y lo repite. undefined si se cancela */
  async function confirmed<T>(run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await run()
    }
    catch (err) {
      if (!needsReverify(err)) throw err
      if (!(await reverify())) return undefined
      return await run()
    }
  }

  async function setMode(mode: LockMode) {
    const r = await confirmed(() => $fetch<LockPayload>('/api/lock', { method: 'PATCH', body: { mode } }))
    if (r) apply(r)
    return !!r
  }

  /** Al cerrar sesión: el siguiente que entre empieza de cero */
  function reset() {
    cancelConfirm()
    state.value = initial()
    const pending = waiters
    waiters = []
    pending.forEach(w => w())
  }

  return { state, sync, lock, untilUnlocked, prepare, withPasskey, withPassword, reverify, cancelConfirm, confirmed, setMode, reset }
}
