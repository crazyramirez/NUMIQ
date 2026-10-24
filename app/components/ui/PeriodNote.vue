<script setup lang="ts">
/** Aviso discreto: algo pendiente queda fuera del periodo a la vista (p. ej. facturas sin cobrar de otro año) */
defineProps<{ text: string, amount?: number | null, action?: string }>()
defineEmits<{ show: [] }>()
</script>

<template>
  <button type="button" class="pnote rise" @click="$emit('show')">
    <Icon name="ph:calendar-dots" class="pn-ic" aria-hidden="true" />
    <span class="pn-t">{{ text }}<template v-if="amount"> · <span class="num">{{ eur(amount) }}</span></template></span>
    <span class="pn-go">{{ action ?? 'Ver' }} <Icon name="ph:arrow-right" aria-hidden="true" /></span>
  </button>
</template>

<style scoped>
.pnote {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-bottom: var(--s-4);
  padding: 9px var(--s-4);
  text-align: left;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 22%, transparent);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast);
}

.pnote:hover {
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
}

.pn-ic {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--warning);
}

.pn-t {
  flex: 1;
  min-width: 0;
}

.pn-t .num {
  font-weight: 600;
  color: var(--text);
}

.pn-go {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  color: var(--warning);
}
</style>
