<script setup lang="ts">
/**
 * Pestañas del área (Ventas: Facturas · Presupuestos · Recurrentes · Productos…).
 * Solo en las pantallas de lista de un área con varias: en fichas y editores no estorban.
 */
const route = useRoute()
const current = computed(() => {
  const { area, tab } = areaOf(route.path)
  return area?.tabs && tab && route.path === tab.to ? { area, tab } : null
})
</script>

<template>
  <div v-if="current" class="area-wrap">
    <nav class="area-tabs" :aria-label="current.area.label">
      <NuxtLink
        v-for="t in current.area.tabs"
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
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
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
  margin-bottom: -1px;
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
