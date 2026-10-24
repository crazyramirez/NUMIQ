import type { MaybeRefOrGetter } from 'vue'

/**
 * Selección múltiple de un listado: casillas en escritorio y, en el móvil, un modo selección
 * que se activa con un botón. Mayús + clic marca todo el tramo desde la última casilla.
 * `rows` es todo lo filtrado (la selección se conserva al cambiar de página) y `page`, lo que está
 * a la vista: la casilla de la cabecera marca la página y `selectAll` todo lo filtrado.
 * Al filtrar, la selección se queda solo con lo que sigue en el listado.
 */
export function useSelection<T extends { id: number }>(rows: MaybeRefOrGetter<T[]>, page: MaybeRefOrGetter<T[]> = rows) {
  const selected = ref<number[]>([])
  const selectedSet = computed(() => new Set(selected.value))
  const selecting = ref(false)
  let lastPicked: number | null = null

  watch(() => toValue(rows), (list) => {
    const visible = new Set(list.map(r => r.id))
    if (selected.value.some(id => !visible.has(id))) selected.value = selected.value.filter(id => visible.has(id))
  })

  /** Toda la página a la vista está marcada */
  const allSelected = computed(() => {
    const list = toValue(page)
    return !!list.length && list.every(r => selectedSet.value.has(r.id))
  })
  /** Todo lo filtrado (todas las páginas) está marcado */
  const everySelected = computed(() => {
    const list = toValue(rows)
    return !!list.length && list.every(r => selectedSet.value.has(r.id))
  })
  const selectedRows = computed(() => toValue(rows).filter(r => selectedSet.value.has(r.id)))

  /** Casilla de la cabecera: marca o desmarca la página a la vista, sin tocar lo marcado en otras */
  function toggleAll() {
    const ids = toValue(page).map(r => r.id)
    if (allSelected.value) {
      const off = new Set(ids)
      selected.value = selected.value.filter(id => !off.has(id))
    }
    else {
      selected.value = [...new Set([...selected.value, ...ids])]
    }
  }

  /** Todo lo filtrado, en todas las páginas */
  function selectAll() {
    selected.value = toValue(rows).map(r => r.id)
  }

  function toggle(id: number, ev?: MouseEvent | KeyboardEvent) {
    const on = !selectedSet.value.has(id)
    const list = toValue(page).map(r => r.id)
    const from = lastPicked != null ? list.indexOf(lastPicked) : -1
    const to = list.indexOf(id)
    if (ev?.shiftKey && from >= 0 && to >= 0) {
      const next = new Set(selected.value)
      for (const x of list.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (on) next.add(x)
        else next.delete(x)
      }
      selected.value = [...next]
    }
    else {
      selected.value = on ? [...selected.value, id] : selected.value.filter(x => x !== id)
    }
    lastPicked = id
  }

  function clear() {
    selected.value = []
    selecting.value = false
  }

  return { selected, selectedSet, selectedRows, selecting, allSelected, everySelected, toggle, toggleAll, selectAll, clear }
}
