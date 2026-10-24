<script setup lang="ts">
/** Registro y edición de gastos: facturas recibidas, tickets, cuotas… con desglose de IVA */
const props = defineProps<{
  expenseId?: number | null
  prefillSupplierId?: number | null
  /** Lectura con IA de un escaneo (rellena el formulario y adjunta el original al guardar) */
  prefill?: ScanReading | null
}>()
const emit = defineEmits<{ saved: [id: number], deleted: [] }>()
const open = defineModel<boolean>({ default: false })

interface TaxLineForm {
  base: number | null
  vatRate: number
  vatAmount: number | null
  /** La cuota se escribió a mano (la de la factura manda sobre el cálculo) */
  manual: boolean
}

interface ExpenseForm {
  kind: string
  supplierId: number | null
  number: string | null
  issueDate: string
  dueDate: string | null
  categoryId: number | null
  description: string | null
  taxLines: TaxLineForm[]
  irpfRate: number
  deductiblePct: number
  vatDeductiblePct: number
  reverseCharge: boolean
  isInvestment: boolean
  paymentMethod: string | null
  paid: boolean
  notes: string | null
}

interface Supplier { id: number, name: string, nif: string | null, city: string | null, defaultCategoryId: number | null, irpfRate: number | null, kind: 'company' | 'person', logoUrl: string | null }
interface Category { id: number, kind: string, name: string, accountCode: string | null, icon: string | null, color: string | null, deductiblePct: number }

const toast = useToast()
const { confirm } = useConfirm()
const formId = useId()

const newLine = (vatRate = 21): TaxLineForm => ({ base: null, vatRate, vatAmount: null, manual: false })
const blank = (): ExpenseForm => ({
  kind: 'invoice',
  supplierId: props.prefillSupplierId ?? null,
  number: null,
  issueDate: todayISO(),
  dueDate: null,
  categoryId: null,
  description: null,
  taxLines: [newLine()],
  irpfRate: 0,
  deductiblePct: 100,
  vatDeductiblePct: 100,
  reverseCharge: false,
  isInvestment: false,
  paymentMethod: 'transfer',
  paid: false,
  notes: null,
})

const form = ref<ExpenseForm>(blank())
const errors = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const advanced = ref(false)
const showGrossHelper = ref(false)
const suppliers = ref<Supplier[]>([])
const categories = ref<Category[]>([])
/** Escaneo con IA en curso de guardar y documento original de un gasto ya guardado */
const scan = ref<{ fileId: number, fileName: string, mime: string, confidence: number | null, warnings: string[], newSupplier: ImportParty | null } | null>(null)
const original = ref<{ id: number, name: string, mime: string, confidence: number | null } | null>(null)
/** Proveedor cuya deducibilidad de la última vez se ha propuesto */
const learned = ref<string | null>(null)
/** Mientras se cargan datos, los automatismos (categoría → deducible…) no actúan */
let hydrating = false

const isEdit = computed(() => !!props.expenseId)

async function loadLists() {
  const [s, c] = await Promise.all([
    $fetch<Supplier[]>('/api/contacts', { query: { role: 'supplier', limit: 500 } }).catch(() => []),
    categories.value.length ? Promise.resolve(categories.value) : $fetch<Category[]>('/api/categories').catch(() => []),
  ])
  suppliers.value = s
  categories.value = c
}

watch([open, () => props.expenseId], async ([v]) => {
  if (!v) return
  errors.value = {}
  advanced.value = false
  showGrossHelper.value = false
  hydrating = true
  loading.value = true
  try {
    const listsReady = loadLists()
    if (props.expenseId) {
      const e = await $fetch<Omit<ExpenseForm, 'taxLines' | 'paid'> & { status: string, aiConfidence: number | null, taxLines: Array<{ base: number, vatRate: number, vatAmount: number }>, file: { id: number, name: string, mime: string } | null }>(`/api/expenses/${props.expenseId}`)
      scan.value = null
      learned.value = null
      original.value = e.file ? { ...e.file, confidence: e.aiConfidence } : null
      form.value = {
        kind: e.kind,
        supplierId: e.supplierId,
        number: e.number,
        issueDate: e.issueDate,
        dueDate: e.dueDate,
        categoryId: e.categoryId,
        description: e.description,
        taxLines: e.taxLines.length
          ? e.taxLines.map(l => ({ base: l.base, vatRate: l.vatRate, vatAmount: l.vatAmount, manual: Math.abs(l.vatAmount - pctOf(l.base, l.vatRate)) > 0.004 }))
          : [newLine()],
        irpfRate: e.irpfRate,
        deductiblePct: e.deductiblePct,
        vatDeductiblePct: e.vatDeductiblePct,
        reverseCharge: e.reverseCharge,
        isInvestment: e.isInvestment,
        paymentMethod: e.paymentMethod ?? 'transfer',
        paid: e.status === 'paid',
        notes: e.notes,
      }
      advanced.value = e.reverseCharge || e.isInvestment || !!e.notes
      await listsReady
    }
    else {
      form.value = blank()
      scan.value = null
      original.value = null
      learned.value = null
      await listsReady
      if (props.prefill?.data) applyScan(props.prefill)
      else if (form.value.supplierId) {
        applySupplier(form.value.supplierId)
        guessDeductible()
      }
    }
  }
  catch (err) {
    toast.error(errorMessage(err))
    open.value = false
  }
  finally {
    loading.value = false
    await nextTick()
    hydrating = false
  }
}, { immediate: true })

// ─── Automatismos ───

const supplierOptions = computed(() => suppliers.value.map(s => ({ value: s.id, label: s.name, sub: s.nif ?? s.city, image: s.logoUrl })))
const expenseCategories = computed(() => categories.value.filter(c => c.kind === 'expense').sort((a, b) => a.name.localeCompare(b.name, 'es')))
const categoryOptions = computed(() => [
  { value: null, label: 'Sin categoría' },
  ...expenseCategories.value.map(c => ({ value: c.id, label: c.accountCode ? `${c.name} · ${c.accountCode}` : c.name })),
])
const category = computed(() => categories.value.find(c => c.id === form.value.categoryId) ?? null)
const supplier = computed(() => suppliers.value.find(s => s.id === form.value.supplierId) ?? null)

function applySupplier(id: number | null) {
  const s = suppliers.value.find(x => x.id === id)
  if (!s) return
  if (s.defaultCategoryId && (!form.value.categoryId || !isEdit.value)) form.value.categoryId = s.defaultCategoryId
  if (s.irpfRate != null) form.value.irpfRate = s.irpfRate
}

watch(() => form.value.supplierId, (id) => {
  if (!hydrating) applySupplier(id)
})

watch(() => form.value.categoryId, () => {
  if (hydrating || !category.value) return
  form.value.isInvestment = category.value.accountCode === '217'
  if (form.value.isInvestment) advanced.value = true
})

// Deducibilidad propuesta: lo que marcaste la última vez con este proveedor o el % de la categoría
let guessSeq = 0
async function guessDeductible() {
  const seq = ++guessSeq
  const f = form.value
  const name = f.supplierId ? undefined : scan.value?.newSupplier?.name
  const g = await $fetch<{ deductiblePct: number, vatDeductiblePct: number, source: 'supplier' | 'category' | 'default' }>('/api/expenses/deductible', {
    query: { supplierId: f.supplierId ?? undefined, supplier: name, categoryId: f.categoryId ?? undefined },
  }).catch(() => null)
  if (!g || seq !== guessSeq) return
  f.deductiblePct = g.deductiblePct
  f.vatDeductiblePct = g.vatDeductiblePct
  learned.value = g.source === 'supplier' ? supplier.value?.name ?? name ?? null : null
}

watch(() => [form.value.supplierId, form.value.categoryId], () => {
  if (!hydrating) guessDeductible()
})

watch(() => form.value.kind, (k) => {
  if (hydrating) return
  // Cuotas de Seguridad Social, nóminas y tributos no llevan IVA
  if (k === 'social_security' || k === 'tax' || k === 'payroll') form.value.taxLines.forEach(l => setRate(l, 0))
  // Proponer automáticamente la categoría contable correspondiente si aún no tiene una
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

// ─── Escaneo con IA: rellena el formulario y guarda el documento original con el gasto ───

const reading = ref(false)
const scanInput = ref<HTMLInputElement>()

function applyScan(r: ScanReading) {
  const d = r.data
  if (!d) return
  hydrating = true
  const f = form.value
  f.kind = d.docType === 'ticket' || d.docType === 'simplified' ? 'ticket' : 'invoice'
  f.supplierId = r.contact?.id ?? null
  f.number = d.number
  f.issueDate = d.issueDate ?? f.issueDate
  f.dueDate = d.dueDate
  f.description = d.description
  f.taxLines = d.taxLines.map(t => ({ base: t.base, vatRate: t.vatRate, vatAmount: t.vatAmount, manual: Math.abs(t.vatAmount - pctOf(t.base, t.vatRate)) > 0.004 }))
  f.irpfRate = d.irpfRate
  f.paid = d.paid ?? false
  if (d.paymentMethod) f.paymentMethod = d.paymentMethod
  if (d.bodyText) {
    f.notes = d.bodyText.slice(0, 5000)
    advanced.value = true
  }
  scan.value = { fileId: r.fileId, fileName: r.fileName, mime: r.mime, confidence: r.confidence, warnings: r.warnings, newSupplier: r.contact ? null : d.party }
  nextTick(() => {
    hydrating = false
    // La categoría leída (o la del proveedor) arrastra su % deducible
    form.value.categoryId = d.categoryId ?? supplier.value?.defaultCategoryId ?? null
  })
}

async function readFile(file: File) {
  reading.value = true
  try {
    const body = new FormData()
    body.append('file', file, file.name)
    body.append('lastModified', String(file.lastModified))
    body.append('direction', 'received')
    const r = await $fetch<ScanReading>('/api/ai/read', { method: 'POST', body })
    if (!r.data) {
      toast.info('No parece una factura', 'Guárdalo en el archivo trimestral desde Documentos')
      return
    }
    applyScan(r)
    if (r.direction === 'issued') toast.info('Parece una factura emitida por ti', 'Revisa que sea un gasto antes de guardarlo')
    if (r.duplicate) toast.info(r.duplicate.label)
  }
  catch (err) {
    toast.error('No se pudo leer', errorMessage(err))
  }
  finally {
    reading.value = false
  }
}

function onScanPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) readFile(file)
}

// Proveedor nuevo desde el buscador
const creatingSupplier = ref(false)
const newSupplierName = ref('')
function onCreateSupplier(q: string) {
  newSupplierName.value = q
  creatingSupplier.value = true
}
async function onSupplierCreated(id: number) {
  suppliers.value = await $fetch<Supplier[]>('/api/contacts', { query: { role: 'supplier', limit: 500 } }).catch(() => suppliers.value)
  form.value.supplierId = id
}

// ─── Líneas de IVA ───

const autoVat = (l: TaxLineForm) => pctOf(l.base ?? 0, l.vatRate)

function setBase(l: TaxLineForm, v: unknown) {
  l.base = v == null || v === '' ? null : Number(v)
  if (!l.manual) l.vatAmount = l.base == null ? null : autoVat(l)
}

function setRate(l: TaxLineForm, v: unknown) {
  l.vatRate = Number(v)
  l.manual = false
  l.vatAmount = l.base == null ? null : autoVat(l)
}

function setVat(l: TaxLineForm, v: unknown) {
  l.vatAmount = v == null || v === '' ? null : Number(v)
  l.manual = l.vatAmount != null && Math.abs(l.vatAmount - autoVat(l)) > 0.004
}

function resetVat(l: TaxLineForm) {
  l.manual = false
  l.vatAmount = l.base == null ? null : autoVat(l)
}

function addLine() {
  const used = new Set(form.value.taxLines.map(l => l.vatRate))
  form.value.taxLines.push(newLine(VAT_RATES.find(r => !used.has(r)) ?? 21))
}

function removeLine(i: number) {
  form.value.taxLines.splice(i, 1)
  if (!form.value.taxLines.length) form.value.taxLines.push(newLine())
}

// Solo con el total (tickets): se desglosa base, IVA y retención cuadrando al céntimo
// (showGrossHelper se declara arriba: el watch inmediato de apertura ya lo usa)
const gross = ref<number | null>(null)

function applyGross() {
  if (gross.value == null) return
  const l = form.value.taxLines[0]!
  form.value.taxLines = [l]
  const base = round2(gross.value / (1 + (l.vatRate - form.value.irpfRate) / 100))
  const irpf = pctOf(base, form.value.irpfRate)
  l.base = base
  l.vatAmount = round2(gross.value - base + irpf)
  l.manual = Math.abs(l.vatAmount - autoVat(l)) > 0.004
  gross.value = null
  showGrossHelper.value = false
}

// ─── Totales (mismo criterio que el servidor: expenseTotals) ───

const totals = computed(() => {
  const lines = form.value.taxLines.filter(l => l.base != null)
  const taxBase = round2(lines.reduce((s, l) => s + round2(l.base!), 0))
  const vatTotal = round2(lines.reduce((s, l) => s + (l.vatAmount != null ? round2(l.vatAmount) : autoVat(l)), 0))
  const irpfTotal = pctOf(taxBase, form.value.irpfRate)
  const vatDeductible = pctOf(vatTotal, form.value.vatDeductiblePct)
  return { taxBase, vatTotal, irpfTotal, vatDeductible, total: round2(taxBase + vatTotal - irpfTotal) }
})

// ─── Opciones ───

const kindOptions = Object.entries(EXPENSE_KIND).map(([value, label]) => ({ value, label }))
const vatOptions = VAT_RATES.map(r => ({ value: r, label: `${r} %` }))
const methodOptions = Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))

/** Sin IVA (Seguridad Social, seguros…) basta un % */
const hasVat = computed(() => form.value.taxLines.some(l => l.vatRate > 0))

const rentTip = computed(() => category.value?.accountCode === '621' && form.value.irpfRate === 0)
const proTip = computed(() => category.value?.accountCode === '623' && form.value.irpfRate === 0 && supplier.value?.kind === 'person')
const payrollTip = computed(() => form.value.kind === 'payroll' && form.value.irpfRate === 0)

// ─── Guardar / eliminar ───

async function save() {
  errors.value = {}
  const lines = form.value.taxLines.filter(l => l.base != null)
  if (!form.value.issueDate) errors.value.issueDate = 'Indica la fecha'
  if (!lines.length) errors.value.taxLines = 'Indica la base imponible'
  if (Object.keys(errors.value).length) return

  saving.value = true
  try {
    const f = form.value
    const body = {
      kind: f.kind,
      supplierId: f.supplierId,
      number: f.number,
      issueDate: f.issueDate,
      dueDate: f.dueDate || null,
      categoryId: f.categoryId,
      description: f.description,
      taxLines: lines.map(l => ({ base: l.base!, vatRate: l.vatRate, vatAmount: l.vatAmount ?? autoVat(l), surchargeRate: 0 })),
      irpfRate: f.irpfRate,
      deductiblePct: f.deductiblePct,
      vatDeductiblePct: f.vatDeductiblePct,
      reverseCharge: f.reverseCharge,
      isInvestment: f.isInvestment,
      paymentMethod: f.paymentMethod,
      paid: f.paid,
      notes: f.notes,
      ...(scan.value && !props.expenseId
        ? { fileId: scan.value.fileId, aiConfidence: scan.value.confidence, newSupplier: f.supplierId ? null : scan.value.newSupplier }
        : {}),
    }
    let id = props.expenseId ?? 0
    if (props.expenseId) await $fetch(`/api/expenses/${props.expenseId}`, { method: 'PATCH', body })
    else id = (await $fetch<{ id: number }>('/api/expenses', { method: 'POST', body })).id
    const who = supplier.value?.name ?? scan.value?.newSupplier?.name
    toast.success(isEdit.value ? 'Gasto actualizado' : 'Gasto registrado', `${eur(totals.value.total)}${who ? ` · ${who}` : ''}`)
    emit('saved', id)
    open.value = false
  }
  catch (err) {
    const field = errorField(err)
    if (field) errors.value[field.startsWith('taxLines') ? 'taxLines' : field] = errorMessage(err)
    else toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.expenseId) return
  const ok = await confirm({
    title: '¿Eliminar este gasto definitivamente?',
    body: 'Se borrará de forma permanente de la base de datos junto con sus pagos. Si está conciliado con el banco, el movimiento bancario quedará de nuevo pendiente de conciliar.',
    confirmLabel: 'Eliminar definitivamente',
    danger: true,
  })
  if (!ok) return
  deleting.value = true
  try {
    await $fetch(`/api/expenses/${props.expenseId}`, { method: 'DELETE' })
    toast.success('Gasto eliminado')
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
</script>

<template>
  <UiModal v-model="open" :title="isEdit ? 'Editar gasto' : 'Nuevo gasto'" :subtitle="isEdit ? undefined : 'Factura recibida, ticket o cuota.'" size="lg">
    <div v-if="loading" class="loading">
      <div class="skeleton" style="height: 38px" />
      <div class="sk-grid">
        <div v-for="i in 3" :key="i" class="skeleton" style="height: 38px" />
      </div>
      <div class="skeleton" style="height: 120px" />
    </div>

    <form v-else :id="formId" class="expense-form" novalidate @submit.prevent="save">
      <!-- ─── BANNER IA / ESCANEO DE DOCUMENTO ─── -->
      <div
        v-if="!isEdit && !scan"
        class="ai-fill"
        :class="{ busy: reading }"
        @dragover.prevent
        @drop.prevent="$event.dataTransfer?.files[0] && readFile($event.dataTransfer.files[0])"
      >
        <span class="af-ic" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
        <div class="af-content">
          <p class="af-t">{{ reading ? 'Analizando el documento con IA…' : '¿Tienes la factura o el ticket en archivo?' }}</p>
          <p class="af-s">{{ reading ? 'Extrayendo proveedor, fecha, bases imponibles, IVA y retenciones…' : 'Arrastra aquí tu PDF o imagen, o hazle una foto para rellenar los datos automáticamente.' }}</p>
        </div>
        <UiButton variant="ai" size="sm" icon="ph:scan" :loading="reading" @click="scanInput?.click()">
          Escanear factura
        </UiButton>
        <input ref="scanInput" type="file" class="sr-only" accept="image/*,.pdf,.doc,.docx,.odt,.txt,.xml" tabindex="-1" aria-hidden="true" @change="onScanPick">
      </div>

      <div v-else-if="scan || original" class="ai-read">
        <div class="ar-head">
          <div class="ar-badge-group">
            <UiBadge v-if="scan || original?.confidence != null" tone="ai" icon="ph:sparkle-fill" size="sm">
              Leído con IA{{ (scan?.confidence ?? original?.confidence) != null ? ` · ${scan?.confidence ?? original?.confidence} %` : '' }}
            </UiBadge>
            <a :href="`/api/files/${scan?.fileId ?? original?.id}`" target="_blank" rel="noopener" class="link ar-link">
              <Icon :name="fileIcon(scan?.fileName ?? original?.name ?? '', scan?.mime ?? original?.mime)" aria-hidden="true" />
              <span class="truncate">{{ scan?.fileName ?? original?.name ?? (scan ? 'Ver documento escaneado' : 'Documento original') }}</span>
            </a>
          </div>
        </div>
        <ul v-if="scan?.warnings.length" class="ar-warn">
          <li v-for="(w, i) in scan.warnings" :key="i">
            <Icon name="ph:warning-fill" aria-hidden="true" /> {{ w }}
          </li>
        </ul>
      </div>

      <!-- ─── SECCIÓN 1: DATOS DEL GASTO ─── -->
      <section class="form-card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-icon"><Icon name="ph:receipt" /></span>
            <div>
              <h3 class="card-title">Datos del gasto</h3>
              <p class="card-subtitle">Proveedor, tipo de documento y fechas</p>
            </div>
          </div>
        </div>

        <div class="card-grid">
          <div class="c-8">
            <UiCombobox
              v-model="form.supplierId"
              :label="form.kind === 'payroll' ? 'Perceptor / Empleado' : 'Proveedor'"
              :options="supplierOptions"
              :placeholder="form.kind === 'payroll' ? 'Busca o crea el perceptor (socio o empleado)' : 'Busca o crea un proveedor'"
              :create-label="form.kind === 'payroll' ? 'Nuevo perceptor' : 'Nuevo proveedor'"
              avatars
              :error="errors.supplierId"
              @create="onCreateSupplier"
            />
            <p v-if="scan?.newSupplier && !form.supplierId" class="new-sup">
              <Icon name="ph:user-plus" aria-hidden="true" />
              <span class="truncate">Nuevo proveedor detectado: <b>{{ scan.newSupplier.name }}</b>{{ scan.newSupplier.nif ? ` · ${scan.newSupplier.nif}` : '' }} (se creará al guardar)</span>
            </p>
          </div>

          <div class="c-4">
            <UiSelect v-model="form.kind" label="Tipo de gasto" :options="kindOptions" />
          </div>

          <div class="c-4">
            <UiInput
              v-model="form.number"
              :label="form.kind === 'payroll' ? 'Nº de nómina / Ref.' : 'Nº de factura'"
              :placeholder="form.kind === 'payroll' ? 'Ej. Nómina 10/2026' : 'Número del emisor'"
              :error="errors.number"
              autocomplete="off"
            />
          </div>

          <div class="c-4">
            <UiInput
              v-model="form.issueDate"
              :label="form.kind === 'payroll' ? 'Fecha devengo / pago' : 'Fecha de emisión'"
              type="date"
              :error="errors.issueDate"
              required
            />
          </div>

          <div class="c-4">
            <UiInput
              v-model="form.dueDate"
              label="Fecha de vencimiento"
              type="date"
              :error="errors.dueDate"
            />
          </div>

          <div class="c-6">
            <UiSelect
              v-model="form.categoryId"
              label="Categoría contable"
              :options="categoryOptions"
              :hint="category && category.deductiblePct !== 100 ? `Deducible al ${pct(category.deductiblePct)} por defecto` : undefined"
            />
          </div>

          <div class="c-6">
            <UiInput
              v-model="form.description"
              label="Concepto"
              :placeholder="form.kind === 'payroll' ? 'Ej. Nómina socio administrador octubre' : 'Ej. Fibra óptica y móvil del mes'"
              :error="errors.description"
              autocomplete="off"
            />
          </div>
        </div>
      </section>

      <!-- ─── SECCIÓN 2: IMPORTES E IMPUESTOS ─── -->
      <section class="form-card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-icon"><Icon name="ph:currency-eur" /></span>
            <div>
              <h3 class="card-title">Importes e impuestos</h3>
              <p class="card-subtitle">Bases imponibles, tipos de IVA y retenciones</p>
            </div>
          </div>

          <button
            type="button"
            class="quick-tool-btn"
            :class="{ active: showGrossHelper }"
            :title="showGrossHelper ? 'Cerrar asistente' : 'Desglosar base e IVA desde el importe total'"
            @click="showGrossHelper = !showGrossHelper"
          >
            <Icon name="ph:magic-wand" />
            <span>{{ form.kind === 'payroll' ? 'Calcular desde neto' : 'Desglosar desde total' }}</span>
          </button>
        </div>

        <!-- Asistente rápido para desglosar total con IVA -->
        <Transition name="fade">
          <div v-if="showGrossHelper" class="gross-helper-card">
            <div class="gross-helper-info">
              <span class="gh-ic"><Icon name="ph:magic-wand-fill" /></span>
              <div>
                <p class="gh-t">Desglose automático desde el total</p>
                <p class="gh-s">{{ form.kind === 'payroll' ? 'Introduce el neto a pagar y calculamos el bruto:' : 'Introduce el total pagado con IVA y calculamos la base y la cuota exacta:' }}</p>
              </div>
            </div>
            <div class="gross-helper-action">
              <UiInput
                v-model="gross"
                numeric
                suffix="€"
                :placeholder="form.kind === 'payroll' ? 'Ej. 2000' : 'Ej. 121,00'"
                :aria-label="form.kind === 'payroll' ? 'Importe neto' : 'Total con IVA'"
                @keydown.enter.prevent="applyGross"
              />
              <UiButton size="sm" variant="primary" :disabled="gross == null" icon="ph:check-bold" @click="applyGross">
                {{ form.kind === 'payroll' ? 'Calcular bruto' : 'Desglosar' }}
              </UiButton>
            </div>
          </div>
        </Transition>

        <!-- Tabla estructurada de líneas de IVA -->
        <div class="tax-table" role="table" aria-label="Desglose de IVA">
          <div class="tax-table-head" role="row">
            <span role="columnheader">Base imponible</span>
            <span role="columnheader">Tipo de IVA</span>
            <span role="columnheader">Cuota IVA</span>
            <span class="sr-only">Acciones</span>
          </div>

          <div v-for="(l, i) in form.taxLines" :key="i" class="tax-table-row" role="row">
            <UiInput
              :model-value="l.base"
              numeric
              suffix="€"
              placeholder="0,00"
              :aria-label="`Base imponible ${i + 1}`"
              :error="i === 0 ? errors.taxLines : undefined"
              @update:model-value="setBase(l, $event)"
            />
            <UiSelect
              :model-value="l.vatRate"
              :options="vatOptions"
              :aria-label="`Tipo de IVA ${i + 1}`"
              @update:model-value="setRate(l, $event)"
            />
            <UiInput
              :model-value="l.vatAmount"
              numeric
              suffix="€"
              placeholder="0,00"
              :aria-label="`Cuota de IVA ${i + 1}`"
              @update:model-value="setVat(l, $event)"
            >
              <template #end>
                <button
                  v-if="l.manual"
                  type="button"
                  class="reset-btn"
                  title="Cuota editada a mano. Clic para volver a calcular automáticamente con el porcentaje"
                  aria-label="Recalcular cuota automática"
                  @click="resetVat(l)"
                >
                  <Icon name="ph:arrow-counter-clockwise" />
                </button>
              </template>
            </UiInput>
            <div class="row-del">
              <UiButton
                variant="ghost"
                size="sm"
                square
                icon="ph:trash"
                :aria-label="`Quitar línea ${i + 1}`"
                :disabled="form.taxLines.length === 1 && l.base == null"
                @click="removeLine(i)"
              />
            </div>
          </div>

          <div v-if="form.taxLines.length < 4" class="tax-table-foot">
            <button type="button" class="add-tax-line-btn" @click="addLine">
              <Icon name="ph:plus-bold" aria-hidden="true" />
              <span>Añadir otro tipo de IVA</span>
            </button>
          </div>
        </div>

        <!-- Zona inferior de importes: IRPF y Totales -->
        <div class="amounts-bottom">
          <div class="irpf-col">
            <IrpfField
              v-model="form.irpfRate"
              :hint="form.kind === 'payroll' ? 'Nómina: el tipo exacto que figura en ella (p. ej. 12,43 %)' : 'Alquiler 19 %, profesionales 15 %'"
            />

            <!-- Sugerencias contextuales de IRPF -->
            <div v-if="payrollTip" class="tax-tip">
              <Icon name="ph:lightbulb-filament-fill" aria-hidden="true" />
              <div class="tax-tip-body">
                <span>Nómina societaria: suele retener el 19 % (o 15 % según tablas de IRPF).</span>
                <div class="tax-tip-actions">
                  <button type="button" class="tip-btn" @click="form.irpfRate = 19">Aplicar 19 %</button>
                  <button type="button" class="tip-btn" @click="form.irpfRate = 15">Aplicar 15 %</button>
                </div>
              </div>
            </div>

            <div v-else-if="rentTip" class="tax-tip">
              <Icon name="ph:lightbulb-filament-fill" aria-hidden="true" />
              <div class="tax-tip-body">
                <span>Los alquileres de locales suelen llevar retención del 19 % (modelo 115).</span>
                <button type="button" class="tip-btn" @click="form.irpfRate = 19">Aplicar 19 %</button>
              </div>
            </div>

            <div v-else-if="proTip" class="tax-tip">
              <Icon name="ph:lightbulb-filament-fill" aria-hidden="true" />
              <div class="tax-tip-body">
                <span>Un profesional autónomo te factura con retención del 15 % (modelo 111).</span>
                <button type="button" class="tip-btn" @click="form.irpfRate = 15">Aplicar 15 %</button>
              </div>
            </div>
          </div>

          <!-- Resumen de totales financiero -->
          <div class="totals-panel">
            <dl class="totals-list" aria-live="polite">
              <div class="totals-item">
                <dt>Base imponible</dt>
                <dd class="num">{{ eur(totals.taxBase) }}</dd>
              </div>
              <div class="totals-item">
                <dt>IVA soportado</dt>
                <dd class="num">+{{ eur(totals.vatTotal) }}</dd>
              </div>
              <div v-if="totals.irpfTotal" class="totals-item irpf-neg">
                <dt>Retención IRPF ({{ num(form.irpfRate) }} %)</dt>
                <dd class="num neg">−{{ eur(totals.irpfTotal) }}</dd>
              </div>
              <div class="totals-item grand-total">
                <dt>Total a pagar</dt>
                <dd class="num">{{ eur(totals.total) }}</dd>
              </div>
              <div v-if="hasVat && form.vatDeductiblePct !== 100" class="totals-deductible-info">
                <span>IVA deducible en tus modelos:</span>
                <strong class="num">{{ eur(totals.vatDeductible) }}</strong>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <!-- ─── SECCIÓN 3: FISCALIDAD Y DEDUCIBILIDAD ─── -->
      <section class="form-card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-icon"><Icon name="ph:scales" /></span>
            <div>
              <h3 class="card-title">Fiscalidad y Deducibilidad</h3>
              <p class="card-subtitle">Tratamiento tributario en modelos 303 (IVA) y 130/100 o Sociedades</p>
            </div>
          </div>
        </div>

        <ExpenseDeductible
          v-model:pct="form.deductiblePct"
          v-model:vat-pct="form.vatDeductiblePct"
          :has-vat="hasVat"
          :base="totals.taxBase"
          :vat="totals.vatTotal"
          :learned="learned"
        />

        <!-- Opciones fiscales avanzadas (inversión y sujeto pasivo) -->
        <div class="fiscal-adv">
          <button
            type="button"
            class="adv-toggle"
            :aria-expanded="advanced"
            @click="advanced = !advanced"
          >
            <Icon :name="advanced ? 'ph:caret-down-bold' : 'ph:caret-right-bold'" aria-hidden="true" />
            <span>Opciones fiscales adicionales</span>
            <span v-if="form.isInvestment || form.reverseCharge" class="adv-badge">Activas</span>
          </button>

          <Transition name="fade">
            <div v-if="advanced || form.isInvestment || form.reverseCharge" class="fiscal-grid">
              <div class="switch-cell">
                <UiSwitch v-model="form.isInvestment" label="Bien de inversión" hint="Se amortiza en varios años (ordenadores, maquinaria, vehículos, mobiliario…)" />
              </div>
              <div class="switch-cell">
                <UiSwitch v-model="form.reverseCharge" label="Inversión del sujeto pasivo" hint="Compras intracomunitarias o servicios contratados fuera de la UE" />
              </div>
            </div>
          </Transition>
        </div>
      </section>

      <!-- ─── SECCIÓN 4: ESTADO DE PAGO Y NOTAS ─── -->
      <section class="form-card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-icon"><Icon name="ph:credit-card" /></span>
            <div>
              <h3 class="card-title">Estado del pago</h3>
              <p class="card-subtitle">Control de tesorería y observaciones internas</p>
            </div>
          </div>
        </div>

        <div class="pay-wrap">
          <div class="pay-toggle-row">
            <div class="pay-switch-box">
              <UiSwitch
                v-model="form.paid"
                label="Gasto ya pagado"
                :hint="form.paid ? 'Se anota el pago automáticamente por el importe total del gasto' : 'Quedará registrado como pendiente de pago en tesorería'"
              />
            </div>
            <div v-if="form.paid" class="pay-method-field">
              <UiSelect v-model="form.paymentMethod" label="Forma de pago" :options="methodOptions" />
            </div>
          </div>

          <div class="notes-field">
            <UiTextarea
              v-model="form.notes"
              label="Notas internas"
              rows="2"
              placeholder="Para qué fue, a qué proyecto corresponde, justificación o cualquier apunte…"
            />
          </div>
        </div>
      </section>
    </form>

    <template #footer>
      <UiButton v-if="isEdit" class="del" variant="ghost" icon="ph:trash" :loading="deleting" @click="remove">Eliminar</UiButton>
      <UiButton v-if="isEdit" variant="ghost" icon="ph:arrows-clockwise" :to="`/recurrentes?gasto=${expenseId}`" @click="open = false">Hacer recurrente</UiButton>
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" :form="formId" variant="primary" :loading="saving" :disabled="loading" icon="ph:check-bold">
        {{ isEdit ? 'Guardar cambios' : 'Registrar gasto' }}
      </UiButton>
    </template>
  </UiModal>

  <ContactModal v-model="creatingSupplier" role="supplier" :prefill-name="newSupplierName" @saved="onSupplierCreated" />
</template>

<style scoped>
.expense-form {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

/* ─── AI Banner ─── */
.ai-fill {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 14px 16px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ai-soft) 80%, white), var(--surface));
  border: 1px dashed color-mix(in srgb, var(--ai-2) 45%, var(--border));
  border-radius: var(--r-xl);
  transition: all var(--t-base);
}

.ai-fill:hover {
  border-color: var(--ai-2);
  background: linear-gradient(135deg, var(--ai-soft), var(--surface));
}

.ai-fill.busy {
  border-style: solid;
  border-color: var(--ai-2);
}

.af-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  font-size: 18px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-md);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ai-2) 35%, transparent);
}

.busy .af-ic {
  animation: af-pulse 1.4s var(--ease-out) infinite;
}

@keyframes af-pulse {
  50% {
    transform: scale(1.08);
  }
}

.af-content {
  flex: 1;
  min-width: 0;
}

.af-t {
  font-weight: 650;
  font-size: var(--text-sm);
  color: var(--text);
}

.af-s {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
  line-height: 1.35;
}

.ai-read {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-xl);
}

.ar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--s-2);
}

.ar-badge-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.ar-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 540;
  color: var(--brand-text);
  min-width: 0;
}

.ar-warn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-xs);
  color: var(--warning);
}

.ar-warn li {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

/* ─── Cards del formulario ─── */
.form-card {
  padding: var(--s-5);
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-xl);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}

.form-card:hover {
  border-color: color-mix(in srgb, var(--border) 70%, transparent);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  margin-bottom: var(--s-4);
  padding-bottom: var(--s-3);
  border-bottom: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}

.card-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  font-size: 17px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-md);
  flex-shrink: 0;
}

.card-title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 650;
  color: var(--text);
  line-height: 1.25;
}

.card-subtitle {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* ─── Grid ─── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--s-4);
}

.c-12 { grid-column: span 12; }
.c-8 { grid-column: span 8; }
.c-6 { grid-column: span 6; }
.c-4 { grid-column: span 4; }

.new-sup {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: var(--text-xs);
  color: var(--brand-text);
}

/* ─── Botón asistente de desglose ─── */
.quick-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: all var(--t-fast);
}

.quick-tool-btn:hover {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: var(--brand-subtle);
}

.quick-tool-btn.active {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: var(--brand-text);
}

/* ─── Tarjeta asistente gross ─── */
.gross-helper-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  margin-bottom: var(--s-4);
  padding: 12px 16px;
  background: linear-gradient(135deg, var(--brand-soft), color-mix(in srgb, var(--surface) 60%, var(--brand-soft)));
  border: 1px solid color-mix(in srgb, var(--brand) 25%, var(--border));
  border-radius: var(--r-lg);
  flex-wrap: wrap;
}

.gross-helper-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gh-ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  font-size: 15px;
  color: #fff;
  background: var(--brand);
  border-radius: var(--r-sm);
  flex-shrink: 0;
}

.gh-t {
  margin: 0;
  font-weight: 600;
  font-size: var(--text-xs);
  color: var(--brand-text);
}

.gh-s {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  color: var(--text-2);
}

.gross-helper-action {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gross-helper-action :deep(.field) {
  width: 140px;
  background: var(--surface);
}

/* ─── Tabla de desglose de IVA ─── */
.tax-table {
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--surface);
}

.tax-table-head {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.3fr) 36px;
  gap: var(--s-3);
  padding: 9px 14px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.tax-table-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.3fr) 36px;
  gap: var(--s-3);
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.tax-table-row:last-child {
  border-bottom: 0;
}

.row-del {
  display: flex;
  justify-content: center;
}

.tax-table-foot {
  padding: 10px 14px;
  background: var(--surface-2);
  border-top: 1px solid var(--border-subtle);
}

.add-tax-line-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--brand-text);
  background: transparent;
  border: 0;
  border-radius: var(--r-xs);
  cursor: pointer;
  transition: background var(--t-fast);
}

.add-tax-line-btn:hover {
  background: var(--brand-soft);
}

.reset-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--warning);
  background: none;
  border: 0;
  border-radius: var(--r-xs);
  cursor: pointer;
  transition: background var(--t-fast);
}

.reset-btn:hover {
  background: var(--warning-soft);
}

/* ─── Zona inferior de importes (IRPF y Totales) ─── */
.amounts-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: var(--s-5);
  margin-top: var(--s-5);
  align-items: start;
}

.irpf-col {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.tax-tip {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 13px;
  font-size: var(--text-xs);
  color: var(--text-2);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning-solid) 20%, transparent);
  border-radius: var(--r-md);
  line-height: 1.4;
}

.tax-tip :deep(svg) {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 15px;
  color: var(--warning-solid);
}

.tax-tip-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.tax-tip-actions {
  display: flex;
  gap: 8px;
}

.tip-btn {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--brand-text);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.tip-btn:hover {
  color: var(--brand-hover);
}

/* ─── Resumen Financiero Totales ─── */
.totals-panel {
  padding: 16px 18px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.totals-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}

.totals-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.totals-item dt {
  color: var(--text-3);
}

.totals-item dd {
  margin: 0;
  font-weight: 560;
  color: var(--text);
}

.totals-item.irpf-neg dd {
  color: var(--danger);
}

.totals-item.grand-total {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.totals-item.grand-total dt {
  font-size: var(--text-base);
  font-weight: 650;
  color: var(--text);
}

.totals-item.grand-total dd {
  font-size: var(--text-2xl);
  font-weight: 750;
  color: var(--text);
  letter-spacing: -0.02em;
}

.totals-deductible-info {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-subtle);
  font-size: var(--text-xs);
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.totals-deductible-info strong {
  color: var(--success);
}

/* ─── Fiscalidad avanzada ─── */
.fiscal-adv {
  margin-top: var(--s-4);
  padding-top: var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.adv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
  background: none;
  border: 0;
  padding: 4px 0;
  cursor: pointer;
  transition: color var(--t-fast);
}

.adv-toggle:hover {
  color: var(--text);
}

.adv-badge {
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.fiscal-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-3);
  margin-top: var(--s-3);
}

.switch-cell {
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast);
}

.switch-cell:hover {
  border-color: var(--border);
}

/* ─── Pago y notas ─── */
.pay-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.pay-toggle-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-4);
  align-items: start;
}

.pay-switch-box {
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.del {
  margin-right: auto;
  color: var(--danger);
}

.loading {
  display: grid;
  gap: var(--s-4);
}

.sk-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--s-4);
}

/* ─── Responsive ─── */
@media (max-width: 768px) {
  .form-card {
    padding: var(--s-4);
  }

  .card-grid {
    grid-template-columns: 1fr;
  }

  .c-8, .c-6, .c-4 {
    grid-column: span 1;
  }

  .amounts-bottom {
    grid-template-columns: 1fr;
    gap: var(--s-4);
  }

  .tax-table-head,
  .tax-table-row {
    grid-template-columns: minmax(0, 1fr) 80px minmax(0, 1fr) 32px;
    gap: var(--s-2);
    padding: 8px 10px;
  }

  .fiscal-grid {
    grid-template-columns: 1fr;
  }

  .pay-toggle-row {
    grid-template-columns: 1fr;
  }

  .gross-helper-card {
    flex-direction: column;
    align-items: stretch;
  }

  .gross-helper-action {
    width: 100%;
  }

  .gross-helper-action :deep(.field) {
    flex: 1;
    width: auto;
  }
}
</style>
