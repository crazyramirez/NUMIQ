/**
 * Cuándo se bloquea NUMIQ en este dispositivo (useAppLock). Con «Siempre»: al volver tras más de un minuto
 * fuera (otra app, el móvil bloqueado, otra pestaña) y tras 10 minutos a la vista sin tocarla; al salir se
 * tapa al momento para que el multitarea no enseñe datos. En el ordenador, tras 15 minutos sin usarla, esté
 * a la vista o detrás de otra ventana: cambiar a otro programa y volver no pide nada. Con «Cada 24 horas»,
 * al pasar el día. El servidor bloquea por su cuenta si dejan de llegar señales de vida: esto solo lo adelanta.
 */
const desk = lockOnDesktop()
const IDLE_MS = desk ? LOCK_GRACE_DESK_MS : 10 * 60_000
const PING_MS = 30_000
/** Escribir la última actividad como mucho cada pocos segundos */
const ACTIVE_EVERY = 5_000

export default defineNuxtPlugin(() => {
  const appLock = useAppLock()
  const s = appLock.state
  const { user } = useUserSession()
  const armed = () => !!s.value.userId && s.value.bound && s.value.mode !== 'off'
  const always = () => armed() && s.value.mode === 'always'

  // Lo que el servidor rechaza por el bloqueo (423) espera al desbloqueo y se repite: nada se pierde ni avisa
  // de un error. Por fetch y no por $fetch: useFetch usa su propia copia de $fetch, pero todo pasa por aquí
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    // Una Request con cuerpo solo se puede enviar una vez: la copia es para repetirla
    const again = input instanceof Request ? input.clone() : input
    const res = await nativeFetch(input, init)
    if (res.status !== 423) return res
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return res
    appLock.lock()
    await appLock.untilUnlocked()
    return nativeFetch(again, init)
  }

  let lastActive = Date.now()
  const seen = () => Math.max(lastActive, lastActiveAt())
  function active(force = false) {
    if (s.value.locked || document.visibilityState !== 'visible') return
    const now = Date.now()
    // Vuelta tras mucho rato sin tocarla (el ordenador al despertar): primero la huella
    if (always() && now - seen() > IDLE_MS) return appLock.lock()
    if (!force && now - lastActive < ACTIVE_EVERY) return
    lastActive = now
    markActive(now)
  }
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'pointermove'] as const) {
    window.addEventListener(type, () => active(), { passive: true, capture: true })
  }

  const ping = () => $fetch('/api/lock/ping', { method: 'POST' }).catch(() => null)

  function leave() {
    if (!always() || s.value.locked) return
    lastActive = Date.now()
    markActive(lastActive)
    // En el ordenador no hay multitarea que enseñe la pantalla: taparla solo parpadearía al volver
    if (!desk) s.value.covered = true
  }

  function resume() {
    if (!armed() || s.value.locked) {
      s.value.covered = false
      return
    }
    const now = Date.now()
    if (always() && now - seen() > lockGraceMs()) return appLock.lock()
    if (s.value.mode === 'daily' && now - s.value.unlockedAt > s.value.dailyMs) return appLock.lock()
    s.value.covered = false
    active(true)
    if (always()) void ping()
    // Lo decide el servidor: en otro dispositivo pudo cambiarse el modo o quitarse la llave
    void appLock.sync().catch(() => null)
  }

  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? leave() : resume()))
  // Vuelta desde la caché del navegador (atrás / adelante, o la app instalada al reabrirse)
  window.addEventListener('pageshow', e => e.persisted && resume())
  window.addEventListener('pagehide', leave)

  setInterval(() => {
    if (!armed() || s.value.locked || document.visibilityState !== 'visible') return
    const now = Date.now()
    if (always() && now - seen() > IDLE_MS) return appLock.lock()
    if (s.value.mode === 'daily' && now - s.value.unlockedAt > s.value.dailyMs) return appLock.lock()
    if (always()) void ping()
  }, PING_MS)

  // Desbloqueada en otra pestaña: esta lo comprueba con el servidor y se abre sin pedir nada
  lockChannel()?.addEventListener('message', (e) => {
    if (e.data === 'unlocked' && s.value.locked) void appLock.sync(true).catch(() => null)
  })

  // Con la app ya a la vista, bloqueada no se cambia de pantalla (el botón atrás del móvil)
  useRouter().beforeEach(() => {
    if (s.value.locked && s.value.revealed) return false
  })

  // La app se ha mostrado desbloqueada: a partir de aquí un bloqueo la tapa sin descargarla (nada sin guardar se pierde)
  watch(() => !s.value.locked && !!s.value.userId, (open) => {
    if (open) s.value.revealed = true
  })

  // Sesión cerrada (o caducada): el estado era de esa cuenta
  watch(() => user.value?.id, (id) => {
    if (s.value.userId !== null && id !== s.value.userId) appLock.reset()
  })
})
