<script setup lang="ts">
/**
 * Diseño de factura a medida: estructura, color, tipografía, logo y textos, con la vista previa
 * del PDF real (el mismo que reciben los clientes) actualizándose mientras se edita.
 */
const props = defineProps<{ canEdit: boolean }>()
const emit = defineEmits<{ saved: [accent: string] }>()
const toast = useToast()
const { confirm } = useConfirm()

const { data, refresh } = await useFetch<{ design: InvoiceDesign, logoUrl: string | null }>('/api/invoice-design')
const saved = ref<InvoiceDesign>(normalizeDesign(data.value?.design))
const d = reactive<InvoiceDesign>({ ...saved.value })
const logoUrl = ref(data.value?.logoUrl ?? null)
const dirty = computed(() => JSON.stringify(d) !== JSON.stringify(saved.value))

const LAYOUTS: Array<{ value: DesignLayout, label: string, hint: string }> = [
  { value: 'modern', label: 'Moderna', hint: 'Limpia, con franja de color' },
  { value: 'classic', label: 'Clásica', hint: 'Centrada y enmarcada' },
  { value: 'minimal', label: 'Minimalista', hint: 'Aire y líneas finas' },
  { value: 'bold', label: 'Impacto', hint: 'Cabecera a todo color' },
]
const COLORS = ['#4f46e5', '#7c3aed', '#0369a1', '#0f766e', '#15803d', '#c2410c', '#be123c', '#111827']
const FONTS: Array<{ value: DesignFont, label: string, hint: string }> = [
  { value: 'Inter', label: 'Inter', hint: 'Neutra y precisa' },
  { value: 'Manrope', label: 'Manrope', hint: 'Geométrica y moderna' },
  { value: 'Lora', label: 'Lora', hint: 'Serif elegante' },
]

// ─── Vista previa: el PDF real, regenerado con cada cambio ───────────────────
// Columnas de la tabla de conceptos
const LINE_COLUMN_OPTIONS: Array<{ value: LineColumnsMode, label: string, hint: string }> = [
  { value: 'auto', label: 'Automática', hint: 'Cantidad y precio solo si alguna cantidad no es 1; IVA solo si hay varios tipos' },
  { value: 'full', label: 'Completa', hint: 'Concepto, cantidad, precio, IVA e importe en todas las facturas' },
  { value: 'amount', label: 'Concepto e importe', hint: 'Cada concepto con su importe, sin cantidades ni IVA por línea' },
  { value: 'concept', label: 'Solo concepto', hint: 'Lista de conceptos; los importes, solo en el cuadro de totales' },
]

const previewKind = ref<'invoice' | 'quote'>('invoice')
const previewKindOptions = [
  { value: 'invoice', label: 'Factura' },
  { value: 'quote', label: 'Presupuesto' },
]

const previewUrl = ref<string | null>(null)
const previewBytes = shallowRef<ArrayBuffer | null>(null)
const previewing = ref(false)
const previewError = ref<string | null>(null)
let seq = 0

async function renderPreview() {
  const mine = ++seq
  previewing.value = true
  previewError.value = null
  try {
    const blob = await $fetch<Blob>('/api/invoice-design/preview', {
      method: 'POST',
      query: { kind: previewKind.value },
      body: { ...d },
      responseType: 'blob',
    })
    if (mine !== seq) return
    const bytes = await blob.arrayBuffer()
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = URL.createObjectURL(blob)
    previewBytes.value = bytes
  }
  catch (err) {
    if (mine === seq) previewError.value = errorMessage(err, 'No se pudo generar la vista previa')
  }
  finally {
    if (mine === seq) previewing.value = false
  }
}

const schedulePreview = useDebounceFn(renderPreview, 450)
watch(d, () => {
  schedulePreview()
  if (props.canEdit && dirty.value) {
    debouncedAutoSave()
  }
}, { deep: true })
watch(previewKind, renderPreview)
onMounted(renderPreview)
onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewBytes.value = null
})

// ─── Logo ────────────────────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const dragging = ref(false)

async function uploadLogo(file: File | undefined) {
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    toast.error('El logo supera 2 MB', 'Prueba con un PNG o SVG más ligero.')
    return
  }
  uploading.value = true
  try {
    const body = new FormData()
    body.append('file', file)
    const r = await $fetch<{ logoUrl: string }>('/api/company/logo', { method: 'POST', body })
    logoUrl.value = r.logoUrl
    d.showLogo = true
    toast.success('Logo actualizado')
    renderPreview()
  }
  catch (err) {
    toast.error('No se pudo subir el logo', errorMessage(err))
  }
  finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false
  if (props.canEdit) uploadLogo(e.dataTransfer?.files?.[0])
}

async function removeLogo() {
  if (!(await confirm({ title: '¿Quitar el logo?', body: 'Tus documentos mostrarán el nombre de la empresa en su lugar.', confirmLabel: 'Quitar', danger: true }))) return
  try {
    await $fetch('/api/company/logo', { method: 'DELETE' })
    logoUrl.value = null
    renderPreview()
  }
  catch (err) {
    toast.error('No se pudo quitar el logo', errorMessage(err))
  }
}

// ─── Guardar y Autoguardado ──────────────────────────────────────────────────
const saving = ref(false)
const autoSaving = ref(false)
const lastSaved = ref<Date | null>(null)

async function save(silent: boolean | Event = false) {
  const isSilent = typeof silent === 'boolean' ? silent : false
  if (!props.canEdit) return
  saving.value = true
  if (isSilent) autoSaving.value = true
  try {
    await $fetch('/api/invoice-design', { method: 'PUT', body: { ...d } })
    saved.value = { ...d }
    lastSaved.value = new Date()
    emit('saved', d.accentColor)
    if (!isSilent) toast.success('Diseño guardado', 'Se aplica a todos tus PDF y correos desde ahora.')
    refresh()
  }
  catch (err) {
    if (!isSilent) toast.error('No se pudo guardar el diseño', errorMessage(err))
  }
  finally {
    saving.value = false
    autoSaving.value = false
  }
}

const debouncedAutoSave = useDebounceFn(() => {
  if (props.canEdit && dirty.value) {
    save(true)
  }
}, 600)

function reset() {
  Object.assign(d, saved.value)
}

function downloadPreview() {
  if (!previewUrl.value) return
  const a = document.createElement('a')
  a.href = previewUrl.value
  a.download = previewKind.value === 'quote' ? 'Vista-previa-presupuesto.pdf' : 'Vista-previa-factura.pdf'
  a.click()
}

const fontStyle = (f: DesignFont) => ({ fontFamily: f === 'Inter' ? 'var(--font-sans)' : `'${f}', serif` })

const emailTab = ref<'invoice' | 'quote'>('invoice')

const EMAIL_TOKENS = [
  { k: '{cliente}', l: 'Cliente' },
  { k: '{numero}', l: 'Nº doc.' },
  { k: '{importe}', l: 'Importe' },
  { k: '{vencimiento}', l: 'Vencimiento' },
  { k: '{empresa}', l: 'Empresa' },
]

function insertToken(kind: 'invoice' | 'quote', token: string) {
  if (kind === 'invoice') {
    const cur = d.defaultEmailMessage ?? ''
    d.defaultEmailMessage = `${cur}${cur && !/\s$/.test(cur) ? ' ' : ''}${token}`
  }
  else {
    const cur = d.defaultEmailMessageQuote ?? ''
    d.defaultEmailMessageQuote = `${cur}${cur && !/\s$/.test(cur) ? ' ' : ''}${token}`
  }
}
</script>

<template>
  <div class="designer">
    <div class="controls">
      <UiCard title="Estructura" subtitle="La base de tus facturas y presupuestos" icon="ph:layout">
        <div class="layouts" role="radiogroup" aria-label="Estructura">
          <button
            v-for="l in LAYOUTS"
            :key="l.value"
            type="button"
            role="radio"
            :aria-checked="d.layout === l.value"
            class="layout"
            :class="{ on: d.layout === l.value }"
            :disabled="!canEdit"
            :style="{ '--a': d.accentColor }"
            @click="d.layout = l.value"
          >
            <span class="thumb" :class="`t-${l.value}`" aria-hidden="true">
              <i class="t-band" /><i class="t-bar" /><i class="t-title" /><i class="t-rule" />
              <i class="t-row" /><i class="t-row" /><i class="t-row" /><i class="t-total" />
            </span>
            <span class="l-name">{{ l.label }}</span>
            <span class="l-hint">{{ l.hint }}</span>
          </button>
        </div>
      </UiCard>

      <UiCard title="Color y tipografía" icon="ph:palette">
        <div class="stack gap-4">
          <div class="field">
            <span class="label">Color de acento</span>
            <div class="swatches">
              <button
                v-for="c in COLORS"
                :key="c"
                type="button"
                class="sw"
                :class="{ on: d.accentColor.toLowerCase() === c }"
                :style="{ background: c }"
                :aria-label="`Color ${c}`"
                :disabled="!canEdit"
                @click="d.accentColor = c"
              >
                <Icon v-if="d.accentColor.toLowerCase() === c" name="ph:check-bold" :style="{ color: onColor(c) }" />
              </button>
              <label class="sw custom" :style="{ background: COLORS.includes(d.accentColor.toLowerCase()) ? undefined : d.accentColor }" title="Color personalizado">
                <Icon name="ph:eyedropper" :style="{ color: COLORS.includes(d.accentColor.toLowerCase()) ? undefined : onColor(d.accentColor) }" />
                <input v-model="d.accentColor" type="color" :disabled="!canEdit" aria-label="Color personalizado">
              </label>
            </div>
          </div>
          <div class="field">
            <span class="label">Tipografía</span>
            <div class="fonts" role="radiogroup" aria-label="Tipografía">
              <button
                v-for="f in FONTS"
                :key="f.value"
                type="button"
                role="radio"
                :aria-checked="d.font === f.value"
                class="font"
                :class="{ on: d.font === f.value }"
                :disabled="!canEdit"
                @click="d.font = f.value"
              >
                <span class="aa" :style="fontStyle(f.value)">Aa</span>
                <span class="f-name">{{ f.label }}</span>
                <span class="f-hint">{{ f.hint }}</span>
              </button>
            </div>
          </div>
        </div>
      </UiCard>

      <UiCard title="Logo" icon="ph:image-square">
        <div class="stack gap-4">
          <div
            class="drop"
            :class="{ dragging, has: !!logoUrl }"
            @dragover.prevent="dragging = canEdit"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
          >
            <img v-if="logoUrl" :src="logoUrl" alt="Logo actual" class="logo-img">
            <div v-else class="drop-empty">
              <Icon name="ph:upload-simple" class="drop-ic" />
              <p class="no-touch"><strong>Arrastra tu logo</strong> o elígelo</p>
              <p class="touch-only"><strong>Sube tu logo</strong></p>
              <p class="hint">PNG o SVG con fondo transparente · máx. 2 MB</p>
            </div>
            <div v-if="canEdit" class="drop-actions">
              <UiButton size="sm" :icon="logoUrl ? 'ph:arrows-clockwise' : 'ph:folder-open'" :loading="uploading" @click="fileInput?.click()">{{ logoUrl ? 'Cambiar' : 'Elegir archivo' }}</UiButton>
              <UiButton v-if="logoUrl" size="sm" variant="ghost" icon="ph:trash" @click="removeLogo">Quitar</UiButton>
            </div>
            <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/svg+xml" class="sr-only" @change="uploadLogo(($event.target as HTMLInputElement).files?.[0])">
          </div>
          <UiSwitch v-model="d.showLogo" :disabled="!canEdit || !logoUrl" label="Mostrar el logo en los documentos" hint="Sin logo se muestra el nombre comercial" />
        </div>
      </UiCard>

      <UiCard title="Contenido" icon="ph:list-checks">
        <div class="stack gap-4">
          <UiSelect v-model="d.lineColumns" label="Tabla de conceptos" :options="LINE_COLUMN_OPTIONS" :disabled="!canEdit" :hint="LINE_COLUMN_OPTIONS.find(o => o.value === d.lineColumns)?.hint" />
          <UiSwitch v-if="d.lineColumns === 'auto' || d.lineColumns === 'full'" :model-value="d.discountColumn === 'always'" :disabled="!canEdit" label="Columna de descuento siempre visible" hint="Si no, solo aparece cuando alguna línea lleva descuento" @update:model-value="d.discountColumn = $event ? 'always' : 'auto'" />
          <UiSwitch v-model="d.showItemCodes" :disabled="!canEdit" label="Referencia de producto (SKU)" hint="Columna «Ref.» con el código de tu catálogo" />
          <UiSwitch v-model="d.showPaymentInfo" :disabled="!canEdit" label="Datos de pago" hint="IBAN y texto de pago al pie de las facturas" />
          <UiTextarea v-model="d.paymentText" label="Texto de pago" placeholder="Pago a 30 días mediante transferencia bancaria.&#10;Indica el número de factura en el concepto." hint="Puedes usar varias líneas" rows="3" maxlength="500" :disabled="!canEdit || !d.showPaymentInfo" />
          <UiInput
            v-model="d.customerReferenceLabel"
            label="Etiqueta para orden de pedido o referencia"
            placeholder="Orden de Pedido"
            hint="Texto que encabeza el número de pedido en la factura (por defecto: Orden de Pedido)"
            maxlength="40"
            :disabled="!canEdit"
          />
          <UiTextarea v-model="d.footerText" label="Pie de página legal" placeholder="Inscrita en el Registro Mercantil de… · Protección de datos: …" hint="Aparece en todas las páginas. Vacío: tu razón social, NIF y contacto" rows="3" maxlength="600" :disabled="!canEdit" />
        </div>
      </UiCard>

      <UiCard title="Observaciones y condiciones" icon="ph:note-pencil">
        <div class="stack gap-4">
          <div class="form-grid">
            <UiInput v-model="d.notesLabel" class="c-6" label="Título en facturas" placeholder="Sin título" hint="Vacío: el texto va sin título" maxlength="40" :disabled="!canEdit" />
            <UiInput v-model="d.termsLabel" class="c-6" label="Título en presupuestos" placeholder="Sin título" hint="Vacío: el texto va sin título" maxlength="40" :disabled="!canEdit" />
          </div>
          <UiTextarea v-model="d.defaultNotes" label="Observaciones por defecto" placeholder="Ej. Gracias por confiar en nosotros." hint="Aparecen ya escritas en cada factura nueva; puedes cambiarlas en cada una" rows="3" maxlength="1000" :disabled="!canEdit" />
          <UiTextarea v-model="d.defaultTerms" label="Condiciones por defecto" placeholder="Validez, plazos de entrega, forma de pago…" hint="Aparecen ya escritas en cada presupuesto nuevo" rows="3" maxlength="1000" :disabled="!canEdit" />
        </div>
      </UiCard>

      <UiCard title="Envío por email" icon="ph:paper-plane-tilt">
        <div class="stack gap-4">
          <p class="card-intro-text">Personaliza el asunto y el mensaje que se rellenan automáticamente al enviar facturas o presupuestos por correo a tus clientes.</p>

          <UiSegmented
            v-model="emailTab"
            :options="[
              { value: 'invoice', label: 'Factura' },
              { value: 'quote', label: 'Presupuesto' },
            ]"
            label="Tipo de documento para email"
          />

          <template v-if="emailTab === 'invoice'">
            <UiInput
              v-model="d.defaultEmailSubject"
              label="Asunto por defecto"
              placeholder="Factura {numero} · {empresa}"
              maxlength="200"
              :disabled="!canEdit"
            />
            <div class="field">
              <div class="tok-head">
                <span class="label">Mensaje por defecto</span>
                <span class="tok-label">Insertar campo:</span>
              </div>
              <div class="tokens">
                <button
                  v-for="t in EMAIL_TOKENS"
                  :key="t.k"
                  type="button"
                  class="token"
                  :disabled="!canEdit"
                  :title="`Insertar ${t.l}`"
                  @click="insertToken('invoice', t.k)"
                >
                  <Icon name="ph:plus" /> {{ t.k }} <span class="tok-desc">({{ t.l }})</span>
                </button>
              </div>
              <UiTextarea
                v-model="d.defaultEmailMessage"
                rows="6"
                placeholder="Hola, {cliente}:\n\nTe enviamos la factura..."
                maxlength="3000"
                :disabled="!canEdit"
              />
            </div>
          </template>

          <template v-else>
            <UiInput
              v-model="d.defaultEmailSubjectQuote"
              label="Asunto por defecto"
              placeholder="Presupuesto {numero} · {empresa}"
              maxlength="200"
              :disabled="!canEdit"
            />
            <div class="field">
              <div class="tok-head">
                <span class="label">Mensaje por defecto</span>
                <span class="tok-label">Insertar campo:</span>
              </div>
              <div class="tokens">
                <button
                  v-for="t in EMAIL_TOKENS.filter(x => x.k !== '{vencimiento}')"
                  :key="t.k"
                  type="button"
                  class="token"
                  :disabled="!canEdit"
                  :title="`Insertar ${t.l}`"
                  @click="insertToken('quote', t.k)"
                >
                  <Icon name="ph:plus" /> {{ t.k }} <span class="tok-desc">{{ t.l }}</span>
                </button>
              </div>
              <UiTextarea
                v-model="d.defaultEmailMessageQuote"
                rows="6"
                placeholder="Hola, {cliente}:\n\nTe enviamos el presupuesto..."
                maxlength="3000"
                :disabled="!canEdit"
              />
            </div>
          </template>
        </div>
      </UiCard>
    </div>

    <div class="preview-col">
      <div class="preview card">
        <div class="pv-head">
          <div class="pv-head-left">
            <span class="row gap-2 ai-center">
              <Icon name="ph:file-pdf" class="pv-ic" />
              <span class="section-title">Vista previa</span>
            </span>
            <UiSegmented
              v-model="previewKind"
              :options="previewKindOptions"
              label="Tipo de documento a previsualizar"
            />
          </div>
          <span v-if="previewing || autoSaving || saving" class="pv-state"><span class="spin" /> Guardando y actualizando…</span>
          <span v-else class="pv-state ok"><Icon name="ph:check-circle-fill" /> Guardado automáticamente</span>
        </div>
        <div class="pv-body">
          <DocsPdfPreview
            v-if="previewBytes || previewUrl"
            :data="previewBytes"
            :url="previewUrl"
            :label="previewKind === 'quote' ? 'Vista previa del presupuesto en PDF' : 'Vista previa de la factura en PDF'"
            class="pv-frame"
            :class="{ dim: previewing }"
          />
          <div v-else-if="previewError" class="pv-empty"><Icon name="ph:warning-circle" /> {{ previewError }}</div>
          <div v-else class="pv-empty"><span class="skeleton pv-sk" /></div>
          <a v-if="previewUrl" :href="previewUrl" target="_blank" rel="noopener" class="pv-open">
            <Icon name="ph:arrow-square-out" /> Abrir vista previa
          </a>
        </div>
      </div>
    </div>

    <Transition name="bar">
      <div v-if="dirty && canEdit" class="save-bar" role="region" aria-label="Diseño sin guardar">
        <span class="dot" />
        <span class="grow">Cambios en el diseño sin guardar</span>
        <UiButton variant="ghost" @click="reset">Descartar</UiButton>
        <UiButton icon="ph:download-simple" class="dl" :disabled="!previewUrl" @click="downloadPreview">PDF de prueba</UiButton>
        <UiButton variant="primary" icon="ph:check-bold" :loading="saving" @click="save">Guardar diseño</UiButton>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.designer {
  display: grid;
  grid-template-columns: minmax(0, 400px) minmax(0, 1fr);
  gap: var(--s-5);
  align-items: start;
  padding-bottom: var(--s-9);
}

.controls {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

/* Estructuras con miniatura dibujada */
.layouts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-3);
}

.layout {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px;
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface);
  transition: border-color var(--t-fast), box-shadow var(--t-base);
}

.layout:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.layout.on {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-ring);
}

.thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 210 / 150;
  margin-bottom: 8px;
  overflow: hidden;
  background: #fff;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px #e5e7ec;
}

.thumb i {
  position: absolute;
  display: block;
  border-radius: 2px;
}

.t-band { left: 0; right: 0; top: 0; height: 0; background: var(--a); }
.t-bar { left: 0; right: 0; top: 0; height: 4px; background: var(--a); }
.t-title { right: 10%; top: 14%; width: 30%; height: 9%; background: #1d2230; }
.t-rule { left: 10%; right: 10%; top: 40%; height: 2px; background: #1d2230; }
.t-row { left: 10%; right: 10%; height: 4%; background: #e9ebf0; }
.t-row:nth-of-type(5) { top: 50%; }
.t-row:nth-of-type(6) { top: 60%; }
.t-row:nth-of-type(7) { top: 70%; }
.t-total { right: 10%; bottom: 8%; width: 34%; height: 10%; background: color-mix(in srgb, var(--a) 14%, white); }

.t-classic .t-bar { display: none; }
.t-classic .t-title { left: 30%; right: 30%; width: auto; top: 10%; height: 7%; background: #1d2230; }
.t-classic .t-rule { top: 26%; height: 2px; background: var(--a); }
.t-classic .t-row { box-shadow: 0 0 0 1px #e3e6ec; background: #fff; }
.t-classic .t-row:nth-of-type(5) { background: color-mix(in srgb, var(--a) 16%, white); }
.t-classic .t-total { background: var(--a); }

.t-minimal .t-bar { display: none; }
.t-minimal .t-title { background: var(--a); height: 11%; }
.t-minimal .t-rule { height: 1px; background: #d9dce3; }
.t-minimal .t-row { height: 1px; background: #e3e6ec; }
.t-minimal .t-total { height: 2px; background: var(--a); bottom: 12%; }

.t-bold .t-bar { display: none; }
.t-bold .t-band { height: 30%; }
.t-bold .t-title { background: #fff; opacity: 0.9; }
.t-bold .t-rule { top: 42%; height: 7%; background: var(--a); }
.t-bold .t-row:nth-of-type(6) { background: color-mix(in srgb, var(--a) 10%, white); }
.t-bold .t-total { background: var(--a); }

.l-name {
  font-weight: 600;
}

.l-hint {
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* Color */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sw {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  /* Borde visible en claro y en oscuro (el color tinta se perdería sobre fondo oscuro) */
  box-shadow: inset 0 0 0 1px rgb(128 128 128 / 0.4);
  transition: transform var(--t-fast) var(--ease-spring), box-shadow var(--t-fast);
}

.sw:hover:not(:disabled) {
  transform: scale(1.08);
}

.sw.on {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text);
}

.sw.custom {
  cursor: pointer;
  background: conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444);
}

.sw.custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.sw :deep(svg) {
  width: 15px;
  height: 15px;
  color: #fff;
}

/* Tipografía */
.fonts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.font {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 10px;
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface);
  transition: border-color var(--t-fast), box-shadow var(--t-base);
}

.font.on {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-ring);
}

.aa {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.1;
}

.f-name {
  margin-top: 4px;
  font-weight: 600;
  font-size: var(--text-sm);
}

.f-hint {
  font-size: var(--text-2xs);
  color: var(--text-3);
}

/* Logo */
.drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-5);
  text-align: center;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.drop.dragging {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.drop.has {
  /* Logo sobre fondo claro: así se verá en el PDF */
  background:
    repeating-conic-gradient(#f1f3f6 0 25%, #fff 0 50%) 0 0 / 16px 16px;
}

.logo-img {
  max-width: 220px;
  max-height: 80px;
  object-fit: contain;
}

.drop-ic {
  width: 26px;
  height: 26px;
  color: var(--brand-text);
}

.drop-empty p {
  margin-top: 4px;
}

.drop-actions {
  display: flex;
  gap: var(--s-2);
}

/* Vista previa */
.preview-col {
  position: sticky;
  top: calc(var(--topbar-h) + var(--s-5));
}

.preview {
  overflow: hidden;
}

.pv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
  border-bottom: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}

.pv-head-left {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  flex-wrap: wrap;
}

.pv-ic {
  width: 18px;
  height: 18px;
  color: var(--danger-solid);
}

.pv-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.pv-state.ok :deep(svg) {
  color: var(--success-solid);
}

.spin {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.pv-body {
  position: relative;
  height: min(calc(100dvh - var(--topbar-h) - 140px), 960px);
  min-height: 520px;
  background: var(--surface-2);
  overflow: hidden;
}

.pv-frame {
  width: 100%;
  height: 100%;
  border: 0;
  transition: opacity var(--t-base);
}

.pv-frame.dim {
  opacity: 0.65;
}

.pv-empty {
  display: grid;
  place-items: center;
  height: 100%;
  padding: var(--s-6);
  color: #e5e7eb;
}

.pv-sk {
  width: 60%;
  aspect-ratio: 210 / 297;
  border-radius: 4px;
}

.pv-open {
  display: none;
}

.save-bar {
  position: fixed;
  left: 50%;
  bottom: calc(var(--s-5) + var(--bnav) + var(--safe-b));
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  gap: var(--s-2);
  width: min(720px, calc(100vw - 2 * var(--s-4)));
  padding: 10px 10px 10px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xl);
  transform: translateX(-50%);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning-solid);
}

.bar-enter-active {
  transition: transform var(--t-slow) var(--ease-spring), opacity var(--t-base);
}

.bar-leave-active {
  transition: transform 160ms var(--ease-in), opacity 160ms;
}

.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translate(-50%, 16px);
}

@media (max-width: 1180px) {
  .designer {
    grid-template-columns: minmax(0, 1fr);
  }

  .preview-col {
    position: static;
    order: -1;
  }

  .pv-body {
    height: 70vh;
    min-height: 420px;
  }
}

@media (max-width: 767px) {
  /* Los navegadores móviles no muestran PDF incrustados: botón para abrirlo */
  .pv-frame {
    display: none;
  }

  .pv-body {
    display: grid;
    place-items: center;
    height: auto;
    min-height: 0;
    padding: var(--s-6);
    background: var(--surface-sunken);
  }

  .pv-open {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    font-weight: 600;
    color: var(--brand-text);
    background: var(--brand-soft);
    border-radius: var(--r-md);
  }

  .fonts {
    grid-template-columns: 1fr 1fr 1fr;
  }

  .dl {
    display: none;
  }

  .save-bar span.grow {
    font-size: var(--text-sm);
  }
}

.card-intro-text {
  font-size: var(--text-sm);
  color: var(--text-3);
  margin-bottom: var(--s-1);
}

.tok-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--s-1);
}

.tok-label {
  font-size: var(--text-2xs);
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.tokens {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--s-2);
}

.token {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 10px;
  font-size: var(--text-xs);
  font-weight: 550;
  color: var(--text-2);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-full);
  cursor: pointer;
  transition: border-color var(--t-fast), color var(--t-fast), background var(--t-fast);
}

.token:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

.token :deep(svg) {
  width: 12px;
  height: 12px;
  color: var(--brand);
}

.tok-desc {
  font-size: var(--text-2xs);
  color: var(--text-3);
}
</style>
