import type { MaybeRefOrGetter, WatchSource } from 'vue'

/** Elementos por página elegidos al pie de cualquier listado: se recuerdan para todos */
export function usePageSize() {
  const size = useCookie<number>('page-size', { default: () => PAGE_SIZE, maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  return computed<number>({
    get: () => ((PAGE_SIZES as readonly number[]).includes(Number(size.value)) ? Number(size.value) : PAGE_SIZE),
    set: (v) => { size.value = v },
  })
}

/**
 * Paginación en el cliente de un listado ya cargado: los elementos de la página a la vista y cuántas hay.
 * Al cambiar los filtros (`reset`) vuelve a la primera; si el listado encoge (al borrar), no se queda en una página vacía.
 * Con `pageKey`, la página va en la URL: al volver atrás desde un elemento se sigue en la misma.
 */
export function usePaged<T>(rows: MaybeRefOrGetter<T[]>, reset: WatchSource[] = [], pageKey?: string) {
  const page = pageKey ? useQueryState(pageKey, 1, { parse: r => (Number(r) >= 1 ? Math.floor(Number(r)) : undefined) }) : ref(1)
  const size = usePageSize()
  const total = computed(() => toValue(rows).length)
  const pages = computed(() => pageCount(total.value, size.value))
  const items = computed(() => toValue(rows).slice((page.value - 1) * size.value, page.value * size.value))

  watch(pages, (n) => {
    if (page.value > n) page.value = n
  })
  // Al cambiar el tamaño, sigue a la vista lo primero que se estaba viendo
  watch(size, (n, old) => (page.value = Math.floor(((page.value - 1) * old) / n) + 1))
  if (reset.length) watch(reset, () => (page.value = 1))

  return { page, pages, total, items, size }
}
