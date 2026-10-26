<script setup lang="ts">
/**
 * Pestañas del área (Ingresos: Facturas · Presupuestos · Recurrentes · Productos…).
 * Solo en las pantallas de lista de un área con varias: en fichas y editores no estorban.
 */
const route = useRoute()
const { readOnly } = useMe()
// El gestor no importa nada: la pestaña Importar sobra
const HIDDEN_READ_ONLY = new Set(['/documentos'])
const current = computed(() => {
  const { area, tab } = areaOf(route.path)
  if (!area?.tabs || !tab || route.path !== tab.to) return null
  return { area, tab, tabs: readOnly.value ? area.tabs.filter(t => !HIDDEN_READ_ONLY.has(t.to)) : area.tabs }
})
</script>

<template>
  <div v-if="current" class="area-wrap">
    <nav class="area-tabs" :aria-label="current.area.label">
      <NuxtLink
        v-for="t in current.tabs"
        :key="t.to"
        :to="t.to"
        class="at"
        :class="{ on: t.to === current.tab.to }"
        :aria-current="t.to === current.tab.to ? 'page' : undefined"
      >
        <Icon :name="t.to === current.tab.to ? `${t.icon}-fill` : t.icon" class="at-ic" aria-hidden="true" />
        {{ t.label }}
      </NuxtLink>
    </nav>
  </div>
</template>

<style scoped>
.area-wrap {
  width: 100%;
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--s-5) var(--s-7) 0;
}

.area-tabs {
  display: flex;
  gap: 2px;
  /* Solo horizontal: la línea va como sombra interior para que nada sobresalga en vertical */
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  box-shadow: inset 0 -1px 0 var(--border);
  scrollbar-width: none;
}

.area-tabs::-webkit-scrollbar {
  display: none;
}

.at {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 14px;
  font-weight: 560;
  color: var(--text-3);
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color var(--t-fast), border-color var(--t-fast);
}

.at:hover {
  color: var(--text);
}

.at.on {
  color: var(--text);
  font-weight: 620;
  border-bottom-color: var(--brand);
}

.at-ic {
  width: 17px;
  height: 17px;
  color: var(--text-4);
  transition: color var(--t-fast);
}

.at.on .at-ic {
  color: var(--brand);
}

@media (max-width: 767px) {
  .area-wrap {
    padding: var(--s-3) 0 0;
  }

  .area-tabs {
    padding: 0 var(--s-4);
  }

  .at {
    height: 40px;
    padding: 0 10px;
  }
}
</style>
