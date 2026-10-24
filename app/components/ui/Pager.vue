<script setup lang="ts">
/**
 * Paginador de los listados: anteriores, página actual y siguientes. Va al pie del listado y,
 * al cambiar de página, sube al principio del listado si ha quedado por encima de la pantalla.
 */
defineProps<{ pages: number }>()
const page = defineModel<number>({ required: true })
const el = ref<HTMLElement>()

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
  <nav v-if="pages > 1" ref="el" class="pager" aria-label="Paginación">
    <UiButton size="sm" variant="ghost" icon="ph:caret-left" :disabled="page <= 1" @click="go(page - 1)">Anteriores</UiButton>
    <span class="where muted num" aria-live="polite">Página {{ page }} de {{ pages }}</span>
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

.where {
  white-space: nowrap;
}

@media (max-width: 640px) {
  .pager {
    padding-inline: var(--s-3);
  }
}

/* En el móvil y en columnas estrechas, solo las flechas, con área táctil cómoda (el texto sigue para lectores de pantalla) */
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
