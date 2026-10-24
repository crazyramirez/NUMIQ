<script setup lang="ts">
/** Datos del Impuesto sobre Sociedades que NUMIQ no puede deducir de tus facturas: tamaño, modalidad del 202, última cuota… */
interface Settings {
  size: 'auto' | 'micro' | 'erd' | 'general'
  newEntity: boolean
  patrimonial: boolean
  method: 'cuota' | 'base'
  lastQuota: number | null
  pendingLosses: number
}

const props = defineProps<{ settings: Settings, autoSize: 'micro' | 'erd' | 'general', prevTurnover: number, year: number }>()
const emit = defineEmits<{ saved: [] }>()
const open = defineModel<boolean>({ default: false })

const toast = useToast()
const formId = useId()
const form = ref<Settings>({ ...props.settings })
const saving = ref(false)

watch(open, (v) => {
  if (v) form.value = { ...props.settings }
})

const SIZE: Record<'micro' | 'erd' | 'general', string> = {
  micro: 'Microempresa',
  erd: 'Reducida dimensión',
  general: 'Tipo general',
}
const sizeOptions = computed(() => [
  { value: 'auto', label: `Automático: ${SIZE[props.autoSize].toLowerCase()} (${eur(props.prevTurnover, false)} facturados en ${props.year - 1})` },
  { value: 'micro', label: 'Microempresa · cifra de negocios menor de 1 M €' },
  { value: 'erd', label: 'Reducida dimensión · menor de 10 M €' },
  { value: 'general', label: 'Tipo general · 25 %' },
])
const methodOptions = [
  { value: 'cuota', label: 'Sobre la última cuota' },
  { value: 'base', label: 'Sobre el beneficio del año' },
]
const sizeModel = computed({ get: () => form.value.size, set: v => (form.value.size = v as Settings['size']) })
const methodModel = computed({ get: () => form.value.method, set: v => (form.value.method = v as Settings['method']) })

async function save() {
  saving.value = true
  try {
    await $fetch('/api/taxes/corporate', {
      method: 'PUT',
      body: { ...form.value, lastQuota: form.value.lastQuota == null ? null : Math.max(0, form.value.lastQuota), pendingLosses: Math.max(0, form.value.pendingLosses ?? 0) },
    })
    toast.success('Datos de Sociedades guardados')
    emit('saved')
    open.value = false
  }
  catch (err) {
    toast.error('No se pudieron guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" title="Impuesto sobre Sociedades" subtitle="Lo que hace falta para estimar tu impuesto y tus pagos fraccionados." size="md">
    <form :id="formId" class="stack gap-4" novalidate @submit.prevent="save">
      <UiSelect v-model="sizeModel" label="Tipo de gravamen según el tamaño" :options="sizeOptions" hint="Se mide con la cifra de negocios del año anterior. Los tipos de cada ejercicio (que bajan cada año hasta 2029) se aplican solos." />

      <div class="switches">
        <UiSwitch v-model="form.newEntity" label="Empresa de nueva creación" hint="15 % el primer año con beneficios y el siguiente" />
        <UiSwitch v-model="form.patrimonial" label="Entidad patrimonial" hint="Gestiona sobre todo inmuebles o valores, sin actividad: siempre al 25 %" />
      </div>

      <div class="field">
        <span class="label">Pagos fraccionados (modelo 202)</span>
        <UiSegmented v-model="methodModel" :options="methodOptions" label="Modalidad del pago fraccionado" />
        <p class="hint">
          {{ form.method === 'cuota'
            ? 'La habitual: el 18 % de la cuota de tu último Impuesto sobre Sociedades, igual en los tres pagos.'
            : 'El porcentaje sobre lo que ganas este año (5/7 de tu tipo). Conviene si este año ganas menos que el anterior; hay que pedirla en el censo (036) en febrero.' }}
        </p>
      </div>

      <UiInput
        v-if="form.method === 'cuota'"
        v-model="form.lastQuota"
        numeric
        suffix="€"
        label="Cuota de tu último Impuesto sobre Sociedades"
        placeholder="Sin indicar"
        hint="Del último modelo 200 presentado: cuota íntegra menos deducciones, bonificaciones, retenciones e ingresos a cuenta. Si no tuviste beneficios, 0."
      />

      <UiInput
        v-model="form.pendingLosses"
        numeric
        suffix="€"
        label="Bases negativas pendientes de compensar"
        placeholder="0"
        hint="Pérdidas fiscales de años anteriores que aún no has descontado: reducen la base de este año."
      />
    </form>

    <template #footer>
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" :form="formId" variant="primary" icon="ph:check-bold" :loading="saving">Guardar</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.switches {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field > :deep(.seg) {
  align-self: flex-start;
}
</style>
