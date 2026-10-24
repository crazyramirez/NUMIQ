<script setup lang="ts">
import type { ImportCatalogData, ImportContactData, ImportDuplicate, ImportInvoiceData, ImportItemStatus, ImportItemType, ImportVaultData } from '#shared/types/import'

/** Revisión de un registro del lote: documento original a la izquierda, datos corregibles a la derecha */
const props = defineProps<{ batchId: number, itemId: number | null }>()
const emit = defineEmits<{ saved: [], imported: [], open: [id: number] }>()
const open = defineModel<boolean>({ default: false })

interface Item {
  id: number
  type: ImportItemType
  status: ImportItemStatus
  data: ImportInvoiceData | ImportContactData | ImportCatalogData | ImportVaultData | null
  contactId: number | null
  duplicate: ImportDuplicate | null
  confidence: number | null
  warnings: string[] | null
  resultId: number | null
  file: { id: number, name: string, path: string | null, mime: string, size: number } | null
  /** Pedido, albarán o presupuesto que puede ir con una factura emitida del lote */
  linkable: boolean
  linkOptions: Array<{ id: number, label: string }>
  /** Factura emitida: lo que se le adjuntará al importar */
  linked: Array<{ id: number, title: string, reason: string | null, sameFile: boolean }>
}

const toast = useToast()
const item = ref<Item | null>(null)
const loading = ref(false)
const saving = ref(false)
const importing = ref(false)
const original = ref('')

const invoice = ref<ImportInvoiceData | null>(null)
const contactData = ref<ImportContactData | null>(null)
const catalog = ref<ImportCatalogData | null>(null)
const vault = ref<ImportVaultData | null>(null)
const direction = ref<'issued' | 'received'>('received')
const contactId = ref<number | null>(null)
const linkId = ref<number | null>(null)
const originalLink = ref<number | null>(null)

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

watch([open, () => props.itemId], async ([v, id]) => {
  if (!v || !id) return
  loading.value = true
  item.value = null
  try {
    const it = await $fetch<Item>(`/api/imports/${props.batchId}/items/${id}`)
    item.value = it
    direction.value = it.type === 'sales' ? 'issued' : 'received'
    contactId.value = it.contactId
    invoice.value = it.type === 'sales' || it.type === 'expense' ? clone(it.data as ImportInvoiceData) : null
    contactData.value = it.type === 'contact' ? clone(it.data as ImportContactData) : null
    catalog.value = it.type === 'item' ? clone(it.data as ImportCatalogData) : null
    vault.value = it.type === 'vault' ? clone(it.data as ImportVaultData) : null
    linkId.value = originalLink.value = vault.value?.link?.itemId ?? null
    original.value = snapshot()
  }
  catch (err) {
    toast.error('No se pudo abrir', errorMessage(err))
    open.value = false
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

function snapshot() {
  return JSON.stringify([invoice.value, contactData.value, catalog.value, vault.value, direction.value, contactId.value, linkId.value])
}
const dirty = computed(() => !!item.value && snapshot() !== original.value)
const isInvoice = computed(() => item.value?.type === 'sales' || item.value?.type === 'expense')
const locked = computed(() => item.value?.status === 'imported' || !item.value?.data)

const TYPE_TITLE: Record<ImportItemType, string> = {
  sales: 'Factura emitida',
  expense: 'Factura recibida',
  contact: 'Contacto',
  item: 'Producto o servicio',
  vault: 'Documento para el archivo',
}
const title = computed(() => {
  if (!item.value) return 'Revisión'
  if (invoice.value?.docType === 'quote') return 'Presupuesto'
  if (invoice.value?.docType === 'proforma') return 'Factura proforma'
  if (isInvoice.value) return TYPE_TITLE[direction.value === 'issued' ? 'sales' : 'expense']
  if (item.value.linkable && vault.value) return docTypeLabel(vault.value.docType)
  return TYPE_TITLE[item.value.type]
})
const status = computed(() => (item.value ? IMPORT_STATUS[item.value.status] : null))

function body(extra: Record<string, unknown> = {}) {
  const it = item.value!
  if (isInvoice.value) return { type: direction.value === 'issued' ? 'sales' : 'expense', data: invoice.value, contactId: contactId.value, ...extra }
  if (it.type === 'contact') return { data: contactData.value, ...extra }
  if (it.type === 'item') return { data: catalog.value, ...extra }
  // El vínculo solo se envía si se cambia: así sigue siendo automático si la IA vuelve a leer el lote
  return { data: vault.value, ...(linkId.value !== originalLink.value ? { link: { itemId: linkId.value } } : {}), ...extra }
}

async function save(extra: Record<string, unknown> = {}, quiet = false) {
  if (!item.value) return false
  saving.value = true
  try {
    const r = await $fetch<{ status: ImportItemStatus, warnings: string[], duplicate: ImportDuplicate | null }>(`/api/imports/${props.batchId}/items/${item.value.id}`, { method: 'PATCH', body: body(extra) })
    item.value.status = r.status
    item.value.warnings = r.warnings
    item.value.duplicate = r.duplicate
    if (vault.value && linkId.value !== originalLink.value) vault.value.link = { itemId: linkId.value, reason: null, manual: true }
    originalLink.value = linkId.value
    original.value = snapshot()
    if (!quiet) toast.success('Cambios guardados', r.duplicate ? r.duplicate.label : r.warnings.length ? `${r.warnings.length} aviso${r.warnings.length > 1 ? 's' : ''} pendiente${r.warnings.length > 1 ? 's' : ''}` : 'Listo para importar')
    emit('saved')
    return true
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
    return false
  }
  finally {
    saving.value = false
  }
}

async function toggleInclude() {
  if (!item.value) return
  const excluded = item.value.status === 'excluded'
  if (await save({ include: excluded }, true)) toast.info(excluded ? 'Vuelve a la importación' : 'Excluido: no se importará')
}

async function importNow() {
  if (!item.value) return
  if ((dirty.value || item.value.status === 'duplicate' || item.value.status === 'error') && !(await save(item.value.status === 'duplicate' ? { include: true } : {}, true))) return
  importing.value = true
  try {
    const r = await $fetch<{ imported: number, failed: Array<{ message: string }> }>(`/api/imports/${props.batchId}/commit`, { method: 'POST', body: { itemIds: [item.value.id] } })
    if (r.imported) {
      toast.success('Importado')
      emit('imported')
      open.value = false
    }
    else {
      item.value = await $fetch<Item>(`/api/imports/${props.batchId}/items/${item.value.id}`)
      emit('saved')
      if (item.value?.status === 'duplicate') toast.info('Duplicado omitido', item.value.duplicate?.label)
      else toast.error('No se pudo importar', r.failed[0]?.message ?? 'Revisa los datos')
    }
  }
  catch (err) {
    toast.error('No se pudo importar', errorMessage(err))
  }
  finally {
    importing.value = false
  }
}

/** Coincidencia solo probable (fecha cercana, nombre parecido) que el usuario sabe que es otro documento */
const likelyDuplicate = computed(() => item.value?.status === 'duplicate' && item.value.duplicate?.certain === false && !!invoice.value)
async function importAnyway() {
  if (!invoice.value) return
  invoice.value.allowDuplicate = true
  await importNow()
}

const folderOptions = VAULT_FOLDERS.map(f => ({ value: f.key, label: f.label }))
const quarterOptions = [1, 2, 3, 4].map(q => ({ value: q, label: `${q}T` }))
const kindOptions = [{ value: 'service', label: 'Servicio' }, { value: 'product', label: 'Producto' }]
const vatOptions = VAT_RATES.map(r => ({ value: r, label: `${r} %` }))
const linkSelectOptions = computed(() => [
  { value: null, label: 'Ninguna · al archivo trimestral' },
  ...(item.value?.linkOptions ?? []).map(o => ({ value: o.id, label: o.label })),
])
const docRef = computed(() => {
  const r = vault.value?.ref
  if (!r) return null
  return [r.number ? `Nº ${r.number}` : null, r.issueDate ? fdate(r.issueDate) : null, r.total != null ? eur(r.total) : null, r.parties[0]?.name].filter(Boolean).join(' · ')
})
const autoReason = computed(() => (vault.value?.link && !vault.value.link.manual && vault.value.link.itemId === linkId.value ? vault.value.link.reason : null))

/** Abre otro registro del lote (lo pendiente de guardar se guarda antes) */
async function openOther(id: number) {
  if (dirty.value && !(await save({}, true))) return
  emit('open', id)
}

const duplicateLink = computed(() => {
  const d = item.value?.duplicate
  if (!d?.id) return null
  const quote = invoice.value?.docType === 'quote' || invoice.value?.docType === 'proforma'
  return d.type === 'sales' ? `/${quote ? 'presupuestos' : 'facturas'}/${d.id}` : d.type === 'expense' ? `/gastos?ver=${d.id}` : d.type === 'contact' ? `/clientes/${d.id}` : null
})
</script>

<template>
  <UiModal v-model="open" side size="xl" :persistent="dirty">
    <template #head>
      <div class="head">
        <h2 class="title">{{ title }}</h2>
        <div class="row gap-2 wrap">
          <UiBadge v-if="status" :tone="status.tone" :icon="status.icon" size="sm">{{ status.label }}</UiBadge>
          <span v-if="item?.confidence != null" class="conf" :title="`Confianza de la lectura: ${item.confidence} %`">
            <span class="conf-bar"><span :style="{ width: `${item.confidence}%` }" :class="{ low: item.confidence < 80 }" /></span>
            {{ item.confidence }} %
          </span>
          <span v-if="item?.file" class="muted small truncate path" :title="item.file.path ?? item.file.name">{{ item.file.path ?? item.file.name }}</span>
        </div>
      </div>
    </template>

    <div v-if="loading || !item" class="split">
      <div class="skeleton" style="min-height: 420px" />
      <div class="stack gap-3">
        <div v-for="i in 6" :key="i" class="skeleton" style="height: 40px" />
      </div>
    </div>

    <div v-else class="split" :class="{ nofile: !item.file }">
      <div v-if="item.file" class="doc">
        <DocsFilePreview :file-id="item.file.id" :name="item.file.name" :mime="item.file.mime" />
      </div>

      <div class="side">
        <div v-if="item.duplicate" class="note dup">
          <Icon name="ph:copy" aria-hidden="true" />
          <div class="grow">
            <p class="n-t">{{ likelyDuplicate ? `Parece repetido. ${item.duplicate.label}` : item.duplicate.label }}</p>
            <p class="n-s">{{ item.type === 'contact' && item.status !== 'duplicate' ? 'Se reutilizará el contacto existente, añadiendo su papel de cliente o proveedor si falta.' : likelyDuplicate ? 'Se omitirá para no duplicarlo. Si es otro documento distinto, impórtalo igualmente.' : 'Se omitirá para evitar duplicados. Si corriges sus datos, volveremos a comprobarlo.' }}</p>
            <button v-if="likelyDuplicate && !locked" type="button" class="link small" :disabled="importing || saving" @click="importAnyway">Es otro: importarlo igualmente</button>
          </div>
          <NuxtLink v-if="duplicateLink" :to="duplicateLink" class="link small">Ver</NuxtLink>
        </div>
        <ul v-if="item.warnings?.length" class="note warn" aria-label="Avisos">
          <li v-for="(w, i) in item.warnings" :key="i"><Icon name="ph:warning-fill" aria-hidden="true" /> {{ w }}</li>
        </ul>
        <p v-if="item.status === 'imported'" class="note ok"><Icon name="ph:check-circle-fill" aria-hidden="true" /> Ya importado</p>

        <!-- Factura emitida: pedidos, albaranes… del lote que se le adjuntarán -->
        <div v-if="item.linked?.length" class="note link">
          <Icon name="ph:paperclip" aria-hidden="true" />
          <div class="grow min0">
            <p class="n-t">{{ item.linked.length === 1 ? 'Se le adjuntará un documento de esta importación' : `Se le adjuntarán ${item.linked.length} documentos de esta importación` }}</p>
            <ul class="linked">
              <li v-for="l in item.linked" :key="l.id">
                <button type="button" class="link" @click="openOther(l.id)">{{ l.title }}</button>
                <span v-if="l.sameFile" class="n-s"> · en el mismo archivo</span>
                <span v-else-if="l.reason" class="n-s"> · {{ l.reason }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- Pedido, albarán o presupuesto: ¿a qué factura acompaña? -->
        <section v-if="item.linkable && vault" class="link-box" :class="{ on: !!linkId }">
          <div class="lb-head">
            <span class="lb-ic" aria-hidden="true"><Icon :name="linkId ? 'ph:paperclip' : 'ph:archive'" /></span>
            <div class="grow min0">
              <p class="n-t">{{ linkId ? 'Se adjuntará a la factura al importar' : 'No va con ninguna factura de esta importación' }}</p>
              <p v-if="docRef" class="n-s truncate">{{ docRef }}</p>
            </div>
          </div>
          <UiSelect v-model="linkId" label="Factura emitida a la que acompaña" :options="linkSelectOptions" :disabled="locked" />
          <p class="lb-hint">
            <template v-if="autoReason"><Icon name="ph:sparkle-fill" aria-hidden="true" /> Detectado: {{ autoReason }}. </template>
            <template v-if="linkId">Quedará en los documentos asociados de la factura.</template>
            <template v-else-if="item.linkOptions.length">Elige su factura si la tiene; si no, se guarda en el archivo trimestral.</template>
            <template v-else>No hay facturas emitidas en esta importación: se guarda en el archivo trimestral.</template>
          </p>
        </section>

        <fieldset :disabled="locked" class="fs">
          <ImportInvoiceForm v-if="invoice" v-model="invoice" v-model:direction="direction" v-model:contact-id="contactId" />

          <div v-else-if="contactData" class="form-grid">
            <UiInput v-model="contactData.party.name" class="c-8" label="Nombre o razón social" required />
            <UiInput v-model="contactData.party.nif" class="c-4 upper" label="NIF" />
            <UiInput v-model="contactData.party.address" class="c-8" label="Dirección" />
            <UiInput v-model="contactData.party.postalCode" class="c-4" label="C. postal" />
            <UiInput v-model="contactData.party.city" class="c-6" label="Población" />
            <UiInput v-model="contactData.party.province" class="c-6" label="Provincia" />
            <UiInput v-model="contactData.party.email" class="c-6" label="Email" type="email" />
            <UiInput v-model="contactData.party.phone" class="c-6" label="Teléfono" />
            <div class="c-12 roles">
              <UiSwitch v-model="contactData.isClient" label="Cliente" />
              <UiSwitch v-model="contactData.isSupplier" label="Proveedor" />
            </div>
          </div>

          <div v-else-if="catalog" class="form-grid">
            <UiInput v-model="catalog.name" class="c-8" label="Nombre" required />
            <UiSelect v-model="catalog.kind" class="c-4" label="Tipo" :options="kindOptions" />
            <UiInput v-model="catalog.sku" class="c-4" label="Referencia" />
            <UiInput v-model="catalog.unitPrice" class="c-4" label="Precio" numeric suffix="€" />
            <UiSelect v-model="catalog.vatRate" class="c-4" label="IVA" :options="vatOptions" />
            <UiTextarea v-model="catalog.description" class="c-12" label="Descripción" />
          </div>

          <div v-else-if="vault" class="form-grid">
            <template v-if="!linkId">
              <UiSelect v-model="vault.folder" class="c-6" label="Carpeta" :options="folderOptions" />
              <UiInput v-model="vault.year" class="c-3" label="Año" type="number" />
              <UiSelect v-model="vault.quarter" class="c-3" label="Trimestre" :options="quarterOptions" />
            </template>
            <UiInput v-model="vault.summary" class="c-12" label="Nota" placeholder="Ej. Extracto de septiembre" />
          </div>
        </fieldset>
      </div>
    </div>

    <template v-if="item && !locked" #footer>
      <!-- En el móvil los textos se acortan para que quepan los tres botones -->
      <UiButton variant="ghost" :icon="item.status === 'excluded' ? 'ph:arrow-u-up-left' : 'ph:prohibit'" :disabled="saving" :aria-label="item.status === 'excluded' ? 'Incluir' : 'Excluir'" @click="toggleInclude">
        <span class="hide-sm">{{ item.status === 'excluded' ? 'Incluir' : 'Excluir' }}</span>
      </UiButton>
      <span class="grow" />
      <UiButton variant="secondary" icon="ph:floppy-disk" :loading="saving" :disabled="!dirty" @click="save()">Guardar<span class="hide-sm"> cambios</span></UiButton>
      <UiButton variant="primary" icon="ph:check" :loading="importing" :disabled="item.status === 'duplicate' && !dirty" @click="importNow">
        {{ item.status === 'duplicate' ? 'Comprobar cambios' : 'Importar este' }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.conf {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
}

.conf-bar {
  width: 54px;
  height: 5px;
  overflow: hidden;
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.conf-bar span {
  display: block;
  height: 100%;
  background: var(--success-solid);
  border-radius: inherit;
}

.conf-bar span.low {
  background: var(--warning-solid);
}

.path {
  max-width: 360px;
}

.small {
  font-size: var(--text-sm);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: var(--s-6);
  align-items: start;
}

.split.nofile {
  grid-template-columns: minmax(0, 1fr);
}

.doc {
  position: sticky;
  top: 0;
  height: calc(100dvh - 210px);
  min-height: 420px;
}

.side {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  min-width: 0;
}

.note {
  display: flex;
  align-items: flex-start;
  gap: var(--s-2);
  padding: 10px 12px;
  font-size: var(--text-sm);
  border-radius: var(--r-lg);
}

.note.dup {
  align-items: center;
  color: var(--info);
  background: var(--info-soft);
}

.n-t {
  font-weight: 600;
}

.n-s {
  font-size: var(--text-xs);
  opacity: 0.85;
}

.note.warn {
  flex-direction: column;
  gap: 4px;
  list-style: none;
  color: var(--warning);
  background: var(--warning-soft);
}

.note.warn li {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.note.ok {
  align-items: center;
  color: var(--success);
  background: var(--success-soft);
}

.note.link {
  color: var(--brand-text);
  background: var(--brand-soft);
}

.note.link > svg {
  flex: none;
  margin-top: 2px;
}

.linked {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
  padding: 0;
  list-style: none;
}

.linked .link {
  font-weight: 600;
}

.min0 {
  min-width: 0;
}

.link-box {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.link-box.on {
  background: color-mix(in srgb, var(--brand-soft) 45%, var(--surface));
  border-color: color-mix(in srgb, var(--brand) 30%, var(--border));
}

.lb-head {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.lb-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  font-size: 17px;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}

.link-box.on .lb-ic {
  color: var(--brand);
  border-color: color-mix(in srgb, var(--brand) 30%, var(--border));
}

.lb-hint {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.lb-hint svg {
  color: var(--ai-2);
  vertical-align: -2px;
}

.fs {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.roles {
  display: flex;
  gap: var(--s-6);
}

.form-grid .c-12 {
  grid-column: span 12;
}

@media (max-width: 520px) {
  .hide-sm {
    display: none;
  }
}

@media (max-width: 900px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }

  .doc {
    position: static;
    height: 380px;
    min-height: 0;
  }
}
</style>
