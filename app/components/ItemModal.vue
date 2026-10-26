<script setup lang="ts">
/** Alta y edición de productos y servicios del catálogo */
const props = defineProps<{
  itemId?: number | null
  prefill?: { name?: string, unitPrice?: number, vatRate?: number, description?: string, unit?: string, categoryId?: number }
}>()
const emit = defineEmits<{ saved: [id: number], deleted: [id: number] }>()
const open = defineModel<boolean>({ default: false })

interface ItemForm {
  kind: 'service' | 'product'
  name: string
  description: string | null
  sku: string | null
  unit: string | null
  unitPrice: number | null
  vatRate: number
  categoryId: number | null
}

const toast = useToast()
// Gestor: ve la ficha con los campos bloqueados, sin guardar ni eliminar
const { readOnly } = useMe()
const formId = useId()
const unitsId = useId()

const blank = (): ItemForm => ({
  kind: 'service',
  name: props.prefill?.name ?? '',
  description: props.prefill?.description ?? null,
  sku: null,
  unit: props.prefill?.unit ?? null,
  unitPrice: props.prefill?.unitPrice ?? null,
  vatRate: props.prefill?.vatRate ?? 21,
  categoryId: props.prefill?.categoryId ?? null,
})

const form = ref<ItemForm>(blank())
const errors = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
/** Precio final con IVA para calcular la base hacia atrás */
const gross = ref<number | null>(null)

const isEdit = computed(() => !!props.itemId)

// ─── Imagen: se reduce en el navegador y se sube al guardar ───
const imageUrl = ref<string | null>(null)
const pending = ref<Blob | null>(null)
const removeImage = ref(false)
const picker = ref<{ onPaste: (e: ClipboardEvent) => void }>()

watch(open, async (v) => {
  pending.value = null
  removeImage.value = false
  if (!v) return
  errors.value = {}
  gross.value = null
  imageUrl.value = null
  if (props.itemId) {
    loading.value = true
    try {
      const it = await $fetch<ItemForm & { id: number, imageUrl: string | null }>(`/api/items/${props.itemId}`)
      form.value = { kind: it.kind, name: it.name, description: it.description, sku: it.sku, unit: it.unit, unitPrice: it.unitPrice, vatRate: it.vatRate, categoryId: it.categoryId }
      imageUrl.value = it.imageUrl
    }
    catch (err) {
      toast.error(errorMessage(err))
      open.value = false
    }
    finally {
      loading.value = false
    }
  }
  else {
    form.value = blank()
  }
}, { immediate: true })

const priceWithVat = computed(() => round2((form.value.unitPrice ?? 0) * (1 + form.value.vatRate / 100)))

function applyGross() {
  if (gross.value == null) return
  form.value.unitPrice = Math.round(gross.value / (1 + form.value.vatRate / 100) * 10000) / 10000
  gross.value = null
}

const kindModel = computed({
  get: () => form.value.kind,
  set: v => (form.value.kind = v as ItemForm['kind']),
})
const kindOptions = [
  { value: 'service', label: 'Servicio' },
  { value: 'product', label: 'Producto' },
]
const vatOptions = VAT_RATES.map(r => ({ value: r, label: r === 0 ? '0 % (exento)' : `${r} %` }))

// ─── Categoría: se elige o se crea escribiendo su nombre (0 = sin categoría en el selector) ───
const { data: cats, refresh: refreshCats } = useFetch<Array<{ id: number, name: string }>>('/api/item-categories', { key: 'item-categories', lazy: true })
const catOptions = computed(() => [
  { value: 0, label: 'Sin categoría' },
  ...(cats.value ?? []).map(c => ({ value: c.id, label: c.name })),
])
const catModel = computed({
  get: () => form.value.categoryId ?? 0,
  set: (v: number) => (form.value.categoryId = v || null),
})

async function createCategory(name: string) {
  if (!name) return
  try {
    const c = await $fetch<{ id: number }>('/api/item-categories', { method: 'POST', body: { name } })
    await refreshCats()
    form.value.categoryId = c.id
  }
  catch (err) {
    errors.value.categoryId = errorMessage(err)
  }
}
const UNITS = ['hora', 'día', 'mes', 'unidad', 'proyecto', 'sesión', 'servicio', 'licencia', 'kg', 'm²']

async function save() {
  errors.value = {}
  if (!form.value.name.trim()) {
    errors.value.name = 'Escribe un nombre'
    return
  }
  if (form.value.unitPrice == null) {
    errors.value.unitPrice = 'Indica el precio'
    return
  }
  saving.value = true
  try {
    const body = { ...form.value, name: form.value.name.trim() }
    let id = props.itemId ?? 0
    if (props.itemId) await $fetch(`/api/items/${props.itemId}`, { method: 'PATCH', body })
    else id = (await $fetch<{ id: number }>('/api/items', { method: 'POST', body })).id
    if (pending.value) {
      const fd = new FormData()
      fd.append('file', pending.value, pending.value.type === 'image/png' ? 'imagen.png' : 'imagen.jpg')
      await $fetch(`/api/items/${id}/image`, { method: 'POST', body: fd })
    }
    else if (removeImage.value && imageUrl.value) {
      await $fetch(`/api/items/${id}/image`, { method: 'DELETE' })
    }
    toast.success(isEdit.value ? 'Cambios guardados' : 'Añadido al catálogo', body.name)
    emit('saved', id)
    open.value = false
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

const removeItem = useItemDelete()
const deleting = ref(false)

async function remove() {
  if (!props.itemId) return
  deleting.value = true
  try {
    if (await removeItem({ id: props.itemId, name: form.value.name.trim() || 'este producto' })) {
      emit('deleted', props.itemId)
      open.value = false
    }
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" :title="readOnly ? 'Del catálogo' : isEdit ? 'Editar del catálogo' : 'Nuevo producto o servicio'" :subtitle="readOnly ? undefined : 'Lo tendrás a un clic al hacer facturas y presupuestos.'" size="md">
    <div v-if="loading" class="loading">
      <div v-for="i in 4" :key="i" class="skeleton" style="height: 38px" />
    </div>

    <form v-else :id="formId" :class="{ ro: readOnly }" novalidate @submit.prevent="save" @paste="!readOnly && picker?.onPaste($event)">
      <fieldset class="ro-fs" :disabled="readOnly">
      <div class="head-row">
        <UiImagePick ref="picker" v-model:pending="pending" v-model:remove="removeImage" :url="imageUrl" />
        <div class="head-fields">
          <UiSegmented v-model="kindModel" :options="kindOptions" label="Tipo" />
          <UiInput v-model="form.name" label="Nombre" placeholder="Ej. Consultoría estratégica" :error="errors.name" required autofocus autocomplete="off" />
        </div>
      </div>

      <div class="form-grid">
        <UiTextarea v-model="form.description" label="Descripción" hint="Aparece bajo el concepto en la factura" rows="3" :error="errors.description" />

        <UiInput v-model="form.unitPrice" class="c-4" label="Precio (sin IVA)" numeric suffix="€" placeholder="0,00" :error="errors.unitPrice" required />
        <UiSelect v-model="form.vatRate" class="c-4" label="IVA" :options="vatOptions" />
        <UiInput v-model="form.unit" class="c-4" label="Unidad" placeholder="hora, mes…" :list="unitsId" :error="errors.unit" autocomplete="off" />
        <datalist :id="unitsId">
          <option v-for="u in UNITS" :key="u" :value="u" />
        </datalist>

        <UiCombobox
          v-model="catModel"
          class="c-6"
          label="Categoría"
          :options="catOptions"
          placeholder="Busca o crea una categoría…"
          create-label="Nueva categoría"
          :error="errors.categoryId"
          @create="createCategory"
        />
        <UiInput v-if="form.kind === 'product'" v-model="form.sku" class="c-6" label="Referencia (SKU)" placeholder="REF-001" :error="errors.sku" autocomplete="off" />
      </div>

      <div class="preview">
        <div>
          <p class="eyebrow">Precio con IVA</p>
          <p class="pv num">{{ eur(priceWithVat) }}<span v-if="form.unit" class="per"> / {{ form.unit }}</span></p>
        </div>
        <div class="gross">
          <UiInput v-model="gross" numeric suffix="€" placeholder="¿Tienes el precio final?" aria-label="Precio final con IVA" @keydown.enter.prevent="applyGross" />
          <UiButton size="sm" variant="soft" :disabled="gross == null" @click="applyGross">Calcular base</UiButton>
        </div>
      </div>
      </fieldset>
    </form>

    <template v-if="readOnly" #footer>
      <UiButton @click="open = false">Cerrar</UiButton>
    </template>
    <template v-else #footer>
      <UiButton v-if="isEdit" class="del" variant="ghost" icon="ph:trash" :loading="deleting" :disabled="loading" @click="remove">
        Eliminar
      </UiButton>
      <div v-if="isEdit" class="spacer" />
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" :form="formId" variant="primary" :loading="saving" :disabled="loading" icon="ph:check-bold">
        {{ isEdit ? 'Guardar cambios' : 'Añadir al catálogo' }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
/* Solo agrupa los campos para bloquearlos en modo consulta: no altera la maquetación */
.ro-fs {
  display: contents;
}

.ro .gross,
.ro :deep(.pick-del) {
  display: none;
}

.spacer {
  flex: 1;
}

.del {
  color: var(--danger-solid);
}

.del:hover {
  background: var(--danger-soft);
}

.loading {
  display: grid;
  gap: var(--s-4);
}

.head-row {
  display: flex;
  align-items: flex-start;
  gap: var(--s-4);
  margin-bottom: var(--s-4);
}

.head-fields {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  flex: 1;
  min-width: 0;
}

.head-fields > :first-child {
  align-self: flex-start;
}

.preview {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--s-4);
  flex-wrap: wrap;
  margin-top: var(--s-6);
  padding: var(--s-4) var(--s-5);
  background: var(--brand-soft);
  border-radius: var(--r-lg);
}

.pv {
  margin-top: 2px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.02em;
  color: var(--brand-text);
}

.per {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-3);
}

.gross {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.gross :deep(.field) {
  width: 200px;
}
</style>
