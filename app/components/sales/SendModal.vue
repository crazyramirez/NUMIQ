<script setup lang="ts">
/** Enviar factura/presupuesto o recordatorio de pago por email, con el PDF y los adjuntos elegidos */
const props = defineProps<{
  doc: {
    id: number
    kind: string
    number: string | null
    total: number
    paidTotal: number
    dueDate: string | null
    contact: { name: string, email?: string | null, kind?: 'company' | 'person' } | null
    attachments: Array<{ id: number, originalName: string, size: number }>
    /** Archivo importado o escaneado del que sale la factura */
    original?: { id: number, originalName: string, size: number } | null
  }
  companyName: string
  reminder?: boolean
}>()
const emit = defineEmits<{ sent: [] }>()
const open = defineModel<boolean>({ default: false })
const toast = useToast()

const isQuote = computed(() => props.doc.kind === 'quote' || props.doc.kind === 'proforma')
const label = computed(() => (isQuote.value ? 'presupuesto' : props.doc.kind === 'rectifying' ? 'factura rectificativa' : 'factura'))
// Saludo con el nombre de pila solo para personas; a una empresa, "Hola:"
const firstName = computed(() => (props.doc.contact?.kind === 'person' ? props.doc.contact.name.split(' ')[0] ?? '' : ''))

const form = reactive({ to: '', cc: '', subject: '', message: '', attachPdf: true, attachOriginal: false, attachmentIds: [] as number[] })
const errors = reactive<Record<string, string | null>>({ to: null, subject: null, message: null })
const sending = ref(false)

const { data: mail } = useFetch<{ configured: boolean, account: string | null }>('/api/mail/status', { lazy: true, server: false })
const { data: designData } = useFetch<{ design: InvoiceDesign, signatureImageUrl: string | null }>('/api/invoice-design', { lazy: true, server: false })
const hasSignature = computed(() => !!(designData.value?.design.emailSignature.trim() || designData.value?.signatureImageUrl))

function defaults() {
  const n = props.doc.number ?? ''
  const pending = round2(props.doc.total - props.doc.paidTotal)
  form.to = props.doc.contact?.email ?? ''
  form.cc = ''
  form.attachPdf = true
  form.attachOriginal = false
  form.attachmentIds = []
  const d = designData.value?.design
  const tokens: Record<string, string> = {
    cliente: firstName.value || props.doc.contact?.name || '',
    numero: n,
    importe: eur(props.doc.total),
    vencimiento: props.doc.dueDate ? fdate(props.doc.dueDate) : '',
    empresa: props.companyName,
    tipo: label.value,
  }

  if (props.reminder) {
    form.subject = `Recordatorio de pago · factura ${n}`
    form.message = `Hola${firstName.value ? `, ${firstName.value}` : ''}:\n\nTe escribimos para recordarte que la factura ${n} tiene ${eur(pending)} pendientes de pago${props.doc.dueDate ? ` desde el ${fdate(props.doc.dueDate)}` : ''}.\n\nSi ya la has abonado, ignora este mensaje. Te adjuntamos de nuevo la factura por si la necesitas.\n\nUn saludo,\n${props.companyName}`
  }
  else if (isQuote.value) {
    const customSubject = d?.defaultEmailSubjectQuote
    const customMessage = d?.defaultEmailMessageQuote
    form.subject = customSubject ? renderEmailTemplate(customSubject, tokens) : `Presupuesto ${n} · ${props.companyName}`
    form.message = customMessage
      ? renderEmailTemplate(customMessage, tokens)
      : `Hola${firstName.value ? `, ${firstName.value}` : ''}:\n\nTe enviamos el presupuesto ${n} por ${eur(props.doc.total)}. Quedamos a tu disposición para cualquier duda o ajuste.\n\nUn saludo,\n${props.companyName}`
  }
  else {
    const customSubject = d?.defaultEmailSubject
    const customMessage = d?.defaultEmailMessage
    form.subject = customSubject ? renderEmailTemplate(customSubject, tokens) : `${label.value.charAt(0).toUpperCase()}${label.value.slice(1)} ${n} · ${props.companyName}`
    form.message = customMessage
      ? renderEmailTemplate(customMessage, tokens)
      : `Hola${firstName.value ? `, ${firstName.value}` : ''}:\n\nTe enviamos la ${label.value} ${n} por importe de ${eur(props.doc.total)}${props.doc.dueDate ? `, con vencimiento el ${fdate(props.doc.dueDate)}` : ''}.\n\nGracias por tu confianza.\n\nUn saludo,\n${props.companyName}`
  }
  Object.keys(errors).forEach(k => (errors[k] = null))
}

watch(open, (v) => {
  if (v) defaults()
})

watch(designData, () => {
  if (open.value && !form.message) defaults()
})

const sizeLabel = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

async function send() {
  Object.keys(errors).forEach(k => (errors[k] = null))
  sending.value = true
  try {
    await $fetch(`/api/sales/${props.doc.id}/send`, {
      method: 'POST',
      body: { ...form, kind: props.reminder ? 'reminder' : 'document' },
    })
    toast.success(props.reminder ? 'Recordatorio enviado' : `${label.value.charAt(0).toUpperCase()}${label.value.slice(1)} ${isQuote.value ? 'enviado' : 'enviada'}`, `A ${form.to}`)
    open.value = false
    emit('sent')
  }
  catch (err) {
    const field = errorField(err)?.split('.')[0]
    if (field && field in errors) errors[field] = errorMessage(err)
    else toast.error('No se pudo enviar', errorMessage(err))
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" :title="reminder ? 'Enviar recordatorio de pago' : `Enviar ${label}`" :subtitle="doc.number ?? undefined" size="lg" side>
    <div v-if="mail && !mail.configured" class="warn">
      <Icon name="ph:warning-circle-fill" />
      <div>
        <strong>El correo no está configurado</strong>
        <p>Añade GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD (contraseña de aplicación de Gmail) en el archivo .env del servidor.</p>
      </div>
    </div>
    <form id="send-form" class="stack gap-4" novalidate @submit.prevent="send">
      <UiInput v-model="form.to" label="Para" type="email" placeholder="cliente@empresa.es" icon="ph:envelope-simple" :error="errors.to" hint="Varios destinatarios separados por comas" required />
      <UiInput v-model="form.cc" label="CC" placeholder="Opcional" icon="ph:users" />
      <UiInput v-model="form.subject" label="Asunto" :error="errors.subject" required />
      <UiTextarea v-model="form.message" label="Mensaje" rows="9" :error="errors.message" :hint="hasSignature ? 'Al final se añade tu firma (Ajustes › Diseño de factura)' : undefined" />

      <div class="att">
        <span class="label">Adjuntos</span>
        <label class="att-row">
          <input v-model="form.attachPdf" type="checkbox">
          <span class="att-ic pdf"><Icon name="ph:file-pdf-fill" /></span>
          <span class="grow truncate">{{ (doc.number ?? 'documento') }}.pdf</span>
          <span class="muted small">PDF con tu diseño</span>
        </label>
        <label v-if="doc.original" class="att-row">
          <input v-model="form.attachOriginal" type="checkbox">
          <span class="att-ic"><Icon name="ph:file-text" /></span>
          <span class="grow truncate">{{ doc.original.originalName }}</span>
          <span class="muted small">Original · {{ sizeLabel(doc.original.size) }}</span>
        </label>
        <label v-for="a in doc.attachments" :key="a.id" class="att-row">
          <input v-model="form.attachmentIds" type="checkbox" :value="a.id">
          <span class="att-ic"><Icon name="ph:paperclip" /></span>
          <span class="grow truncate">{{ a.originalName }}</span>
          <span class="muted small">{{ sizeLabel(a.size) }}</span>
        </label>
        <p v-if="!(isQuote && form.attachPdf)" class="hint">El correo incluye además un enlace seguro para ver el documento online.</p>
      </div>
    </form>
    <template #footer>
      <span v-if="mail?.account" class="from muted">Desde {{ mail.account }}</span>
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" form="send-form" variant="primary" icon="ph:paper-plane-tilt" :loading="sending" :disabled="mail ? !mail.configured : false">Enviar</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.warn {
  display: flex;
  gap: 10px;
  margin-bottom: var(--s-4);
  padding: 12px 14px;
  font-size: var(--text-sm);
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: var(--r-md);
}

.warn :deep(svg) {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 1px;
}

.warn p {
  color: var(--text-2);
}

.att {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.att-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background var(--t-fast), border-color var(--t-fast);
}

.att-row:hover {
  background: var(--surface-hover);
}

.att-row:has(input:checked) {
  border-color: color-mix(in srgb, var(--brand) 45%, var(--border));
  background: var(--brand-soft);
}

.att-row input {
  width: 16px;
  height: 16px;
  accent-color: var(--brand);
}

.att-ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  font-size: 16px;
  color: var(--text-3);
  background: var(--surface-sunken);
  border-radius: var(--r-sm);
}

.att-ic.pdf {
  color: var(--danger-solid);
  background: var(--danger-soft);
}

.small {
  font-size: var(--text-xs);
}

.from {
  margin-right: auto;
  font-size: var(--text-xs);
}
</style>
