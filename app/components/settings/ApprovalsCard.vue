<script setup lang="ts">
/** Aprobar los gastos del equipo: lo que registran los miembros espera el visto bueno */
const props = withDefaults(defineProps<{ canEdit?: boolean }>(), { canEdit: false })
const toast = useToast()
const { data } = useFetch<{ enabled: boolean }>('/api/company/approvals', { key: 'approvals', lazy: true, server: false })
const busy = ref(false)

async function set(enabled: boolean) {
  busy.value = true
  try {
    data.value = await $fetch<{ enabled: boolean }>('/api/company/approvals', { method: 'PUT', body: { enabled } })
    toast.success(enabled ? 'Aprobación de gastos activada' : 'Aprobación de gastos desactivada', enabled ? 'Lo que registre tu equipo te llegará para aprobar.' : undefined)
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UiCard title="Aprobar los gastos del equipo" icon="ph:check-square-offset" subtitle="Para empresas con empleados que registran tickets y facturas.">
    <UiSwitch
      :model-value="!!data?.enabled"
      :disabled="!props.canEdit || busy"
      label="Los gastos de los miembros necesitan tu aprobación"
      hint="Hasta que un dueño o administrador los apruebe, no cuentan en impuestos, informes ni pagos pendientes. Te avisamos al móvil cuando llegue uno."
      @update:model-value="set"
    />
  </UiCard>
</template>
