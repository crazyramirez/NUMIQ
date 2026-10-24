<script setup lang="ts">
defineProps<{ options: Array<{ value: string, label: string, count?: number | null }>, label?: string }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <div class="seg" role="tablist" :aria-label="label">
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
</style>
