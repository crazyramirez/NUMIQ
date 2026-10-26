<script setup lang="ts">
import type { AdvisorAccess } from '~/composables/useMe'

/** Qué puede subir el gestor a la empresa; por lo demás solo consulta */
const props = withDefaults(defineProps<{ canEdit?: boolean }>(), { canEdit: false })
const toast = useToast()
const { data } = useFetch<AdvisorAccess>('/api/company/advisor-access', { key: 'advisor-access', lazy: true, server: false })
const busy = ref<keyof AdvisorAccess | null>(null)

const OPTIONS: Array<{ key: keyof AdvisorAccess, label: string, hint: string }> = [
  { key: 'payroll', label: 'Nóminas', hint: 'Las sube al archivo de cada trimestre (Documentos → Archivo → Nóminas).' },
  { key: 'taxes', label: 'Impuestos', hint: 'Registra los modelos que presenta con su justificante y sube documentos a Impuestos.' },
  { key: 'bank', label: 'Extractos del banco', hint: 'Importa extractos en Banco y quedan en el archivo. No concilia movimientos.' },
  { key: 'archive', label: 'Otros documentos', hint: 'Contratos, seguros y el resto de carpetas del archivo.' },
]

async function set(key: keyof AdvisorAccess, on: boolean) {
  if (!data.value) return
  busy.value = key
  try {
    data.value = await $fetch<AdvisorAccess>('/api/company/advisor-access', { method: 'PUT', body: { ...data.value, [key]: on } })
    toast.success('Permisos del gestor guardados')
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}
</script>

<template>
  <UiCard title="Qué puede subir tu gestor" icon="ph:briefcase" subtitle="Por lo demás solo consulta: nunca crea, cambia ni borra facturas, gastos ni los datos de la empresa.">
    <div class="opts">
      <UiSwitch
        v-for="o in OPTIONS"
        :key="o.key"
        :model-value="!!data?.[o.key]"
        :disabled="!props.canEdit || !data || busy !== null"
        :label="o.label"
        :hint="o.hint"
        @update:model-value="set(o.key, $event)"
      />
    </div>
  </UiCard>
</template>

<style scoped>
.opts {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}
</style>
