<script setup lang="ts">
/** Pestañas de la sección Documentos: importar, archivo trimestral y envío al gestor */
const route = useRoute()
const tabs = [
  { to: '/documentos', label: 'Importar', icon: 'ph:upload-simple', exact: true },
  { to: '/documentos/archivo', label: 'Archivo trimestral', icon: 'ph:archive' },
  { to: '/documentos/gestor', label: 'Envío al gestor', icon: 'ph:paper-plane-tilt' },
]
const active = (t: typeof tabs[number]) => (t.exact ? route.path === t.to || route.path.startsWith('/documentos/importacion') : route.path.startsWith(t.to))

// En móvil las pestañas se desplazan: la activa siempre a la vista
const nav = ref<HTMLElement>()
onMounted(() => nav.value?.querySelector<HTMLElement>('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }))
</script>

<template>
  <nav ref="nav" class="tabs no-scrollbar" aria-label="Secciones de documentos">
    <NuxtLink v-for="t in tabs" :key="t.to" :to="t.to" class="tab" :class="{ on: active(t) }" :aria-current="active(t) ? 'page' : undefined">
      <Icon :name="t.icon" aria-hidden="true" />
      {{ t.label }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: var(--s-1);
  margin-bottom: var(--s-6);
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
}

.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px 12px;
  font-weight: 560;
  color: var(--text-3);
  white-space: nowrap;
  transition: color var(--t-fast);
}

.tab:hover {
  color: var(--text);
}

.tab.on {
  color: var(--text);
}

.tab::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2px;
  background: var(--brand);
  border-radius: 2px 2px 0 0;
  transform: scaleX(0);
  transition: transform var(--t-base) var(--ease-out);
}

.tab.on::after {
  transform: none;
}

.tab.on :deep(svg) {
  color: var(--brand);
}
</style>
