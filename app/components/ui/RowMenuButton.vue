<script setup lang="ts">
import type { CtxSource } from '~/composables/useContextMenu'

/**
 * Botón «⋯» de una fila: abre el mismo menú que el clic derecho (o la pulsación larga) sobre ella, anclado
 * bajo el botón. En pantallas táctiles sale como hoja inferior. Así hay un único menú por fila, el completo.
 */
const props = defineProps<{ menu: CtxSource, label: string }>()

const btn = ref<HTMLElement | null>(null)
const ctx = useContextMenu()
// El menú se cierra al pulsar fuera antes de que llegue el clic: se recuerda para que el botón alterne
let closedAt = 0
watch(() => ctx.state.value, (v, old) => {
  if (old && !v && old.target === rowOf()) closedAt = performance.now()
}, { flush: 'sync' })

function rowOf() {
  return btn.value?.closest<HTMLElement>('tr, li, [data-row]') ?? btn.value
}

function open(e: MouseEvent) {
  e.stopPropagation()
  e.preventDefault()
  if (performance.now() - closedAt < 250) return
  const el = btn.value
  if (!el) return
  const src = typeof props.menu === 'function' ? props.menu(e) : props.menu
  if (!src) return
  const r = el.getBoundingClientRect()
  const touch = window.matchMedia('(hover: none)').matches
  ctx.openAt({ clientX: r.right, clientY: r.bottom + 4 }, src, { sheet: touch, keyboard: e.detail === 0, target: rowOf() })
}
</script>

<template>
  <span ref="btn" class="row-menu-btn">
    <UiButton variant="ghost" size="sm" square icon="ph:dots-three-bold" :aria-label="label" aria-haspopup="menu" @click="open" />
  </span>
</template>

<style scoped>
.row-menu-btn {
  display: inline-flex;
}
</style>
