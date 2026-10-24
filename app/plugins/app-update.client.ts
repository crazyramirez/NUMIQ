import { joinURL } from 'ufo'

const CHECK_EVERY = 5 * 60_000
const MIN_GAP = 30_000

/**
 * Detecta que se ha publicado una versión nueva: Nuxt deja el id del último build en _nuxt/builds/latest.json.
 * Al cambiar de pantalla se actualiza sola con una carga completa; si no, AppToasts ofrece «Actualizar».
 */
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()
  const update = useAppUpdate()
  const scan = useScan()
  const toast = useToast()

  // Arranque tras actualizar: confirmarlo con la versión nueva
  let from: string | null = null
  try {
    from = sessionStorage.getItem(UPDATED_FROM_KEY)
    sessionStorage.removeItem(UPDATED_FROM_KEY)
  }
  catch {
    // Sin sessionStorage no hay confirmación
  }
  if (from && from !== config.app.buildId) onNuxtReady(() => toast.success('NUMIQ actualizado', `Versión ${config.public.appVersion}`))

  if (import.meta.dev) return

  const url = joinURL(config.app.baseURL, config.app.buildAssetsDir, 'builds/latest.json')
  let last = 0
  async function check() {
    if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - last < MIN_GAP) return
    last = Date.now()
    try {
      const meta = await $fetch<{ id?: string }>(`${url}?t=${last}`, { cache: 'no-store' })
      if (meta?.id) update.state.value = { ...update.state.value, latest: meta.id }
    }
    catch {
      // Sin conexión o el servidor reiniciándose tras el despliegue: se vuelve a mirar más tarde
    }
  }

  // Al volver a la pestaña o a la app instalada, al recuperar la conexión, al cambiar de pantalla y cada 5 min
  onNuxtReady(() => {
    setInterval(check, CHECK_EVERY)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
  })
  nuxtApp.hook('page:finish', check)

  // Con versión nueva, el siguiente cambio de pantalla es una carga completa y se actualiza sin pedir nada.
  // Los avisos de cambios sin guardar (onBeforeRouteLeave) ya se han resuelto antes de este guard; con un
  // escaneo abierto se espera, que la lectura de la IA sigue en curso.
  useRouter().beforeEach((to, from) => {
    if (!update.available.value || to.path === from.path || scan.state.value.open) return
    update.apply(joinURL(config.app.baseURL, to.fullPath))
    return false
  })
})
