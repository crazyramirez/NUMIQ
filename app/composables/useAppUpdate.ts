/** Build desde el que se pulsó «Actualizar»: al arrancar la versión nueva se confirma con un aviso */
export const UPDATED_FROM_KEY = 'numiq-updated-from'

/**
 * Nueva versión publicada. Tras un despliegue, las pestañas abiertas siguen con el código anterior hasta
 * recargar: el plugin app-update la detecta y AppToasts muestra el aviso «Actualizar».
 */
export function useAppUpdate() {
  const state = useState('appUpdate', () => ({ latest: '', dismissed: '' }))
  const buildId = useRuntimeConfig().app.buildId

  const available = computed(() => !!state.value.latest && state.value.latest !== buildId)

  function apply(path?: string) {
    try {
      sessionStorage.setItem(UPDATED_FROM_KEY, buildId)
    }
    catch {
      // Sin sessionStorage: se actualiza igual, sin el aviso de confirmación
    }
    if (path) window.location.assign(path)
    else window.location.reload()
  }

  return {
    state,
    available,
    // Cerrado el aviso, no vuelve hasta que se publique otra versión
    visible: computed(() => available.value && state.value.latest !== state.value.dismissed),
    dismiss: () => (state.value = { ...state.value, dismissed: state.value.latest }),
    apply,
  }
}
