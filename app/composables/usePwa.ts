/** Instalar NUMIQ como app: aviso nativo en Chrome, Edge y Android; instrucciones en iPhone y iPad */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferred = shallowRef<InstallPrompt | null>(null)
const installed = ref(false)
let listening = false

/** Se llama al arrancar (plugin): el aviso del navegador llega una sola vez, nada más cargar */
export function listenInstallPrompt() {
  if (listening || !import.meta.client) return
  listening = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred.value = e as InstallPrompt
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    deferred.value = null
  })
}

export function usePwa() {
  const nav: Navigator & { standalone?: boolean } | null = import.meta.client ? navigator : null
  const standalone = computed(() => !!nav && (window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true))
  const ios = computed(() => !!nav && (/iphone|ipad|ipod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)))
  const canInstall = computed(() => !standalone.value && !installed.value && (!!deferred.value || ios.value))

  async function install() {
    const toast = useToast()
    if (deferred.value) {
      const prompt = deferred.value
      deferred.value = null
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice.outcome === 'accepted') toast.success('NUMIQ instalada', 'Ábrela desde tu pantalla de inicio: escanea tickets en un toque.')
      return
    }
    if (ios.value) toast.info('Instálala desde Safari', 'Pulsa el botón Compartir y elige «Añadir a pantalla de inicio».')
  }

  return { canInstall, standalone, ios, install }
}
