<script setup lang="ts">
import type { CatalogItem } from '~/components/sales/ConceptInput.vue'

/** Alta y edición de facturas y gastos recurrentes, con vista previa de las próximas fechas */
export interface RecurringLineForm {
  itemId: number | null
  description: string
  quantity: number | null
  unitPrice: number | null
  discountPct: number | null
  vatRate: number
}

export interface RecurringForm {
  kind: 'invoice' | 'expense'
  name: string
  frequency: Frequency
  interval: number | null
  nextDate: string
  hasEnd: boolean
  endDate: string | null
  autoIssue: boolean
  autoSend: boolean
  contactId: number | null
  categoryId: number | null
  description: string | null
  irpfRate: number
  seriesId: number | null
  lines: RecurringLineForm[]
  paymentMethod: string
  dueDays: number | null
  notes: string | null
  terms: string | null
  customerReference: string | null
  expenseKind: string
  taxLines: Array<{ base: number | null, vatRate: number }>
  paid: boolean
  deductiblePct: number
  vatDeductiblePct: number
}

const props = defineProps<{
  recurringId?: number | null
  /** Datos de partida al crear (desde una factura, un gasto o el tipo elegido) */
  prefill?: Partial<RecurringForm> | null
}>()
const emit = defineEmits<{ saved: [id: number], deleted: [] }>()
const open = defineModel<boolean>({ default: false })

interface Contact { id: number, name: string, nif: string | null, city: string | null, email: string | null, paymentTermsDays: number | null, irpfRate: number | null, defaultCategoryId: number | null, logoUrl: string | null }
interface Category { id: number, kind: string, name: string, accountCode: string | null, deductiblePct: number }

const toast = useToast()
const { confirm } = useConfirm()
// Gestor: ve la programación con los campos bloqueados, sin guardar ni eliminar
const { verifactu, readOnly } = useMe()
const formId = useId()
const today = todayISO()

const newLine = (): RecurringLineForm => ({ itemId: null, description: '', quantity: 1, unitPrice: null, discountPct: 0, vatRate: 21 })
const blank = (kind: 'invoice' | 'expense' = 'invoice'): RecurringForm => ({
  kind,
  name: '',
  frequency: 'monthly',
  interval: 1,
  nextDate: today,
  hasEnd: false,
  endDate: null,
  autoIssue: kind === 'expense',
  autoSend: false,
  contactId: null,
  categoryId: null,
  description: null,
  irpfRate: 0,
  seriesId: null,
  lines: [newLine()],
  paymentMethod: kind === 'expense' ? 'direct_debit' : 'transfer',
  dueDays: null,
  notes: null,
  terms: null,
  customerReference: null,
  expenseKind: 'invoice',
  taxLines: [{ base: null, vatRate: 21 }],
  paid: kind === 'expense',
  deductiblePct: 100,
  vatDeductiblePct: 100,
})

const form = ref<RecurringForm>(blank())
/** Programación guardada: si no cambia, la vista previa respeta su día de anclaje */
const original = ref<{ startDate: string, nextDate: string, frequency: string, interval: number, status: string } | null>(null)
const errors = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const more = ref(false)
const isEdit = computed(() => !!props.recurringId)
const isInvoice = computed(() => form.value.kind === 'invoice')

// ─── Datos auxiliares ───

const clients = ref<Contact[]>([])
const suppliers = ref<Contact[]>([])
const categories = ref<Category[]>([])
const catalog = ref<CatalogItem[]>([])
const mail = ref<{ configured: boolean } | null>(null)
const company = ref<{ paymentTermsDays: number, defaultIrpfRate: number } | null>(null)

async function loadLists() {
  const [c, s, cat, items, comp] = await Promise.all([
    $fetch<Contact[]>('/api/contacts', { query: { role: 'client', limit: 500 } }).catch(() => []),
    $fetch<Contact[]>('/api/contacts', { query: { role: 'supplier', limit: 500 } }).catch(() => []),
    categories.value.length ? Promise.resolve(categories.value) : $fetch<Category[]>('/api/categories').catch(() => []),
    catalog.value.length ? Promise.resolve(catalog.value) : $fetch<CatalogItem[]>('/api/items').catch(() => []),
    company.value ? Promise.resolve(company.value) : $fetch<{ paymentTermsDays: number, defaultIrpfRate: number }>('/api/companies/current').catch(() => null),
  ])
  clients.value = c
  suppliers.value = s
  categories.value = cat
  catalog.value = items
  company.value = comp
  // Solo administradores consultan el correo: si no, se asume configurado y el servidor avisará
  if (!readOnly.value) mail.value ??= await $fetch<{ configured: boolean }>('/api/mail/status').catch(() => null)
}

interface Detail {
  kind: 'invoice' | 'expense'
  name: string
  frequency: Frequency
  interval: number
  startDate: string
  nextDate: string
  endDate: string | null
  autoIssue: boolean
  autoSend: boolean
  status: string
  template: {
    contactId?: number | null
    categoryId?: number | null
    description?: string | null
    seriesId?: number | null
    lines?: Array<{ itemId?: number | null, description: string, quantity: number, unitPrice: number, vatRate: number, discountPct?: number }>
    paymentMethod?: string | null
    dueDays?: number | null
    notes?: string | null
    terms?: string | null
    customerReference?: string | null
    expenseKind?: string
    taxLines?: Array<{ base: number, vatRate: number }>
    paid?: boolean
    irpfRate?: number
    deductiblePct?: number
    vatDeductiblePct?: number
  }
}

watch([open, () => props.recurringId], async ([v]) => {
  if (!v) return
  errors.value = {}
  more.value = false
  loading.value = true
  try {
    const lists = loadLists()
    if (props.recurringId) {
      const d = await $fetch<Detail>(`/api/recurrings/${props.recurringId}`)
      const t = d.template
      original.value = { startDate: d.startDate, nextDate: d.nextDate, frequency: d.frequency, interval: d.interval, status: d.status }
      form.value = {
        ...blank(d.kind),
        name: d.name,
        frequency: d.frequency,
        interval: d.interval,
        nextDate: d.nextDate,
        hasEnd: !!d.endDate,
        endDate: d.endDate,
        autoIssue: d.autoIssue,
        autoSend: d.autoSend,
        contactId: t.contactId ?? null,
        categoryId: t.categoryId ?? null,
        description: t.description ?? null,
        irpfRate: t.irpfRate ?? 0,
        seriesId: t.seriesId ?? null,
        lines: t.lines?.length ? t.lines.map(l => ({ itemId: l.itemId ?? null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0, vatRate: l.vatRate })) : [newLine()],
        paymentMethod: t.paymentMethod ?? (d.kind === 'expense' ? 'direct_debit' : 'transfer'),
        dueDays: t.dueDays ?? null,
        notes: t.notes ?? null,
        terms: t.terms ?? null,
        customerReference: t.customerReference ?? null,
        expenseKind: t.expenseKind ?? 'invoice',
        taxLines: t.taxLines?.length ? t.taxLines.map(l => ({ base: l.base, vatRate: l.vatRate })) : [{ base: null, vatRate: 21 }],
        paid: !!t.paid,
        deductiblePct: t.deductiblePct ?? 100,
        vatDeductiblePct: t.vatDeductiblePct ?? 100,
      }
      more.value = !!(t.notes || t.customerReference)
    }
    else {
      original.value = null
      const p = props.prefill ?? {}
      form.value = { ...blank(p.kind ?? 'invoice'), ...p }
      if (!form.value.lines.length) form.value.lines = [newLine()]
      if (!form.value.taxLines.length) form.value.taxLines = [{ base: null, vatRate: 21 }]
      more.value = !!(p.notes || p.customerReference)
    }
    await lists
  }
  catch (err) {
    toast.error(errorMessage(err))
    open.value = false
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

// ─── Opciones ───

const contacts = computed(() => (isInvoice.value ? clients.value : suppliers.value))
const contactOptions = computed(() => contacts.value.map(c => ({ value: c.id, label: c.name, sub: c.nif ?? c.city, image: c.logoUrl })))
const contact = computed(() => contacts.value.find(c => c.id === form.value.contactId) ?? null)
const categoryOptions = computed(() => [
  { value: null, label: 'Sin categoría' },
  ...categories.value.filter(c => c.kind === 'expense').sort((a, b) => a.name.localeCompare(b.name, 'es')).map(c => ({ value: c.id, label: c.accountCode ? `${c.name} · ${c.accountCode}` : c.name })),
])
/** "Cada [1] [mes]" / "Cada [3] [meses]": la unidad concuerda con el número */
const frequencyOptions = computed(() => {
  const one = (form.value.interval ?? 1) === 1
  return [
    { value: 'weekly', label: one ? 'semana' : 'semanas' },
    { value: 'monthly', label: one ? 'mes' : 'meses' },
    { value: 'quarterly', label: one ? 'trimestre' : 'trimestres' },
    { value: 'yearly', label: one ? 'año' : 'años' },
  ]
})
const vatOptions = VAT_RATES.map(r => ({ value: r, label: `${r} %` }))
const methodOptions = Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))
const expenseKindOptions = Object.entries(EXPENSE_KIND).map(([value, label]) => ({ value, label }))

// Al elegir cliente o proveedor: su retención y su categoría por defecto
watch(() => form.value.contactId, (id, prev) => {
  if (loading.value || id === prev) return
  const c = contacts.value.find(x => x.id === id)
  if (!c) return
  if (c.irpfRate != null) form.value.irpfRate = c.irpfRate
  if (!isInvoice.value && c.defaultCategoryId && !form.value.categoryId) form.value.categoryId = c.defaultCategoryId
  if (!form.value.name.trim()) form.value.name = isInvoice.value ? `${c.name} · ${form.value.lines[0]?.description.split('\n')[0] || 'cuota'}` : c.name
})

// Deducibilidad: lo que marcaste la última vez con este proveedor o el % de la categoría (vehículo…)
const learned = ref<string | null>(null)
let guessSeq = 0
async function guessDeductible() {
  const f = form.value
  if (f.kind !== 'expense') return
  const n = ++guessSeq
  const g = await $fetch<{ deductiblePct: number, vatDeductiblePct: number, source: 'supplier' | 'category' | 'default' }>('/api/expenses/deductible', {
    query: { supplierId: f.contactId ?? undefined, categoryId: f.categoryId ?? undefined },
  }).catch(() => null)
  if (!g || n !== guessSeq) return
  f.deductiblePct = g.deductiblePct
  f.vatDeductiblePct = g.vatDeductiblePct
  learned.value = g.source === 'supplier' ? contacts.value.find(c => c.id === f.contactId)?.name ?? null : null
}
watch(() => [form.value.contactId, form.value.categoryId], (now, before) => {
  if (loading.value || (now[0] === before?.[0] && now[1] === before?.[1])) return
  guessDeductible()
})

watch(() => form.value.expenseKind, (k) => {
  if (loading.value) return
  if (k === 'payroll' || k === 'social_security' || k === 'tax') {
    form.value.taxLines.forEach(l => { l.vatRate = 0 })
  }
  if (!form.value.categoryId) {
    if (k === 'payroll') {
      const c = categories.value.find(x => x.accountCode === '640' || /sueldo|salario|n[oó]mina/i.test(x.name))
      if (c) form.value.categoryId = c.id
    }
    else if (k === 'social_security') {
      const c = categories.value.find(x => x.accountCode === '642' || /aut[oó]nomo|seguridad social/i.test(x.name))
      if (c) form.value.categoryId = c.id
    }
    else if (k === 'tax') {
      const c = categories.value.find(x => x.accountCode === '631' || /tributo|impuesto/i.test(x.name))
      if (c) form.value.categoryId = c.id
    }
  }
})

const gross = ref<number | null>(null)
function applyGross() {
  if (gross.value == null) return
  const l = form.value.taxLines[0]
  if (!l) return
  form.value.taxLines = [l]
  const base = round2(gross.value / (1 + (l.vatRate - form.value.irpfRate) / 100))
  l.base = base
  gross.value = null
}

const hasVat = computed(() => form.value.taxLines.some(l => l.vatRate > 0))

function setKind(k: 'invoice' | 'expense') {
  if (isEdit.value || form.value.kind === k) return
  form.value = { ...blank(k), name: form.value.name, frequency: form.value.frequency, interval: form.value.interval, nextDate: form.value.nextDate, hasEnd: form.value.hasEnd, endDate: form.value.endDate }
}

// ─── Líneas ───

function pickItem(l: RecurringLineForm, item: CatalogItem) {
  l.itemId = item.id
  l.description = item.description ? `${item.name}\n${item.description}` : item.name
  l.unitPrice = item.unitPrice
  l.vatRate = item.vatRate
}

function addLine() {
  form.value.lines.push(newLine())
}

function removeLine(i: number) {
  form.value.lines.splice(i, 1)
  if (!form.value.lines.length) form.value.lines.push(newLine())
}

function addTaxLine() {
  const used = new Set(form.value.taxLines.map(l => l.vatRate))
  form.value.taxLines.push({ base: null, vatRate: VAT_RATES.find(r => !used.has(r)) ?? 21 })
}

function removeTaxLine(i: number) {
  form.value.taxLines.splice(i, 1)
  if (!form.value.taxLines.length) form.value.taxLines.push({ base: null, vatRate: 21 })
}

// ─── Totales (mismo cálculo que el servidor) ───

const totals = computed(() => {
  const f = form.value
  if (f.kind === 'invoice') {
    const t = computeTotals(f.lines.filter(l => l.description.trim()).map(l => ({ quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0, discountPct: l.discountPct ?? 0, vatRate: l.vatRate })), f.irpfRate)
    return { base: t.taxBase, vat: t.vatTotal, irpf: t.irpfTotal, total: t.total }
  }
  const lines = f.taxLines.filter(l => l.base != null)
  const base = round2(lines.reduce((s, l) => s + round2(l.base!), 0))
  const vat = round2(lines.reduce((s, l) => s + pctOf(l.base!, l.vatRate), 0))
  const irpf = pctOf(base, f.irpfRate)
  return { base, vat, irpf, total: round2(base + vat - irpf) }
})

const monthly = computed(() => round2(totals.value.base * monthlyEquivalent(form.value.frequency, form.value.interval ?? 1)))

// ─── Calendario ───

const rescheduled = computed(() => !original.value || original.value.nextDate !== form.value.nextDate || original.value.frequency !== form.value.frequency || original.value.interval !== (form.value.interval ?? 1))
const anchor = computed(() => (rescheduled.value ? form.value.nextDate : original.value!.startDate))
const preview = computed(() => {
  const f = form.value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.nextDate)) return []
  return upcomingOccurrences(anchor.value, f.frequency, f.interval ?? 1, f.nextDate, 5, f.hasEnd ? f.endDate : null)
})
/** Fechas ya pasadas que el programador generará al guardar */
const overdue = computed(() => {
  const f = form.value
  if (!rescheduled.value || !/^\d{4}-\d{2}-\d{2}$/.test(f.nextDate) || f.nextDate >= today) return 0
  return upcomingOccurrences(anchor.value, f.frequency, f.interval ?? 1, f.nextDate, 60, f.hasEnd && f.endDate && f.endDate < today ? f.endDate : today).filter(d => d <= today).length
})

const weekday = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')

watch(() => form.value.autoIssue, (v) => {
  if (!v) form.value.autoSend = false
})

const sendBlocked = computed(() => {
  if (!form.value.autoIssue) return 'Actívalo cuando se emita sola'
  if (mail.value && !mail.value.configured) return 'Configura el correo de la app para enviar facturas'
  if (contact.value && !contact.value.email) return `${contact.value.name} no tiene email en su ficha`
  return null
})

const defaultDue = computed(() => contact.value?.paymentTermsDays ?? company.value?.paymentTermsDays ?? 30)

// ─── Guardar / eliminar ───

async function save() {
  errors.value = {}
  const f = form.value
  if (!f.name.trim()) errors.value.name = 'Ponle un nombre para reconocerla'
  if (!f.nextDate) errors.value.nextDate = 'Indica la fecha'
  if (f.kind === 'invoice' && !f.contactId) errors.value.contactId = 'Elige el cliente al que se factura'
  if (f.kind === 'invoice' && !f.lines.some(l => l.description.trim())) errors.value.lines = 'Añade al menos una línea con concepto'
  if (f.kind === 'expense' && !f.taxLines.some(l => l.base != null)) errors.value.taxLines = 'Indica la base imponible'
  if (Object.keys(errors.value).length) return

  saving.value = true
  try {
    const body = {
      kind: f.kind,
      name: f.name,
      frequency: f.frequency,
      interval: f.interval ?? 1,
      nextDate: f.nextDate,
      endDate: f.hasEnd ? f.endDate || null : null,
      autoIssue: f.autoIssue,
      autoSend: f.kind === 'invoice' && f.autoIssue && f.autoSend,
      contactId: f.contactId,
      categoryId: f.kind === 'expense' ? f.categoryId : null,
      description: f.description,
      irpfRate: f.irpfRate,
      seriesId: f.seriesId,
      lines: f.kind === 'invoice'
        ? f.lines.filter(l => l.description.trim()).map(l => ({ itemId: l.itemId, description: l.description, quantity: l.quantity ?? 1, unitPrice: l.unitPrice ?? 0, discountPct: l.discountPct ?? 0, vatRate: l.vatRate }))
        : [],
      paymentMethod: f.paymentMethod,
      dueDays: f.dueDays,
      notes: f.notes,
      terms: f.terms,
      customerReference: f.customerReference,
      expenseKind: f.expenseKind,
      taxLines: f.kind === 'expense' ? f.taxLines.filter(l => l.base != null).map(l => ({ base: l.base!, vatRate: l.vatRate })) : [],
      paid: f.paid,
      deductiblePct: f.deductiblePct,
      vatDeductiblePct: f.vatDeductiblePct,
    }
    let id = props.recurringId ?? 0
    if (props.recurringId) await $fetch(`/api/recurrings/${props.recurringId}`, { method: 'PATCH', body })
    else id = (await $fetch<{ id: number }>('/api/recurrings', { method: 'POST', body })).id
    toast.success(isEdit.value ? 'Recurrente actualizado' : 'Recurrente programado', `${frequencyLabel(f.frequency, f.interval ?? 1)} · próxima ${fdate(f.nextDate)}`)
    emit('saved', id)
    open.value = false
  }
  catch (err) {
    const field = errorField(err)?.split('.')[0]
    if (field && ['name', 'nextDate', 'endDate', 'contactId', 'lines', 'taxLines', 'autoSend', 'interval'].includes(field)) errors.value[field] = errorMessage(err)
    else toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.recurringId) return
  const ok = await confirm({ title: '¿Eliminar este recurrente?', body: 'Dejará de generarse. Las facturas y gastos ya creados se conservan.', confirmLabel: 'Eliminar', danger: true })
  if (!ok) return
  deleting.value = true
  try {
    await $fetch(`/api/recurrings/${props.recurringId}`, { method: 'DELETE' })
    toast.success('Recurrente eliminado')
    emit('deleted')
    open.value = false
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
  finally {
    deleting.value = false
  }
}

// Alta de cliente o proveedor sin salir
const creatingContact = ref(false)
const newContactName = ref('')
function onCreateContact(q: string) {
  newContactName.value = q
  creatingContact.value = true
}
async function onContactCreated(id: number) {
  const role = isInvoice.value ? 'client' : 'supplier'
  const list = await $fetch<Contact[]>('/api/contacts', { query: { role, limit: 500 } }).catch(() => null)
  if (list) {
    if (role === 'client') clients.value = list
    else suppliers.value = list
  }
  form.value.contactId = id
}
</script>

<template>
  <UiModal v-model="open" :title="readOnly ? 'Recurrente' : isEdit ? 'Editar recurrente' : 'Nuevo recurrente'" :subtitle="isEdit ? undefined : 'Programa una vez: NUMIQ lo genera en cada fecha.'" size="xl">
    <div v-if="loading" class="loading">
      <div class="skeleton" style="height: 40px" />
      <div class="sk-grid">
        <div v-for="i in 3" :key="i" class="skeleton" style="height: 38px" />
      </div>
      <div class="skeleton" style="height: 140px" />
    </div>

    <form v-else :id="formId" class="rec-form" :class="{ ro: readOnly }" novalidate @submit.prevent="save">
      <fieldset class="ro-fs" :disabled="readOnly">
      <div v-if="!isEdit" class="kinds" role="radiogroup" aria-label="Qué se repite">
        <button type="button" role="radio" class="kind" :class="{ on: isInvoice }" :aria-checked="isInvoice" @click="setKind('invoice')">
          <span class="k-ic inc" aria-hidden="true"><Icon name="ph:receipt" /></span>
          <span class="grow"><strong>Factura a un cliente</strong><span>Igualas, mantenimientos, cuotas, alquileres que cobras</span></span>
        </button>
        <button type="button" role="radio" class="kind" :class="{ on: !isInvoice }" :aria-checked="!isInvoice" @click="setKind('expense')">
          <span class="k-ic exp" aria-hidden="true"><Icon name="ph:wallet" /></span>
          <span class="grow"><strong>Gasto fijo</strong><span>Alquiler, cuota de autónomos, software, seguros</span></span>
        </button>
      </div>

      <div class="cols">
        <div class="main">
          <div class="form-grid">
            <UiCombobox
              v-model="form.contactId"
              class="c-7"
              :label="isInvoice ? 'Cliente' : (form.expenseKind === 'payroll' ? 'Perceptor / Socio / Empleado' : 'Proveedor')"
              :options="contactOptions"
              :placeholder="isInvoice ? 'Busca o crea un cliente' : (form.expenseKind === 'payroll' ? 'Busca o crea el perceptor (socio o empleado)' : 'Busca o crea un proveedor (opcional)')"
              :create-label="isInvoice ? 'Nuevo cliente' : (form.expenseKind === 'payroll' ? 'Nuevo perceptor' : 'Nuevo proveedor')"
              :required="isInvoice"
              :error="errors.contactId"
              avatars
              @create="onCreateContact"
            />
            <UiInput v-model="form.name" class="c-5" label="Nombre" :placeholder="isInvoice ? 'Ej. Mantenimiento web' : (form.expenseKind === 'payroll' ? 'Ej. Nómina mensual socio' : 'Ej. Alquiler del local')" :error="errors.name" required autocomplete="off" />
          </div>

          <!-- Contenido: factura -->
          <section v-if="isInvoice" class="block">
            <h3 class="section-title">Conceptos</h3>
            <div class="lines" role="table" aria-label="Líneas de la factura">
              <div class="ln head" role="row">
                <span role="columnheader">Concepto</span>
                <span role="columnheader" class="r">Cant.</span>
                <span role="columnheader" class="r">Precio</span>
                <span role="columnheader">IVA</span>
                <span />
              </div>
              <div v-for="(l, i) in form.lines" :key="i" class="ln" role="row">
                <SalesConceptInput v-model="l.description" :items="catalog" :linked="!!l.itemId" class="desc-cell" @pick="pickItem(l, $event)" @update:model-value="l.itemId = null" />
                <SalesNumCell v-model="l.quantity" :decimals="3" label="Cantidad" class="q" />
                <SalesNumCell v-model="l.unitPrice" :decimals="4" label="Precio" suffix="€" placeholder="0,00" class="p" />
                <UiSelect v-model="l.vatRate" :options="vatOptions" :aria-label="`IVA de la línea ${i + 1}`" class="v" />
                <UiButton variant="ghost" size="sm" square icon="ph:trash" :aria-label="`Quitar línea ${i + 1}`" :disabled="form.lines.length === 1 && !l.description" @click="removeLine(i)" />
              </div>
              <p v-if="errors.lines" class="error-text" role="alert">{{ errors.lines }}</p>
              <button type="button" class="add" @click="addLine"><Icon name="ph:plus" aria-hidden="true" /> Añadir línea</button>
            </div>
            <div class="form-grid tight">
              <IrpfField v-model="form.irpfRate" class="c-4" />
              <UiSelect v-model="form.paymentMethod" class="c-4" label="Forma de pago" :options="methodOptions" />
              <UiInput v-model="form.dueDays" class="c-4" label="Vence a" numeric suffix="días" :placeholder="String(defaultDue)" :hint="form.dueDays == null ? 'Los del cliente o tu empresa' : undefined" />
            </div>
          </section>

          <!-- Contenido: gasto -->
          <section v-else class="block">
            <div class="form-grid">
              <UiSelect v-model="form.categoryId" class="c-6" label="Categoría" :options="categoryOptions" />
              <UiSelect v-model="form.expenseKind" class="c-6" label="Tipo" :options="expenseKindOptions" />
              <UiInput v-model="form.description" label="Concepto" :placeholder="form.expenseKind === 'payroll' ? 'Ej. Nómina socio administrador' : 'Ej. Puesto fijo en el coworking'" autocomplete="off" />
            </div>
            <div class="amounts-head">
              <h3 class="section-title">Importes</h3>
              <div class="gross">
                <UiInput
                  v-model="gross"
                  numeric
                  suffix="€"
                  :placeholder="form.expenseKind === 'payroll' ? '¿Neto a pagar? (ej. 2000)' : '¿Solo tienes el total?'"
                  :aria-label="form.expenseKind === 'payroll' ? 'Importe neto a percibir' : 'Total para desglosar'"
                  @keydown.enter.prevent="applyGross"
                />
                <UiButton size="sm" variant="soft" icon="ph:magic-wand" :disabled="gross == null" @click="applyGross">
                  {{ form.expenseKind === 'payroll' ? 'Calcular bruto' : 'Desglosar' }}
                </UiButton>
              </div>
            </div>
            <div class="tax">
              <div v-for="(l, i) in form.taxLines" :key="i" class="tx">
                <UiInput v-model="l.base" numeric suffix="€" placeholder="Base imponible" :aria-label="`Base imponible ${i + 1}`" :error="i === 0 ? errors.taxLines : undefined" />
                <UiSelect v-model="l.vatRate" :options="vatOptions" :aria-label="`Tipo de IVA ${i + 1}`" />
                <UiButton variant="ghost" size="sm" square icon="ph:trash" :aria-label="`Quitar importe ${i + 1}`" :disabled="form.taxLines.length === 1 && l.base == null" @click="removeTaxLine(i)" />
              </div>
              <button v-if="form.taxLines.length < 4" type="button" class="add" @click="addTaxLine"><Icon name="ph:plus" aria-hidden="true" /> Otro tipo de IVA</button>
            </div>
            <div class="form-grid tight">
              <IrpfField v-model="form.irpfRate" class="c-6" :hint="form.expenseKind === 'payroll' ? 'Nómina: el tipo exacto que figura en ella (p. ej. 12,43 %)' : 'Alquileres 19 %, profesionales 15 %'" />
              <UiSelect v-model="form.paymentMethod" class="c-6" label="Forma de pago" :options="methodOptions" />
            </div>
            <ExpenseDeductible
              v-model:pct="form.deductiblePct"
              v-model:vat-pct="form.vatDeductiblePct"
              :has-vat="hasVat"
              :base="totals.base"
              :vat="totals.vat"
              :learned="learned"
            />
            <UiSwitch v-model="form.paid" class="paid" label="Se da por pagado" :hint="form.paid ? 'Domiciliado o con tarjeta: se registra ya pagado' : 'Lo verás en pendientes de pago'" />
          </section>

          <dl class="totals" aria-live="polite">
            <div><dt>Base imponible</dt><dd class="num">{{ eur(totals.base) }}</dd></div>
            <div><dt>IVA</dt><dd class="num">{{ eur(totals.vat) }}</dd></div>
            <div v-if="totals.irpf"><dt>Retención IRPF ({{ num(form.irpfRate) }} %)</dt><dd class="num neg">−{{ eur(totals.irpf) }}</dd></div>
            <div class="grand"><dt>{{ isInvoice ? 'Cada factura' : 'Cada pago' }}</dt><dd class="num">{{ eur(totals.total) }}</dd></div>
            <div class="soft"><dt>Equivale a</dt><dd class="num">{{ eur(monthly) }} al mes sin IVA</dd></div>
          </dl>

          <template v-if="isInvoice">
            <button type="button" class="more-toggle" :aria-expanded="more" @click="more = !more">
              <Icon :name="more ? 'ph:caret-down' : 'ph:caret-right'" aria-hidden="true" />
              Notas y referencia
            </button>
            <div v-if="more" class="form-grid">
              <UiInput v-model="form.customerReference" class="c-6" label="Orden de Pedido" placeholder="Nº de pedido del cliente" />
              <UiTextarea v-model="form.notes" label="Notas en la factura" placeholder="Se imprimen en cada factura" />
            </div>
          </template>
        </div>

        <!-- Lateral: programación, modo y vista previa -->
        <aside class="side">
          <section class="panel">
            <h3 class="section-title">Cuándo</h3>
            <div class="every">
              <span class="lbl">Cada</span>
              <UiInput v-model="form.interval" numeric aria-label="Cada cuántos periodos" class="int" />
              <UiSelect v-model="form.frequency" :options="frequencyOptions" aria-label="Periodo" class="freq" />
            </div>
            <p v-if="(form.interval ?? 1) > 1" class="freq-text">{{ frequencyLabel(form.frequency, form.interval ?? 1) }}</p>
            <UiInput v-model="form.nextDate" type="date" :label="isEdit ? 'Próxima fecha' : 'Primera fecha'" :error="errors.nextDate" required />
            <UiSwitch v-model="form.hasEnd" label="Termina en una fecha" />
            <UiInput v-if="form.hasEnd" v-model="form.endDate" type="date" label="Última fecha" :error="errors.endDate" />

            <div class="dates" aria-live="polite">
              <p class="eyebrow">Próximas fechas</p>
              <ol>
                <li v-for="(d, i) in preview" :key="d" :class="{ past: d < today, first: i === 0 }">
                  <span class="wd">{{ weekday(d) }}</span>
                  <span class="num">{{ fdate(d) }}</span>
                  <span v-if="d === today" class="tag">hoy</span>
                </li>
              </ol>
              <p v-if="overdue" class="warn-note">
                <Icon name="ph:clock-counter-clockwise" aria-hidden="true" />
                {{ overdue === 1 ? 'Hay 1 fecha pasada: se generará' : `Hay ${overdue} fechas pasadas: se generarán` }} en unos minutos{{ isInvoice ? ', con fecha de hoy' : '' }}.
              </p>
            </div>
          </section>

          <section class="panel">
            <h3 class="section-title">Cómo</h3>
            <div class="modes" role="radiogroup" aria-label="Modo">
              <button type="button" role="radio" class="mode" :class="{ on: !form.autoIssue }" :aria-checked="!form.autoIssue" @click="form.autoIssue = false">
                <Icon name="ph:eye" aria-hidden="true" />
                <span><strong>Con revisión</strong>{{ isInvoice ? 'Se crea un borrador para que lo emitas' : 'Queda marcado para revisar en Gastos' }}</span>
              </button>
              <button type="button" role="radio" class="mode" :class="{ on: form.autoIssue }" :aria-checked="form.autoIssue" @click="form.autoIssue = true">
                <Icon name="ph:lightning" aria-hidden="true" />
                <span><strong>Automático</strong>{{ isInvoice ? `Se emite sola, con número${verifactu ? ' y VeriFactu' : ''}` : 'Se registra directamente' }}</span>
              </button>
            </div>
            <template v-if="isInvoice">
              <UiSwitch v-model="form.autoSend" label="Enviar por email al cliente" :hint="sendBlocked ?? `A ${contact?.email ?? 'su email'}, con el PDF`" :disabled="!!sendBlocked && !form.autoSend" />
              <p v-if="errors.autoSend" class="error-text" role="alert">{{ errors.autoSend }}</p>
            </template>
          </section>

        </aside>
      </div>
      </fieldset>
    </form>

    <template v-if="readOnly" #footer>
      <UiButton @click="open = false">Cerrar</UiButton>
    </template>
    <template v-else #footer>
      <UiButton v-if="isEdit" class="del" variant="ghost" icon="ph:trash" :loading="deleting" @click="remove">Eliminar</UiButton>
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" :form="formId" variant="primary" :loading="saving" :disabled="loading" icon="ph:check-bold">
        {{ isEdit ? 'Guardar cambios' : 'Programar' }}
      </UiButton>
    </template>

    <ContactModal v-model="creatingContact" :role="isInvoice ? 'client' : 'supplier'" :prefill-name="newContactName" @saved="onContactCreated" />
  </UiModal>
</template>

<style scoped>
.loading {
  display: grid;
  gap: var(--s-4);
}

.sk-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-3);
}

.rec-form {
  display: grid;
  gap: var(--s-5);
}

/* Solo agrupa los campos para bloquearlos en modo consulta: no altera la maquetación */
.ro-fs {
  display: contents;
}

.ro .add,
.ro .gross,
.ro .ln > .btn,
.ro .tx > .btn {
  display: none;
}

/* ─── Tipo ─── */

.kinds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-3);
}

.kind {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), box-shadow var(--t-fast), background var(--t-fast);
}

.kind:hover {
  border-color: var(--border-strong);
}

.kind.on {
  border-color: var(--brand);
  background: var(--brand-soft);
  box-shadow: var(--focus-ring);
}

.kind strong {
  display: block;
  font-weight: 600;
}

.kind span span {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.k-ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  font-size: 19px;
  border-radius: 11px;
}

.k-ic.inc {
  color: var(--chart-income);
  background: color-mix(in srgb, var(--chart-income) 13%, transparent);
}

.k-ic.exp {
  color: var(--chart-expense);
  background: color-mix(in srgb, var(--chart-expense) 14%, transparent);
}

/* ─── Columnas ─── */

.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: var(--s-6);
  align-items: start;
}

.main {
  display: grid;
  gap: var(--s-5);
  min-width: 0;
}

.block {
  display: grid;
  gap: var(--s-3);
}

.form-grid.tight {
  margin-top: var(--s-1);
}

/* Líneas de factura: los campos del editor de facturas, con los colores de la app (no los del papel) */
.lines {
  --p-text: var(--text);
  --p-text-2: var(--text-2);
  --p-text-3: var(--text-3);
  --p-line: var(--border);
  --p-line-strong: var(--border-strong);
  --p-soft: var(--surface-hover);
  --p-accent: var(--brand);

  display: grid;
  gap: 6px;
}

.lines :deep(.sug) {
  background: var(--surface);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-lg);
}

.ln {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px 104px 92px 32px;
  gap: 8px;
  align-items: start;
}

.ln.head {
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
}

.ln.head .r {
  text-align: right;
}

.ln :deep(.cell) {
  width: 100%;
  min-height: 38px;
  padding: 9px 10px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-xs);
  outline: none;
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}

.ln :deep(.cell:focus) {
  border-color: var(--brand);
  box-shadow: var(--focus-ring);
}

.ln :deep(.desc) {
  resize: none;
  overflow: hidden;
  line-height: 1.4;
}

.add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
  padding: 6px 2px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--brand-text);
}

.add:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.amounts-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  flex-wrap: wrap;
  margin-top: var(--s-3);
  margin-bottom: var(--s-2);
}

.gross {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.gross :deep(.field) {
  width: 190px;
}

/* Importes de gasto */
.tax {
  display: grid;
  gap: 8px;
}

.tx {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px 32px;
  gap: 8px;
  align-items: start;
}

.paid {
  padding: var(--s-3) var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.more-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-2);
}

/* ─── Lateral ─── */

.side {
  display: grid;
  gap: var(--s-3);
  position: sticky;
  top: 0;
}

.panel {
  display: grid;
  gap: var(--s-3);
  padding: var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.every {
  display: grid;
  grid-template-columns: auto 64px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.freq-text {
  margin-top: -6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.lbl {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.dates ol {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  padding: 0;
  list-style: none;
}

.dates li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  font-size: var(--text-xs);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
}

.dates li.first {
  font-weight: 600;
  background: var(--brand-soft);
  border-color: color-mix(in srgb, var(--brand) 35%, var(--border));
  color: var(--brand-text);
}

.dates li.past {
  color: var(--warning);
}

.wd {
  font-size: var(--text-xs);
  text-transform: capitalize;
  color: var(--text-3);
}

.first .wd {
  color: inherit;
}

.tag {
  padding: 0 6px;
  font-size: var(--text-2xs);
  font-weight: 600;
  color: var(--brand-text);
  background: var(--surface);
  border-radius: var(--r-full);
}

.warn-note {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  font-size: var(--text-xs);
  color: var(--warning);
}

.warn-note svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.modes {
  display: grid;
  gap: 6px;
}

.mode {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  text-align: left;
  font-size: var(--text-xs);
  color: var(--text-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.mode svg {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 16px;
  color: var(--text-3);
}

.mode strong {
  display: block;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text);
}

.mode.on {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.mode.on svg {
  color: var(--brand-text);
}

.totals {
  display: grid;
  gap: 6px;
  justify-self: end;
  width: min(100%, 340px);
  margin: 0;
  font-size: var(--text-sm);
}

.totals > div {
  display: flex;
  justify-content: space-between;
  gap: var(--s-4);
}

.totals dt {
  color: var(--text-3);
}

.totals dd {
  margin: 0;
}

.totals .grand {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: var(--text-md);
  font-weight: 650;
}

.totals .grand dt {
  color: var(--text);
}

.totals .soft {
  font-size: var(--text-xs);
}

.del {
  margin-right: auto;
  color: var(--danger);
}

@media (max-width: 1023px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }

  .side {
    position: static;
  }
}

@media (max-width: 639px) {
  .kinds {
    grid-template-columns: minmax(0, 1fr);
  }

  .ln {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
  }

  .ln.head {
    display: none;
  }

  .ln .desc-cell {
    grid-column: 1 / -1;
  }

  .ln .v {
    grid-column: 1 / 3;
  }

  .ln > :last-child {
    grid-column: 3;
    grid-row: 2;
  }

  .tx {
    grid-template-columns: minmax(0, 1fr) 92px 32px;
  }
}
</style>
