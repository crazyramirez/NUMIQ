import type { MaybeRefOrGetter, WatchSource } from 'vue'

/**
 * Paginación en el cliente de un listado ya cargado: los elementos de la página a la vista y cuántas hay.
 * Al cambiar los filtros (`reset`) vuelve a la primera; si el listado encoge (al borrar), no se queda en una página vacía.
 */
export function usePaged<T>(rows: MaybeRefOrGetter<T[]>, reset: WatchSource[] = []) {
  const page = ref(1)
  const total = computed(() => toValue(rows).length)
  const pages = computed(() => pageCount(total.value))
  const items = computed(() => toValue(rows).slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

  watch(pages, (n) => {
    if (page.value > n) page.value = n
  })
  if (reset.length) watch(reset, () => (page.value = 1))

  return { page, pages, total, items }
}
