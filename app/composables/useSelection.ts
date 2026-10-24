import type { MaybeRefOrGetter } from 'vue'

/**
 * Selección múltiple de un listado: casillas en escritorio y, en el móvil, un modo selección
 * que se activa con un botón. Mayús + clic marca todo el tramo desde la última casilla.
 * Al filtrar, la selección se queda solo con lo que sigue a la vista.
 */
export function useSelection<T extends { id: number }>(rows: MaybeRefOrGetter<T[]>) {
  const selected = ref<number[]>([])
  const selectedSet = computed(() => new Set(selected.value))
  const selecting = ref(false)
  let lastPicked: number | null = null

  watch(() => toValue(rows), (list) => {
    const visible = new Set(list.map(r => r.id))
    if (selected.value.some(id => !visible.has(id))) selected.value = selected.value.filter(id => visible.has(id))
  })

  const allSelected = computed(() => {
    const list = toValue(rows)
    return !!list.length && list.every(r => selectedSet.value.has(r.id))
  })
  const selectedRows = computed(() => toValue(rows).filter(r => selectedSet.value.has(r.id)))

  function toggleAll() {
    selected.value = allSelected.value ? [] : toValue(rows).map(r => r.id)
  }

  function toggle(id: number, ev?: MouseEvent | KeyboardEvent) {
    const on = !selectedSet.value.has(id)
    const list = toValue(rows).map(r => r.id)
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

  return { selected, selectedSet, selectedRows, selecting, allSelected, toggle, toggleAll, clear }
}
