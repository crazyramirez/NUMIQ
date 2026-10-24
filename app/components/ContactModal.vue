<script setup lang="ts">
/** Alta y edición de clientes y proveedores (también desde el editor de facturas y de gastos) */
const props = defineProps<{
  role: 'client' | 'supplier'
  contactId?: number | null
  prefillName?: string
}>()
const emit = defineEmits<{ saved: [id: number], deleted: [id: number] }>()
const open = defineModel<boolean>({ default: false })

interface ContactForm {
  isClient: boolean
  isSupplier: boolean
  kind: 'company' | 'person'
  name: string
  tradeName: string | null
  nif: string | null
  nifType: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string
  iban: string | null
  paymentTermsDays: number | null
  irpfRate: number | null
  equivalenceSurcharge: boolean
  defaultCategoryId: number | null
  notes: string | null
}

const toast = useToast()
const { confirm } = useConfirm()
const formId = useId()
const deleting = ref(false)

const blank = (): ContactForm => ({
  isClient: props.role === 'client',
  isSupplier: props.role === 'supplier',
  kind: 'company',
  name: props.prefillName?.trim() ?? '',
  tradeName: null,
  nif: null,
  nifType: 'nif',
  email: null,
  phone: null,
  website: null,
  address: null,
  postalCode: null,
  city: null,
  province: null,
  country: 'ES',
  iban: null,
  paymentTermsDays: null,
  irpfRate: null,
  equivalenceSurcharge: false,
  defaultCategoryId: null,
  notes: null,
})

const form = ref<ContactForm>(blank())
const errors = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const more = ref(false)
const nifTouched = ref(false)
const categories = ref<Array<{ id: number, name: string, kind: string }>>([])

// Logotipo: se reduce en el navegador y se sube al guardar
const logoUrl = ref<string | null>(null)
const logoPending = ref<Blob | null>(null)
const logoRemove = ref(false)
const picker = ref<{ onPaste: (e: ClipboardEvent) => void }>()

/** Campos de "Más datos": si el servidor marca uno, se despliega la sección */
const MORE_FIELDS = ['tradeName', 'website', 'country', 'iban', 'paymentTermsDays', 'irpfRate', 'equivalenceSurcharge', 'defaultCategoryId', 'notes', 'isClient']

const isEdit = computed(() => !!props.contactId)
const roleLabel = computed(() => (props.role === 'client' ? 'cliente' : 'proveedor'))
const title = computed(() => (isEdit.value ? `Editar ${roleLabel.value}` : `Nuevo ${roleLabel.value}`))

watch(open, async (v) => {
  logoPending.value = null
  logoRemove.value = false
  if (!v) return
  errors.value = {}
  nifTouched.value = false
  more.value = false
  logoUrl.value = null
  if (props.contactId) {
    loading.value = true
    try {
      const c = await $fetch<ContactForm & { id: number, logoUrl: string | null }>(`/api/contacts/${props.contactId}`)
      logoUrl.value = c.logoUrl
      const base = blank()
      form.value = Object.fromEntries(Object.keys(base).map(k => [k, (c as unknown as Record<string, unknown>)[k] ?? (base as unknown as Record<string, unknown>)[k]])) as unknown as ContactForm
      more.value = !!(c.iban || c.tradeName || c.notes || c.irpfRate != null || c.paymentTermsDays != null)
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
  if (form.value.isSupplier && !categories.value.length) {
    categories.value = await $fetch<typeof categories.value>('/api/categories').catch(() => [])
  }
}, { immediate: true })

// ─── Rellenar con IA: texto pegado, foto o PDF (firma, tarjeta, factura…) ───

const aiOpen = ref(false)
const aiText = ref('')
const aiBusy = ref(false)
const aiFile = ref<HTMLInputElement>()

async function aiFill(file?: File) {
  if (!file && aiText.value.trim().length < 3) return
  aiBusy.value = true
  try {
    let body: FormData | { text: string }
    if (file) {
      body = new FormData()
      body.append('file', file, file.name)
    }
    else body = { text: aiText.value }
    const r = await $fetch<Partial<ContactForm> & { kind: 'company' | 'person' }>('/api/ai/contact', { method: 'POST', body })
    const f = form.value as unknown as Record<string, unknown>
    let filled = 0
    for (const [k, v] of Object.entries(r)) {
      if (v == null || v === '' || !(k in f)) continue
      // En una ficha existente solo se completan los huecos
      if (isEdit.value && f[k] != null && f[k] !== '' && k !== 'kind') continue
      if (k === 'country' && v === 'ES' && f[k]) continue
      f[k] = v
      filled++
    }
    if (r.tradeName || r.iban) more.value = true
    nifTouched.value = !!form.value.nif
    aiOpen.value = false
    aiText.value = ''
    toast.success(filled ? 'Datos rellenados con IA' : 'No se encontraron datos nuevos', filled ? 'Revísalos antes de guardar' : undefined)
  }
  catch (err) {
    toast.error('No se pudieron leer los datos', errorMessage(err))
  }
  finally {
    aiBusy.value = false
  }
}

function onAiFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) aiFill(file)
}

// ─── NIF: validación al momento y detección de tipo ───

const nifCheck = computed(() => {
  const v = form.value.nif?.trim()
  if (!v) return null
  if (form.value.nifType === 'nif') {
    const r = validateNif(v)
    if (!r.valid) return { ok: false, text: 'NIF no válido: revisa la letra de control' }
    return { ok: true, text: r.kind === 'cif' ? 'NIF de persona jurídica válido' : r.kind === 'nie' ? 'NIE válido' : 'DNI válido' }
  }
  if (form.value.nifType === 'vat_eu') {
    return looksLikeEuVat(v) ? { ok: true, text: 'Formato de NIF-IVA correcto' } : { ok: false, text: 'Empieza por el código del país (FR, DE, PT…)' }
  }
  return null
})

const nifError = computed(() => errors.value.nif || (nifTouched.value && nifCheck.value && !nifCheck.value.ok ? nifCheck.value.text : null))

function onNifBlur() {
  nifTouched.value = true
  const f = form.value
  if (!f.nif) return
  f.nif = normalizeNif(f.nif)
  if (f.nifType !== 'nif') return
  const r = validateNif(f.nif)
  if (r.valid) {
    f.kind = r.kind === 'cif' ? 'company' : 'person'
  }
  else if (looksLikeEuVat(f.nif) && !f.nif.startsWith('ES')) {
    // NIF-IVA de otro país de la UE: se ajusta el tipo y el país
    f.nifType = 'vat_eu'
    const cc = f.nif.slice(0, 2)
    f.country = cc === 'EL' ? 'GR' : cc === 'XI' ? 'GB' : cc
  }
}

// ─── Código postal → provincia ───

const PROVINCES: Record<string, string> = {
  '01': 'Araba/Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila', '06': 'Badajoz', '07': 'Illes Balears', '08': 'Barcelona',
  '09': 'Burgos', '10': 'Cáceres', '11': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba', '15': 'A Coruña', '16': 'Cuenca',
  '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa', '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León',
  '25': 'Lleida', '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '29': 'Málaga', '30': 'Murcia', '31': 'Navarra', '32': 'Ourense',
  '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas', '36': 'Pontevedra', '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '39': 'Cantabria', '40': 'Segovia',
  '41': 'Sevilla', '42': 'Soria', '43': 'Tarragona', '44': 'Teruel', '45': 'Toledo', '46': 'Valencia', '47': 'Valladolid', '48': 'Bizkaia',
  '49': 'Zamora', '50': 'Zaragoza', '51': 'Ceuta', '52': 'Melilla',
}

watch(() => form.value.postalCode, (cp) => {
  if (form.value.country !== 'ES' || !cp || !/^\d{5}$/.test(cp)) return
  const p = PROVINCES[cp.slice(0, 2)]
  if (p && !form.value.province) form.value.province = p
})

// ─── Opciones ───

const kindOptions = [
  { value: 'company', label: 'Empresa' },
  { value: 'person', label: 'Persona' },
]

const nifTypeOptions = [
  { value: 'nif', label: 'NIF / CIF español' },
  { value: 'vat_eu', label: 'NIF-IVA intracomunitario' },
  { value: 'passport', label: 'Pasaporte' },
  { value: 'other', label: 'Otro documento' },
]

const COUNTRIES: Array<[string, string]> = [
  ['ES', 'España'], ['PT', 'Portugal'], ['FR', 'Francia'], ['DE', 'Alemania'], ['IT', 'Italia'], ['NL', 'Países Bajos'], ['BE', 'Bélgica'],
  ['IE', 'Irlanda'], ['LU', 'Luxemburgo'], ['AT', 'Austria'], ['PL', 'Polonia'], ['SE', 'Suecia'], ['DK', 'Dinamarca'], ['FI', 'Finlandia'],
  ['GR', 'Grecia'], ['CH', 'Suiza'], ['GB', 'Reino Unido'], ['AD', 'Andorra'], ['US', 'Estados Unidos'], ['MX', 'México'], ['AR', 'Argentina'],
  ['CO', 'Colombia'], ['CL', 'Chile'],
]
const countryOptions = computed(() => {
  const list = COUNTRIES.map(([value, label]) => ({ value, label }))
  if (form.value.country && !COUNTRIES.some(([c]) => c === form.value.country)) list.push({ value: form.value.country, label: form.value.country })
  return list
})

const categoryOptions = computed(() => [
  { value: null, label: 'Sin categoría por defecto' },
  ...categories.value.filter(c => c.kind === 'expense').map(c => ({ value: c.id, label: c.name })),
])

const kindModel = computed({
  get: () => form.value.kind,
  set: v => (form.value.kind = v as ContactForm['kind']),
})

const otherRole = computed({
  get: () => (props.role === 'client' ? form.value.isSupplier : form.value.isClient),
  set: (v) => {
    if (props.role === 'client') form.value.isSupplier = v
    else form.value.isClient = v
  },
})

watch(otherRole, async (v) => {
  if (v && props.role === 'client' && !categories.value.length) {
    categories.value = await $fetch<typeof categories.value>('/api/categories').catch(() => [])
  }
})

async function save() {
  errors.value = {}
  if (!form.value.name.trim()) {
    errors.value.name = 'Escribe el nombre o la razón social'
    return
  }
  saving.value = true
  try {
    const body = { ...form.value, name: form.value.name.trim() }
    let id = props.contactId ?? 0
    if (props.contactId) await $fetch(`/api/contacts/${props.contactId}`, { method: 'PATCH', body })
    else id = (await $fetch<{ id: number }>('/api/contacts', { method: 'POST', body })).id
    if (logoPending.value) {
      const fd = new FormData()
      fd.append('file', logoPending.value, logoPending.value.type === 'image/png' ? 'logo.png' : 'logo.jpg')
      await $fetch(`/api/contacts/${id}/logo`, { method: 'POST', body: fd })
    }
    else if (logoRemove.value && logoUrl.value) {
      await $fetch(`/api/contacts/${id}/logo`, { method: 'DELETE' })
    }
    toast.success(isEdit.value ? 'Cambios guardados' : `${props.role === 'client' ? 'Cliente' : 'Proveedor'} creado`, body.name)
    emit('saved', id)
    open.value = false
  }
  catch (err) {
    const field = errorField(err)
    const msg = errorMessage(err)
    if (field) {
      errors.value[field] = msg
      if (MORE_FIELDS.includes(field)) more.value = true
    }
    else {
      toast.error('No se pudo guardar', msg)
    }
  }
  finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.contactId) return
  deleting.value = true
  try {
    const detail = await $fetch<{ salesCount?: number, invoicesCount?: number, quotesCount?: number, expensesCount?: number }>(`/api/contacts/${props.contactId}`)
    const invCount = detail.invoicesCount ?? 0
    const quoteCount = detail.quotesCount ?? 0
    const totalSales = invCount + quoteCount
    const expCount = detail.expensesCount ?? 0

    let body = ''
    if (totalSales > 0 && expCount > 0) {
      body = `Este contacto tiene ${invCount} ${invCount === 1 ? 'factura' : 'facturas'}${quoteCount ? ` (${quoteCount} presupuestos)` : ''} y ${expCount} ${expCount === 1 ? 'gasto asignado' : 'gastos asignados'}.\n\nSi aceptas, el contacto se eliminará definitivamente y esos documentos quedarán desasignados (se conservan todos sus datos de emisión e importes, pero quedarán sin contacto vinculado).`
    }
    else if (totalSales > 0) {
      body = `Este cliente tiene ${invCount} ${invCount === 1 ? 'factura asignada' : 'facturas asignadas'}${quoteCount ? ` y ${quoteCount} ${quoteCount === 1 ? 'presupuesto' : 'presupuestos'}` : ''}.\n\nSi aceptas, el cliente se eliminará definitivamente y las facturas se desasignarán (se conservan todos sus datos de emisión e importes, pero quedarán sin ficha de cliente vinculada).`
    }
    else if (expCount > 0) {
      body = `Este proveedor tiene ${expCount} ${expCount === 1 ? 'gasto asignado' : 'gastos asignados'}.\n\nSi aceptas, el proveedor se eliminará definitivamente y los gastos se desasignarán (se conservan todos sus datos e importes, pero quedarán sin proveedor vinculado).`
    }
    else {
      body = `Se eliminará definitivamente a ${form.value.name || 'este contacto'}. Esta acción no se puede deshacer.`
    }

    const ok = await confirm({
      title: `¿Eliminar a ${form.value.name || 'este contacto'}?`,
      body,
      confirmLabel: totalSales > 0 || expCount > 0 ? 'Eliminar y desasignar' : 'Eliminar definitivamente',
      danger: true,
    })
    if (!ok) return

    const res = await $fetch<{ ok: boolean, unassignedSales?: number, unassignedExpenses?: number }>(`/api/contacts/${props.contactId}`, { method: 'DELETE' })
    const unassignedCount = (res.unassignedSales ?? 0) + (res.unassignedExpenses ?? 0)
    toast.success(
      props.role === 'client' ? 'Cliente eliminado' : 'Proveedor eliminado',
      unassignedCount > 0 ? `Se han desasignado ${unassignedCount} documento(s) correctamente.` : form.value.name,
    )
    emit('deleted', props.contactId)
    open.value = false
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" :title="title" :subtitle="isEdit ? undefined : 'Solo el nombre es obligatorio. El NIF hace falta para emitirle facturas completas.'" size="md" side>
    <div v-if="loading" class="loading">
      <div v-for="i in 6" :key="i" class="skeleton" :style="{ height: '38px', width: i % 2 ? '100%' : '70%' }" />
    </div>

    <form v-else :id="formId" class="contact-form" novalidate @submit.prevent="save" @paste="picker?.onPaste($event)">
      <div class="ai-fill" :class="{ open: aiOpen }">
        <button type="button" class="af-toggle" :aria-expanded="aiOpen" @click="aiOpen = !aiOpen">
          <span class="af-ic" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
          <span class="grow">
            <span class="af-t">Rellenar con IA</span>
            <span class="af-s">Pega su firma de correo o los datos de una factura, o sube una foto</span>
          </span>
          <Icon :name="aiOpen ? 'ph:caret-up' : 'ph:caret-down'" aria-hidden="true" />
        </button>
        <div v-if="aiOpen" class="af-body">
          <UiTextarea v-model="aiText" placeholder="Ej.: Lumen Arquitectura S.L. · CIF B86451234 · C/ Serrano 41, 28001 Madrid · admin@lumen.es · 914 222 333" aria-label="Datos del contacto" />
          <div class="row gap-2 wrap">
            <UiButton size="sm" variant="ai" icon="ph:magic-wand" :loading="aiBusy" :disabled="aiText.trim().length < 3" @click="aiFill()">Leer los datos</UiButton>
            <UiButton size="sm" variant="secondary" icon="ph:camera" :disabled="aiBusy" @click="aiFile?.click()">Foto o PDF</UiButton>
            <input ref="aiFile" type="file" class="sr-only" accept="image/*,.pdf,.doc,.docx" tabindex="-1" aria-hidden="true" @change="onAiFile">
          </div>
        </div>
      </div>

      <div class="head-row">
        <UiImagePick
          ref="picker"
          v-model:pending="logoPending"
          v-model:remove="logoRemove"
          :url="logoUrl"
          label="Logotipo"
          noun="logotipo"
          :size="112"
          :max="480"
          fit="contain"
          trim
        />
        <div class="head-fields">
          <UiSegmented v-model="kindModel" :options="kindOptions" label="Tipo de contacto" />
          <UiInput
            v-model="form.name"
            :label="form.kind === 'company' ? 'Razón social' : 'Nombre y apellidos'"
            :placeholder="form.kind === 'company' ? 'Ej. Lumen Arquitectura SL' : 'Ej. Laura Martín Ruiz'"
            :error="errors.name"
            required
            autofocus
            autocomplete="off"
          />
        </div>
      </div>

      <div class="form-grid">

        <div class="c-8">
          <UiInput
            v-model="form.nif"
            :label="form.nifType === 'vat_eu' ? 'NIF-IVA' : form.nifType === 'nif' ? 'NIF' : 'Nº de documento'"
            :placeholder="form.nifType === 'vat_eu' ? 'FR12345678901' : 'B12345678'"
            :error="nifError"
            :hint="nifCheck?.ok ? nifCheck.text : 'Lo comprobamos al momento'"
            autocomplete="off"
            @blur="onNifBlur"
          >
            <template #end>
              <Icon v-if="nifCheck?.ok" name="ph:check-circle-fill" class="ok-ic" aria-hidden="true" />
            </template>
          </UiInput>
        </div>
        <UiSelect v-model="form.nifType" class="c-4" label="Tipo" :options="nifTypeOptions" />

        <UiInput v-model="form.email" class="c-6" label="Email" type="email" icon="ph:envelope-simple" placeholder="facturas@empresa.es" :error="errors.email" autocomplete="off" />
        <UiInput v-model="form.phone" class="c-6" label="Teléfono" type="tel" icon="ph:phone" placeholder="600 000 000" :error="errors.phone" autocomplete="off" />

        <UiInput v-model="form.address" label="Dirección" placeholder="Calle, número, piso" :error="errors.address" autocomplete="off" />
        <UiInput v-model="form.postalCode" class="c-4" label="C. postal" inputmode="numeric" maxlength="10" :error="errors.postalCode" autocomplete="off" />
        <UiInput v-model="form.city" class="c-4" label="Población" :error="errors.city" autocomplete="off" />
        <UiInput v-model="form.province" class="c-4" label="Provincia" :error="errors.province" autocomplete="off" />
      </div>

      <button type="button" class="more-toggle" :aria-expanded="more" @click="more = !more">
        <Icon :name="more ? 'ph:caret-down' : 'ph:caret-right'" aria-hidden="true" />
        Más datos
        <span class="muted">fiscales, bancarios y notas</span>
      </button>

      <Transition name="fade">
        <div v-if="more" class="form-grid more">
          <UiInput v-model="form.tradeName" class="c-6" label="Nombre comercial" :error="errors.tradeName" autocomplete="off" />
          <UiSelect v-model="form.country" class="c-6" label="País" :options="countryOptions" :error="errors.country" />

          <UiInput v-model="form.iban" class="c-8" label="IBAN" placeholder="ES00 0000 0000 0000 0000 0000" icon="ph:bank" :error="errors.iban" autocomplete="off" />
          <UiInput v-model="form.paymentTermsDays" class="c-4" label="Plazo de pago" numeric suffix="días" placeholder="30" :error="errors.paymentTermsDays" />

          <IrpfField
            v-model="form.irpfRate"
            class="c-6"
            nullable
            placeholder="Sin indicar"
            :label="role === 'client' ? 'Retención IRPF en sus facturas' : 'Retención IRPF que le aplicas'"
            :hint="role === 'client' ? 'Vacío: la de tus ajustes (0 % a particulares)' : 'Alquiler 19 %, profesionales 15 %'"
            :error="errors.irpfRate"
          />
          <UiSelect
            v-if="form.isSupplier"
            v-model="form.defaultCategoryId"
            class="c-6"
            label="Categoría de gasto habitual"
            :options="categoryOptions"
            hint="Se aplica sola al registrar sus facturas"
          />
          <UiInput v-model="form.website" :class="form.isSupplier ? 'c-12' : 'c-6'" label="Web" placeholder="https://" :error="errors.website" autocomplete="off" />

          <div v-if="form.isClient" class="switch-cell">
            <UiSwitch v-model="form.equivalenceSurcharge" label="Recargo de equivalencia" hint="Comercio minorista: sus facturas llevarán el recargo" />
          </div>
          <div class="switch-cell">
            <UiSwitch v-model="otherRole" :label="role === 'client' ? 'También es proveedor' : 'También es cliente'" :hint="role === 'client' ? 'Podrás registrar gastos suyos' : 'Podrás emitirle facturas'" />
          </div>

          <UiTextarea v-model="form.notes" label="Notas internas" placeholder="Condiciones pactadas, persona de contacto…" rows="3" :error="errors.notes" />
          <p v-if="errors.isClient" class="error-text" role="alert">{{ errors.isClient }}</p>
        </div>
      </Transition>
    </form>

    <template #footer>
      <UiButton v-if="isEdit" class="del" variant="ghost" icon="ph:trash" :loading="deleting" @click="remove">
        Eliminar
      </UiButton>
      <div class="spacer" />
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" :form="formId" variant="primary" :loading="saving" :disabled="loading" icon="ph:check-bold">
        {{ isEdit ? 'Guardar cambios' : `Crear ${roleLabel}` }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
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

.ok-ic {
  width: 17px;
  height: 17px;
  color: var(--success-solid);
  flex-shrink: 0;
}

.more-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: var(--s-6) 0 var(--s-4);
  padding: 10px 0 0;
  font-weight: 600;
  color: var(--text);
  border-top: 1px solid var(--border-subtle);
  text-align: left;
}

.more-toggle .muted {
  font-weight: 450;
  font-size: var(--text-sm);
}

.more-toggle :deep(svg) {
  width: 15px;
  height: 15px;
  color: var(--text-3);
}

.switch-cell {
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

@media (min-width: 640px) {
  .switch-cell {
    grid-column: span 6;
  }

  .form-grid .c-12 {
    grid-column: span 12;
  }
}
.ai-fill {
  margin-bottom: var(--s-5);
  background: var(--ai-soft), var(--surface);
  border: 1px solid color-mix(in srgb, var(--ai-2) 25%, var(--border));
  border-radius: var(--r-lg);
}

.af-toggle {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  padding: 10px 12px;
  text-align: left;
}

.af-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  font-size: 15px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-md);
}

.af-t {
  display: block;
  font-weight: 600;
  font-size: var(--text-sm);
}

.af-s {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.af-body {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: 0 12px 12px;
}
</style>
