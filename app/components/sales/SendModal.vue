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
const hasSignature = computed(() => !!(!richIsEmpty(designData.value?.design.emailSignature) || designData.value?.signatureImageUrl))

function defaults() {
  form.to = props.doc.contact?.email ?? ''
  form.cc = ''
  form.attachPdf = true
  form.attachOriginal = false
  form.attachmentIds = []
  // Las plantillas de Ajustes › Diseño de factura (las mismas que usan el servidor y las recurrentes)
  const draft = salesEmailDraft(designData.value?.design ?? defaultDesign(), {
    kind: props.doc.kind,
    number: props.doc.number,
    brand: props.companyName,
    firstName: firstName.value,
    client: props.doc.contact?.name ?? '',
    amount: eur(props.doc.total),
    pending: eur(round2(props.doc.total - props.doc.paidTotal)),
    due: props.doc.dueDate ? fdate(props.doc.dueDate) : '',
    reminder: props.reminder,
  })
  form.subject = draft.subject
  form.message = draft.message
  Object.keys(errors).forEach(k => (errors[k] = null))
}

watch(open, (v) => {
  if (v) {
    view.value = 'edit'
    defaults()
  }
})

// ─── Vista previa: el correo tal como lo recibirá el cliente (mismo HTML que el envío, con la firma) ───
const view = ref<'edit' | 'preview'>('edit')
const VIEWS = [{ value: 'edit', label: 'Redactar' }, { value: 'preview', label: 'Vista previa' }]
const preview = ref<{ html: string, from: string, replyTo: string | null } | null>(null)
const previewing = ref(false)
const previewError = ref<string | null>(null)
const frame = ref<HTMLIFrameElement>()
const frameHeight = ref(480)

async function loadPreview() {
  previewing.value = true
  previewError.value = null
  try {
    const r = await $fetch<{ html: string, from: string, replyTo: string | null }>(`/api/sales/${props.doc.id}/send-preview`, {
      method: 'POST',
      body: { subject: form.subject, message: form.message, kind: props.reminder ? 'reminder' : 'document', attachPdf: form.attachPdf },
    })
    // Los enlaces del correo se abren fuera de la vista previa
    preview.value = { ...r, html: r.html.replace('<head>', '<head><base target="_blank">').replace('<html lang="es">', '<html lang="es"><head><base target="_blank"></head>') }
  }
  catch (err) {
    previewError.value = errorMessage(err, 'No se pudo preparar la vista previa')
  }
  finally {
    previewing.value = false
  }
}

watch(view, v => v === 'preview' && loadPreview())

function fitFrame() {
  const body = frame.value?.contentDocument?.body
  if (body) frameHeight.value = Math.max(240, body.scrollHeight + 8)
}

const attachedNames = computed(() => [
  ...(form.attachPdf ? [`${props.doc.number ?? 'documento'}.pdf`] : []),
  ...(form.attachOriginal && props.doc.original ? [props.doc.original.originalName] : []),
  ...props.doc.attachments.filter(a => form.attachmentIds.includes(a.id)).map(a => a.originalName),
])

// ✨ IA en el mensaje: lo que sabe del envío
const aiMessage = computed(() => ({
  field: 'email_message' as const,
  context: () => ({
    documento: props.reminder ? 'recordatorio de pago de una factura' : label.value,
    numero: props.doc.number,
    cliente: props.doc.contact?.name ?? null,
    empresa: props.companyName,
    [isQuote.value ? 'valido_hasta' : 'vencimiento']: props.doc.dueDate ? fdate(props.doc.dueDate) : null,
    pendiente: props.reminder ? eur(round2(props.doc.total - props.doc.paidTotal)) : null,
    nota: 'Sin despedida ni firma: la firma se añade sola al final del correo. Sin el importe salvo en un recordatorio',
  }),
  writeHint: 'Un mensaje breve para acompañar el documento',
}))

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
    if (field && field in errors) {
      errors[field] = errorMessage(err)
      view.value = 'edit'
    }
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
    <UiSegmented v-model="view" :options="VIEWS" label="Redactar o ver el correo" class="views" />

    <!-- Vista previa: el correo que recibirá el cliente -->
    <div v-if="view === 'preview'" class="pv">
      <dl class="pv-head">
        <div><dt>De</dt><dd>{{ preview?.from ?? companyName }}<span v-if="preview?.replyTo" class="muted"> · responde a {{ preview.replyTo }}</span></dd></div>
        <div><dt>Para</dt><dd :class="{ muted: !form.to }">{{ form.to || 'Sin destinatario' }}<template v-if="form.cc"> · CC {{ form.cc }}</template></dd></div>
        <div><dt>Asunto</dt><dd class="strong">{{ form.subject || '(Sin asunto)' }}</dd></div>
        <div v-if="attachedNames.length"><dt>Adjuntos</dt><dd class="pv-att"><span v-for="a in attachedNames" :key="a" class="pv-chip"><Icon name="ph:paperclip" aria-hidden="true" />{{ a }}</span></dd></div>
      </dl>
      <div class="pv-mail" :class="{ loading: previewing }">
        <p v-if="previewError" class="pv-err" role="alert"><Icon name="ph:warning-circle-fill" /> {{ previewError }}</p>
        <iframe
          v-else-if="preview"
          ref="frame"
          :srcdoc="preview.html"
          title="Vista previa del correo"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          :style="{ height: `${frameHeight}px` }"
          @load="fitFrame"
        />
        <div v-else class="pv-wait"><span class="spin" aria-hidden="true" /> Preparando la vista previa…</div>
      </div>
      <p class="hint">Así lo verá el cliente. El PDF y los adjuntos van aparte.</p>
    </div>

    <form v-show="view === 'edit'" id="send-form" class="stack gap-4" novalidate @submit.prevent="send">
      <UiInput v-model="form.to" label="Para" type="email" placeholder="cliente@empresa.es" icon="ph:envelope-simple" :error="errors.to" hint="Varios destinatarios separados por comas" required />
      <UiInput v-model="form.cc" label="CC" placeholder="Opcional" icon="ph:users" />
      <UiInput v-model="form.subject" label="Asunto" :error="errors.subject" required />
      <div class="msg">
        <UiTextarea v-model="form.message" label="Mensaje" rows="9" :error="errors.message" :ai="aiMessage" />
        <p class="sig-note">
          <Icon name="ph:signature" aria-hidden="true" />
          <span v-if="hasSignature">Al final se añade tu firma. <NuxtLink to="/ajustes?s=diseno" class="sig-link">Cambiarla en Ajustes</NuxtLink></span>
          <span v-else>Se despide con «Un saludo, {{ companyName }}». <NuxtLink to="/ajustes?s=diseno" class="sig-link">Crea tu firma en Ajustes</NuxtLink></span>
          <button type="button" class="sig-link pv-link" @click="view = 'preview'">Ver cómo queda</button>
        </p>
      </div>

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

.views {
  margin-bottom: var(--s-4);
}

/* Firma bajo el mensaje */
.sig-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  margin-top: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.sig-note :deep(svg) {
  width: 14px;
  height: 14px;
}

.sig-link {
  font-weight: 560;
  color: var(--brand-text);
}

.sig-link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.pv-link {
  margin-left: auto;
}

/* Vista previa */
.pv {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.pv-head {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 12px 14px;
  font-size: var(--text-sm);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}

.pv-head > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
}

.pv-head dt {
  color: var(--text-3);
}

.pv-head dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.strong {
  font-weight: 600;
}

.pv-att {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pv-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 8px;
  font-size: var(--text-xs);
  background: var(--surface-hover);
  border-radius: 999px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pv-chip :deep(svg) {
  flex: none;
  width: 12px;
  height: 12px;
}

/* El correo se ve siempre sobre su fondo claro, como en el buzón del cliente */
.pv-mail {
  overflow: hidden;
  background: #f5f6f8;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition: opacity var(--t-fast);
}

.pv-mail.loading {
  opacity: 0.6;
}

.pv-mail iframe {
  display: block;
  width: 100%;
  border: 0;
}

.pv-wait,
.pv-err {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  padding: 24px;
  font-size: var(--text-sm);
  color: #626a79;
}

.pv-err {
  color: var(--danger);
}

.spin {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
</style>
