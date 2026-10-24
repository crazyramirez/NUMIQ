<script setup lang="ts">
/**
 * Cobro online: el enlace de pago del negocio (Stripe, PayPal, SumUp…) y su Bizum. El cliente ve
 * «Paga ahora» en la página de cada factura pendiente. Sin comisiones de NUMIQ: el dinero va directo.
 */
interface Payments { link: string | null, linkLabel: string | null, bizum: string | null }

const props = withDefaults(defineProps<{ canEdit?: boolean }>(), { canEdit: true })
const toast = useToast()
const { data } = useFetch<Payments>('/api/company/payments', { key: 'online-payments', lazy: true, server: false })

const form = reactive({ link: '', linkLabel: '', bizum: '' })
const original = ref('')
watch(data, (d) => {
  if (!d) return
  Object.assign(form, { link: d.link ?? '', linkLabel: d.linkLabel ?? '', bizum: d.bizum ?? '' })
  original.value = JSON.stringify(form)
}, { immediate: true })
const dirty = computed(() => JSON.stringify(form) !== original.value)

const errors = reactive<{ link?: string, bizum?: string }>({})
const saving = ref(false)
const LABELS = ['tarjeta', 'PayPal', 'Stripe', 'Revolut', 'SumUp']

async function save() {
  errors.link = undefined
  errors.bizum = undefined
  saving.value = true
  try {
    const r = await $fetch<Payments>('/api/company/payments', { method: 'PUT', body: { link: form.link, linkLabel: form.linkLabel, bizum: form.bizum } })
    data.value = r
    toast.success('Cobro online guardado', r.link || r.bizum ? 'Tus clientes verán «Paga ahora» en sus facturas pendientes.' : undefined)
  }
  catch (err) {
    const field = errorField(err)
    if (field === 'link' || field === 'bizum') errors[field] = errorMessage(err)
    else toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UiCard title="Cobro online" icon="ph:credit-card" subtitle="Que tus clientes te paguen en un toque desde la factura: con tu enlace de pago o por Bizum. El dinero va directo a tu cuenta.">
    <form class="op" novalidate @submit.prevent="save">
      <fieldset :disabled="!props.canEdit" class="op-fs">
        <UiInput
          v-model="form.link"
          label="Enlace de pago"
          icon="ph:link-simple"
          placeholder="https://buy.stripe.com/… · https://paypal.me/…"
          hint="Crea un enlace de pago en Stripe, PayPal, SumUp o tu banco y pégalo aquí"
          :error="errors.link"
        />
        <div v-if="form.link" class="field">
          <span class="label">Texto del botón</span>
          <div class="chips">
            <button type="button" class="chip" :class="{ on: !form.linkLabel }" @click="form.linkLabel = ''">Pagar online</button>
            <button v-for="l in LABELS" :key="l" type="button" class="chip" :class="{ on: form.linkLabel === l }" @click="form.linkLabel = l">Pagar con {{ l }}</button>
          </div>
        </div>
        <UiInput
          v-model="form.bizum"
          label="Bizum"
          icon="ph:device-mobile"
          inputmode="tel"
          placeholder="612 345 678"
          hint="El móvil con el que cobras por Bizum"
          :error="errors.bizum"
        />
      </fieldset>
      <div v-if="props.canEdit" class="op-foot">
        <UiButton type="submit" variant="primary" :loading="saving" :disabled="!dirty">Guardar</UiButton>
      </div>
    </form>
  </UiCard>
</template>

<style scoped>
.op,
.op-fs {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  height: 30px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
}

.chip.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: transparent;
}

.op-foot {
  display: flex;
  justify-content: flex-end;
}
</style>
