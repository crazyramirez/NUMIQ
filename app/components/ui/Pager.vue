<script setup lang="ts">
/**
 * Paginador de los listados: anteriores, página actual y siguientes. Va al pie del listado y,
 * al cambiar de página, sube al principio del listado si ha quedado por encima de la pantalla.
 * Con `v-model:size` y `total`, también elige cuántos se ven por página.
 */
const props = defineProps<{ pages: number, total?: number }>()
const page = defineModel<number>({ required: true })
const size = defineModel<number>('size')
const el = ref<HTMLElement>()
const sizeId = useId()

const sizes = computed(() => (size.value == null || props.total == null ? [] : PAGE_SIZES.filter((n, i) => i === 0 || PAGE_SIZES[i - 1]! < props.total!)))
const visible = computed(() => props.pages > 1 || sizes.value.length > 1)

function go(n: number) {
  page.value = n
  nextTick(() => {
    const list = el.value?.parentElement
    if (!list) return
    const top = list.getBoundingClientRect().top
    // La barra superior es fija: el principio del listado queda justo debajo
    const bar = Number.parseFloat(getComputedStyle(list).getPropertyValue('--topbar-h')) || 60
    if (top < bar) window.scrollTo({ top: window.scrollY + top - bar - 12, behavior: 'smooth' })
  })
}
</script>

<template>
  <nav v-if="visible" ref="el" class="pager" :class="{ 'has-size': sizes.length > 1 }" aria-label="Paginación">
    <UiButton size="sm" variant="ghost" icon="ph:caret-left" :disabled="page <= 1" @click="go(page - 1)">Anteriores</UiButton>
    <span class="mid">
      <span class="where muted num" aria-live="polite">Página {{ page }} de {{ pages }}</span>
      <template v-if="sizes.length > 1">
        <span class="dot muted" aria-hidden="true">·</span>
        <label :for="sizeId" class="sr-only">Elementos por página</label>
        <select :id="sizeId" v-model.number="size" class="size num">
          <option v-for="n in sizes" :key="n" :value="n">{{ n }} por página</option>
        </select>
      </template>
    </span>
    <UiButton size="sm" variant="ghost" icon-right="ph:caret-right" :disabled="page >= pages" @click="go(page + 1)">Siguientes</UiButton>
  </nav>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  padding: var(--s-3) var(--s-5);
  font-size: var(--text-sm);
  border-top: 1px solid var(--border-subtle);
  container-type: inline-size;
}

.mid {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.where {
  white-space: nowrap;
}

.size {
  height: 30px;
  padding: 0 22px 0 8px;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 256 256'%3E%3Cpath fill='%23888' d='M213.7 101.7l-80 80a8 8 0 0 1-11.4 0l-80-80a8 8 0 0 1 11.4-11.4L128 164.7l74.3-74.4a8 8 0 0 1 11.4 11.4z'/%3E%3C/svg%3E") no-repeat right 7px center;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  appearance: none;
  cursor: pointer;
  transition: background-color var(--t-fast), border-color var(--t-fast);
}

.size:hover {
  background-color: var(--surface-hover);
}

.size:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

@media (max-width: 640px) {
  .pager {
    padding-inline: var(--s-3);
  }
}

/* En el móvil y en columnas estrechas, solo las flechas, con área táctil cómoda (el texto sigue para lectores de pantalla).
   Con el selector de tamaño hace falta sitio antes */
@container (max-width: 520px) {
  .has-size :deep(.btn) {
    min-width: 40px;
    min-height: 40px;
    justify-content: center;
  }

  .has-size :deep(.btn-label) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

@container (max-width: 360px) {
  .pager :deep(.btn) {
    min-width: 40px;
    min-height: 40px;
    justify-content: center;
  }

  .pager :deep(.btn-label) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
