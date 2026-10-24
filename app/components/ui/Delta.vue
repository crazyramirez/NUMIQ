<script setup lang="ts">
/** Variación porcentual con flecha. `invert`: subir es malo (gastos). */
const props = defineProps<{ value: number | null, invert?: boolean }>()
const good = computed(() => (props.value ?? 0) >= 0 !== !!props.invert)
</script>

<template>
  <span v-if="value != null && Number.isFinite(value)" class="delta num" :class="good ? 'up' : 'down'">
    <Icon :name="value >= 0 ? 'ph:arrow-up-right-bold' : 'ph:arrow-down-right-bold'" aria-hidden="true" />
    {{ Math.abs(Math.round(value * 100)) }} %
    <span class="sr-only">{{ value >= 0 ? 'más' : 'menos' }} que el periodo anterior</span>
  </span>
</template>

<style scoped>
.delta {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
  padding: 0 6px;
  font-size: var(--text-xs);
  font-weight: 600;
  border-radius: var(--r-full);
}

.delta :deep(svg) {
  width: 11px;
  height: 11px;
}

.up {
  color: var(--success);
  background: var(--success-soft);
}

.down {
  color: var(--danger);
  background: var(--danger-soft);
}
</style>
