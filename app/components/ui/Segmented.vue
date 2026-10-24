<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'

defineProps<{ options: Array<{ value: string, label: string, count?: number | null }>, label?: string }>()
const model = defineModel<string>({ required: true })

// Si no caben todas (móvil), el borde se funde hacia donde hay más y la opción activa queda a la vista
const el = ref<HTMLElement | null>(null)
const fade = ref({ l: false, r: false })
function update() {
  const e = el.value
  if (!e) return
  fade.value = { l: e.scrollLeft > 2, r: e.scrollLeft + e.clientWidth < e.scrollWidth - 2 }
}
function reveal() {
  const e = el.value
  const on = e?.querySelector<HTMLElement>('.opt.on')
  if (!e || !on || e.scrollWidth <= e.clientWidth) return
  const left = on.getBoundingClientRect().left - e.getBoundingClientRect().left + e.scrollLeft
  e.scrollTo({ left: left - (e.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' })
}
useResizeObserver(el, update)
watch(model, () => nextTick(reveal))
onMounted(() => {
  reveal()
  update()
})
</script>

<template>
  <div ref="el" class="seg" :class="{ 'fade-l': fade.l, 'fade-r': fade.r }" role="tablist" :aria-label="label" @scroll.passive="update">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="tab"
      :aria-selected="model === o.value"
      class="opt"
      :class="{ on: model === o.value }"
      @click="model = o.value"
    >
      {{ o.label }}
      <span v-if="o.count" class="count num">{{ o.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  max-width: 100%;
  overflow-x: auto;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  scrollbar-width: none;
}

.seg::-webkit-scrollbar {
  display: none;
}

.seg.fade-r {
  mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
}

.seg.fade-l {
  mask-image: linear-gradient(to right, transparent, #000 28px);
}

.seg.fade-l.fade-r {
  mask-image: linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent);
}

.opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-3);
  white-space: nowrap;
  border-radius: var(--r-md);
  transition: color var(--t-fast), background var(--t-fast), box-shadow var(--t-fast);
}

.opt:hover {
  color: var(--text);
}

.opt.on {
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border-subtle);
}

.count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-grid;
  place-items: center;
  font-size: var(--text-2xs);
  color: var(--text-3);
  background: var(--surface-active);
  border-radius: var(--r-full);
}

.on .count {
  color: var(--brand-text);
  background: var(--brand-soft);
}

/* Dedo: pestañas más altas (el control entero pasa de 40 px) */
@media (pointer: coarse) {
  .opt {
    height: 36px;
  }
}
</style>
