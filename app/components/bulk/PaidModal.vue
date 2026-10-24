<script setup lang="ts">
/** Cobradas / pagados en lote: con qué fecha (hoy, la de cada documento o una concreta) y forma de pago */
const props = defineProps<{ title: string, subtitle?: string, confirmLabel: string, /** «cobro» en facturas, «pago» en gastos */ what: 'cobro' | 'pago' }>()
const emit = defineEmits<{ apply: [{ date: string, method: string }] }>()
const open = defineModel<boolean>({ default: false })

const mode = ref('today')
const custom = ref(todayISO())
const method = ref('transfer')
const formId = useId()

watch(open, (v) => {
  if (!v) return
  mode.value = 'today'
  custom.value = todayISO()
})

const modes = [
  { value: 'today', label: 'Hoy' },
  { value: 'issue', label: 'Su fecha' },
  { value: 'due', label: 'Su vencimiento' },
  { value: 'custom', label: 'Otra' },
]
const hint = computed(() => ({
  today: `Fecha de hoy, ${fdate(todayISO())}.`,
  issue: 'Cada una con la fecha de su factura.',
  due: 'Cada una con su vencimiento; sin vencimiento, con la fecha de su factura.',
  custom: 'La misma fecha para todas.',
} as Record<string, string>)[mode.value])

function submit() {
  if (mode.value === 'custom' && !custom.value) return
  open.value = false
  emit('apply', { date: mode.value === 'custom' ? custom.value : mode.value, method: method.value })
}
</script>

<template>
  <UiModal v-model="open" :title="title" :subtitle="subtitle" size="sm">
    <form :id="formId" class="paid-form" novalidate @submit.prevent="submit">
      <div class="field">
        <span class="lbl">Fecha del {{ props.what }}</span>
        <UiSegmented v-model="mode" :options="modes" label="Fecha" />
        <p class="hint">{{ hint }}</p>
      </div>
      <UiInput v-if="mode === 'custom'" v-model="custom" type="date" label="Fecha" required />
      <UiSelect v-model="method" :label="`Forma de ${props.what}`" :options="Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))" />
    </form>
    <template #footer>
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" :form="formId" variant="primary" icon="ph:check-bold">{{ confirmLabel }}</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.paid-form {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lbl {
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-2);
}

.field :deep(.seg) {
  width: 100%;
}

.hint {
  font-size: var(--text-xs);
  color: var(--text-3);
}
</style>
