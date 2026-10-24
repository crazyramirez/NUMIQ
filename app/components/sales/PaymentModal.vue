<script setup lang="ts">
const props = defineProps<{ documentId: number, remaining: number, number: string | null, payment?: { id: number, amount: number, date: string, method: string, notes: string | null } | null }>()
const emit = defineEmits<{ saved: [] }>()
const open = defineModel<boolean>({ default: false })
const toast = useToast()

const form = reactive({ amount: props.remaining as number | null, date: todayISO(), method: 'transfer', notes: '' })
const saving = ref(false)
const error = ref<string | null>(null)

watch([open, () => props.payment], ([v]) => {
  if (v) Object.assign(form, props.payment ? { amount: props.payment.amount, date: props.payment.date, method: props.payment.method, notes: props.payment.notes ?? '' } : { amount: props.remaining, date: todayISO(), method: 'transfer', notes: '' })
}, { immediate: true })

const partial = computed(() => (form.amount ?? 0) < props.remaining - 0.005)

async function submit() {
  error.value = null
  if (!form.amount || form.amount <= 0) {
    error.value = 'Indica el importe cobrado'
    return
  }
  saving.value = true
  try {
    const path: string = `/api/sales/${props.documentId}/payments${props.payment ? `/${props.payment.id}` : ''}`
    await $fetch(path, { method: props.payment ? 'PATCH' : 'POST', body: { ...form, notes: form.notes || null } })
    toast.success(props.payment ? 'Cobro actualizado' : partial.value ? 'Cobro parcial registrado' : 'Factura cobrada', `${eur(form.amount)}${props.number ? ` · ${props.number}` : ''}`)
    open.value = false
    emit('saved')
  }
  catch (err) {
    error.value = errorMessage(err)
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" :title="payment ? 'Editar cobro' : 'Registrar cobro'" :subtitle="`${payment ? 'Máximo para este cobro' : 'Pendiente'}: ${eur(remaining)}`" size="sm">
    <form id="payment-form" class="form-grid" @submit.prevent="submit">
      <UiInput v-model="form.amount" class="c-6" label="Importe" numeric suffix="€" :error="error" required />
      <UiInput v-model="form.date" class="c-6" label="Fecha" type="date" required />
      <UiSelect v-model="form.method" label="Forma de cobro" :options="Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))" />
      <UiInput v-model="form.notes" label="Nota" placeholder="Opcional" />
      <p v-if="payment" class="hint">Al cambiar importe, fecha o forma de cobro, su movimiento bancario quedará pendiente de conciliar de nuevo, si estaba vinculado.</p>
      <p v-if="partial" class="hint partial"><Icon name="ph:info" /> Quedará pendiente {{ eur(remaining - (form.amount ?? 0)) }}</p>
    </form>
    <template #footer>
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" form="payment-form" variant="primary" icon="ph:check-bold" :loading="saving">{{ payment ? 'Guardar cambios' : 'Registrar cobro' }}</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.partial {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
