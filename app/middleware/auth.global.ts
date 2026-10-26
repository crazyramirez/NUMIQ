/** Solo para quien no ha entrado (con sesión, a la app) */
const GUEST = new Set(['/login', '/registro', '/recuperar', '/restablecer'])
/** Abiertas con o sin sesión: enlaces de los correos */
const OPEN = new Set(['/verificar', '/invitacion'])

/** Sin sesión → login. Con sesión pero sin empresa → asistente de bienvenida. */
export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn } = useUserSession()
  // /p/:token → documento compartido con el cliente
  if (OPEN.has(to.path) || to.path.startsWith('/p/')) return
  if (GUEST.has(to.path)) {
    if (loggedIn.value) return navigateTo('/')
    return
  }
  if (!loggedIn.value) return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { r: to.fullPath } : undefined })

  // Bloqueo con huella o Face ID: se mira antes de cargar nada. Bloqueada, la cuenta se carga al desbloquear
  const { user } = useUserSession()
  const lock = useAppLock()
  if (lock.state.value.userId !== user.value?.id) await lock.sync().catch(() => null)
  if (lock.state.value.locked && !lock.state.value.revealed) return

  const { me, refresh } = useMe()
  if (!me.value) {
    try {
      await refresh()
    }
    catch {
      return navigateTo('/login')
    }
  }
  if (!me.value?.company && to.path !== '/bienvenida') return navigateTo('/bienvenida')
})
