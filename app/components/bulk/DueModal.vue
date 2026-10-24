<script setup lang="ts">
/** Vencimiento en lote: unos días después de la fecha de cada documento, una fecha concreta o ninguno */
defineProps<{ title: string, subtitle?: string, late: string }>()
const emit = defineEmits<{ apply: [{ dueDays?: number, dueDate?: string | null }] }>()
const open = defineModel<boolean>({ default: false })

const mode = ref('days')
const days = ref<number | null>(30)
const date = ref(todayISO())
const formId = useId()

watch(open, (v) => {
  if (v) {
    mode.value = 'days'
    days.value = 30
    date.value = todayISO()
  }
})

const modes = [
  { value: 'days', label: 'Días tras su fecha' },
  { value: 'date', label: 'Fecha fija' },
  { value: 'none', label: 'Sin vencimiento' },
]

function submit() {
  if (mode.value === 'days' && days.value == null) return
  if (mode.value === 'date' && !date.value) return
  open.value = false
  emit('apply', mode.value === 'days' ? { dueDays: Math.max(0, Math.round(Number(days.value))) } : { dueDate: mode.value === 'date' ? date.value : null })
}
</script>

<template>
  <UiModal v-model="open" :title="title" :subtitle="subtitle" size="sm">
    <form :id="formId" class="due-form" novalidate @submit.prevent="submit">
      <UiSegmented v-model="mode" :options="modes" label="Vencimiento" />
      <template v-if="mode === 'days'">
        <UiInput v-model="days" numeric suffix="días" label="Plazo desde la fecha de cada una" />
        <div class="presets" role="group" aria-label="Plazos habituales">
          <button v-for="d in [0, 15, 30, 60, 90]" :key="d" type="button" class="preset" :class="{ on: days === d }" @click="days = d">
            {{ d ? `${d} días` : 'Al contado' }}
          </button>
        </div>
      </template>
      <UiInput v-else-if="mode === 'date'" v-model="date" type="date" label="Vencen el" required />
      <p class="tip">
        <Icon name="ph:info" aria-hidden="true" />
        <span>{{ late }}</span>
      </p>
    </form>
    <template #footer>
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" :form="formId" variant="primary" icon="ph:check-bold">Aplicar</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.due-form {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.due-form :deep(.seg) {
  width: 100%;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: calc(-1 * var(--s-2));
}

.preset {
  height: 30px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-full);
  transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
}

.preset:hover {
  color: var(--text);
  border-color: var(--border);
}

.preset.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: var(--brand-soft-2);
}

.preset:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.tip {
  display: flex;
  gap: 8px;
  font-size: var(--text-xs);
  line-height: 1.45;
  color: var(--text-3);
}

.tip :deep(svg) {
  flex: none;
  width: 15px;
  height: 15px;
  margin-top: 1px;
}
</style>
