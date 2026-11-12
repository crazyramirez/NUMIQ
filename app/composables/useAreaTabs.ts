import type { Router } from 'vue-router'

/**
 * Última pestaña de cada área (Ingresos → Presupuestos, Gastos → Gastos fijos, Informes → Impuestos…):
 * el menú y la barra del móvil vuelven a ella en vez de a la primera. Se guarda en este navegador, por usuario.
 */
const remembered = ref<Record<string, string>>({})
let loadedFor: number | null = null
const tracked = new WeakSet<Router>()

const storageKey = (userId: number) => `numiq-area-tabs-${userId}`

function load(userId: number) {
  if (loadedFor === userId) return
  loadedFor = userId
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '{}')
    remembered.value = raw && typeof raw === 'object' ? raw : {}
  }
  catch {
    remembered.value = {}
  }
}

function remember(path: string, userId: number | null) {
  const { area, tab } = areaOf(path)
  // Solo las pantallas de lista de cada pestaña (no una ficha ni un editor)
  if (!area?.tabs || !tab || path !== tab.to || remembered.value[area.key] === tab.to) return
  remembered.value = { ...remembered.value, [area.key]: tab.to }
  if (!userId) return
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(remembered.value))
  }
  catch {
    // Sin almacenamiento: se recuerda solo mientras la pestaña siga abierta
  }
}

export function useAreaTabs() {
  const { me } = useMe()
  const router = useRouter()

  if (import.meta.client) {
    const userId = me.value?.user.id ?? null
    if (userId) load(userId)
    if (!tracked.has(router)) {
      tracked.add(router)
      remember(router.currentRoute.value.path, userId)
      router.afterEach((to, _from, failure) => {
        if (failure) return
        const id = me.value?.user.id ?? null
        if (id) load(id)
        remember(to.path, id)
      })
    }
  }

  /** A dónde lleva el área en el menú: su última pestaña (si sigue existiendo) o la primera */
  function areaHref(area: NavArea, hidden?: ReadonlySet<string>) {
    const last = remembered.value[area.key]
    return last && area.tabs?.some(t => t.to === last) && !hidden?.has(last) ? last : area.to
  }

  return { areaHref }
}
