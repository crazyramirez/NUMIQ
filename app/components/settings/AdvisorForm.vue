<script setup lang="ts">
/** Datos del gestor o asesoría: a quién se envía la documentación de cada periodo */
export interface Advisor {
  name: string | null
  firm: string | null
  email: string | null
  cc: string[]
  phone: string | null
  message: string | null
}

const props = withDefaults(defineProps<{ canEdit?: boolean, compact?: boolean }>(), { canEdit: true })
const emit = defineEmits<{ saved: [advisor: Advisor | null] }>()
const toast = useToast()

const blank = () => ({ name: '', firm: '', email: '', cc: '', phone: '', message: '' })
const form = ref(blank())
const original = ref('')
const errors = ref<Record<string, string>>({})
const saving = ref(false)
const loading = ref(true)

onMounted(async () => {
  try {
    const r = await $fetch<{ advisor: Advisor | null }>('/api/advisor')
    const a = r.advisor
    form.value = a ? { name: a.name ?? '', firm: a.firm ?? '', email: a.email ?? '', cc: a.cc.join(', '), phone: a.phone ?? '', message: a.message ?? '' } : blank()
  }
  finally {
    original.value = JSON.stringify(form.value)
    loading.value = false
  }
})

const dirty = computed(() => JSON.stringify(form.value) !== original.value)

async function save() {
  errors.value = {}
  saving.value = true
  try {
    const r = await $fetch<{ advisor: Advisor | null }>('/api/advisor', { method: 'PUT', body: form.value })
    original.value = JSON.stringify(form.value)
    toast.success('Datos del gestor guardados')
    emit('saved', r.advisor)
  }
  catch (err) {
    const field = errorField(err)
    if (field) errors.value[field] = errorMessage(err)
    else toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="adv" novalidate @submit.prevent="save">
    <div v-if="loading" class="stack gap-3">
      <div v-for="i in 3" :key="i" class="skeleton" style="height: 40px" />
    </div>
    <fieldset v-else :disabled="!props.canEdit" class="fs">
      <div class="form-grid">
        <UiInput v-model="form.name" class="c-6" label="Nombre del gestor" placeholder="Ej. Carmen Prado" autocomplete="off" :error="errors.name" />
        <UiInput v-model="form.firm" class="c-6" label="Asesoría" placeholder="Ej. Asesoría Fiscal Prado SL" autocomplete="off" :error="errors.firm" />
        <UiInput v-model="form.email" class="c-6" label="Email" type="email" placeholder="gestor@asesoria.es" icon="ph:envelope-simple" :error="errors.email" />
        <UiInput v-model="form.phone" class="c-6" label="Teléfono" type="tel" :error="errors.phone" />
        <UiInput v-model="form.cc" class="c-12" label="En copia (opcional)" placeholder="Otro email de la asesoría, separados por comas" :error="errors.cc" />
        <UiTextarea v-if="!compact" v-model="form.message" class="c-12" label="Mensaje habitual (opcional)" placeholder="Hola Carmen: te envío la documentación del trimestre. Cualquier cosa, me dices." :error="errors.message" />
      </div>
    </fieldset>
    <div v-if="props.canEdit && !loading" class="actions">
      <slot name="actions" />
      <UiButton type="submit" variant="primary" icon="ph:check-bold" :loading="saving" :disabled="!dirty">Guardar</UiButton>
    </div>
  </form>
</template>

<style scoped>
.fs {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.form-grid .c-12 {
  grid-column: span 12;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--s-2);
  margin-top: var(--s-5);
}
</style>
