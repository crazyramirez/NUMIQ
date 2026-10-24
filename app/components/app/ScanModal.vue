<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import type { DroppedFile } from '~/components/docs/Dropzone.vue'
import type { ImportInvoiceData, ScanReading } from '#shared/types/import'

/**
 * Escaneo rápido: foto, PDF o captura pegada → la IA lo lee → se guarda como gasto, factura emitida
 * importada o documento del archivo trimestral, con el original adjunto.
 */
const { state, close } = useScan()
const toast = useToast()
const router = useRouter()
const guardDuplicate = useDuplicateGuard()

const open = computed({ get: () => state.value.open, set: (v: boolean) => { if (!v) close() } })

type Step = 'pick' | 'reading' | 'result'
const step = ref<Step>('pick')
const file = ref<File | null>(null)
const result = ref<ScanReading | null>(null)
const invoice = ref<ImportInvoiceData | null>(null)
const direction = ref<'issued' | 'received'>('received')
const contactId = ref<number | null>(null)
const editing = ref(false)
const saving = ref(false)
const expenseOpen = ref(false)
const pick = ref<'auto' | 'issued' | 'received'>('auto')
// Sin teclado ni ratón (móvil) no se habla de arrastrar ni de Ctrl+V
const touch = useMediaQuery('(hover: none)')

interface Category { id: number, kind: string, name: string, deductiblePct: number, accountCode: string | null }
const categories = ref<Category[]>([])

watch(open, (v) => {
  if (!v) return
  step.value = 'pick'
  file.value = null
  result.value = null
  editing.value = false
  pick.value = state.value.direction
  if (!categories.value.length) $fetch<Category[]>('/api/categories').then(c => (categories.value = c)).catch(() => {})
})

// ─── Lectura ───

const MESSAGES = ['Leyendo el documento', 'Identificando emisor y receptor', 'Leyendo bases, IVA y retenciones', 'Comprobando que todo cuadre']
const message = ref(0)
let ticker: ReturnType<typeof setInterval> | undefined

async function read(f: File) {
  file.value = f
  step.value = 'reading'
  message.value = 0
  ticker = setInterval(() => (message.value = (message.value + 1) % MESSAGES.length), 1700)
  try {
    const body = new FormData()
    body.append('file', f, f.name || 'captura.png')
    body.append('lastModified', String(f.lastModified))
    body.append('direction', pick.value)
    const r = await $fetch<ScanReading>('/api/ai/read', { method: 'POST', body })
    result.value = r
    invoice.value = r.data ? JSON.parse(JSON.stringify(r.data)) : null
    direction.value = r.direction
    contactId.value = r.contact?.id ?? null
    vFolder.value = r.vault?.folder ?? 'otros'
    vYear.value = r.vault?.year ?? new Date().getFullYear()
    vQuarter.value = r.vault?.quarter ?? quarterOf(new Date())
    vNote.value = r.vault?.summary ?? ''
    dedPct.value = 100
    dedVat.value = 100
    dedLearned.value = null
    step.value = 'result'
    guessDeductible()
  }
  catch (err) {
    toast.error('No se pudo leer', errorMessage(err))
    step.value = 'pick'
  }
  finally {
    clearInterval(ticker)
  }
}

function onFiles(files: DroppedFile[]) {
  if (files[0]) read(files[0].file)
}

// Pegar una captura (Ctrl+V) mientras está abierto
function onPaste(e: ClipboardEvent) {
  if (!open.value || step.value !== 'pick') return
  const f = [...(e.clipboardData?.files ?? [])][0]
  if (f) {
    e.preventDefault()
    read(f)
  }
}
onMounted(() => window.addEventListener('paste', onPaste))
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  clearInterval(ticker)
})

// ─── Resultado ───

const d = computed(() => invoice.value)
const isInvoice = computed(() => !!invoice.value)
const isQuote = computed(() => d.value?.docType === 'quote' || d.value?.docType === 'proforma')
const salesLabel = computed(() => d.value?.docType === 'quote' ? 'presupuesto' : d.value?.docType === 'proforma' ? 'proforma' : 'factura emitida')
const category = computed(() => categories.value.find(c => c.id === invoice.value?.categoryId) ?? null)
const partyName = computed(() => result.value?.contact && contactId.value === result.value.contact.id ? result.value.contact.name : d.value?.party?.name ?? 'Sin identificar')
const isNewContact = computed(() => !contactId.value && !!d.value?.party)
const balanced = computed(() => {
  if (!d.value) return true
  const sum = round2(d.value.taxLines.reduce((s, t) => s + t.base + t.vatAmount + t.surchargeAmount, 0) - d.value.irpfAmount)
  return Math.abs(sum - d.value.total) <= 0.05
})
const dirOptions = computed(() => isQuote.value
  ? [{ value: 'issued', label: d.value?.docType === 'quote' ? 'Presupuesto' : 'Proforma' }]
  : [{ value: 'received', label: 'Gasto' }, { value: 'issued', label: 'Factura emitida' }])
const dirModel = computed({
  get: () => direction.value as string,
  set: (v: string) => {
    direction.value = v as 'issued' | 'received'
    contactId.value = null
  },
})

// ─── ¿Deducible? Lo que marcaste la última vez con este proveedor o el % de la categoría ───

const dedPct = ref(100)
const dedVat = ref(100)
const dedLearned = ref<string | null>(null)
const dedBase = computed(() => round2(d.value?.taxLines.reduce((s, t) => s + t.base, 0) ?? 0))
const dedVatAmount = computed(() => round2(d.value?.taxLines.reduce((s, t) => s + t.vatAmount, 0) ?? 0))
let dedSeq = 0

async function guessDeductible() {
  const inv = invoice.value
  if (direction.value !== 'received' || !inv) return
  const n = ++dedSeq
  const g = await $fetch<{ deductiblePct: number, vatDeductiblePct: number, source: 'supplier' | 'category' | 'default' }>('/api/expenses/deductible', {
    query: { supplierId: contactId.value ?? undefined, supplier: contactId.value ? undefined : inv.party?.name, categoryId: inv.categoryId ?? undefined },
  }).catch(() => null)
  if (!g || n !== dedSeq) return
  dedPct.value = g.deductiblePct
  dedVat.value = g.vatDeductiblePct
  dedLearned.value = g.source === 'supplier' ? partyName.value : null
}

watch([contactId, direction, () => invoice.value?.categoryId], () => {
  if (step.value === 'result') guessDeductible()
})

function again() {
  step.value = 'pick'
  file.value = null
  result.value = null
  editing.value = false
}

function done(title: string, body: string, to: string) {
  toast.push({ tone: 'success', title, body, action: { label: 'Ver', run: () => router.push(to) } })
  close()
  refreshNuxtData()
}

async function saveExpense() {
  const r = result.value!
  const inv = invoice.value!
  const cat = category.value
  saving.value = true
  try {
    // Nunca dos veces el mismo gasto: lo seguro se avisa y lo probable se pregunta
    const saved = await guardDuplicate(allowDuplicate => $fetch<{ id: number }>('/api/expenses', {
      method: 'POST',
      body: {
        allowDuplicate,
        kind: inv.docType === 'ticket' || inv.docType === 'simplified' ? 'ticket' : 'invoice',
        supplierId: contactId.value,
        newSupplier: contactId.value ? null : inv.party,
        number: inv.number,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        categoryId: inv.categoryId,
        description: inv.description,
        notes: inv.bodyText?.slice(0, 5000) || null,
        taxLines: inv.taxLines.map(t => ({ base: t.base, vatRate: t.vatRate, vatAmount: t.vatAmount, surchargeRate: t.surchargeRate })),
        irpfRate: inv.irpfRate,
        deductiblePct: dedPct.value,
        vatDeductiblePct: dedVat.value,
        isInvestment: cat?.accountCode === '217',
        paymentMethod: inv.paymentMethod,
        paid: inv.paid ?? false,
        fileId: r.fileId,
        aiConfidence: r.confidence,
      },
    }))
    if (saved) done('Gasto registrado', `${eur(inv.total)} · ${partyName.value}`, `/gastos?ver=${saved.id}`)
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

async function saveSales() {
  saving.value = true
  try {
    const saved = await guardDuplicate(allowDuplicate => $fetch<{ id: number }>('/api/sales/import', { method: 'POST', body: { data: invoice.value, contactId: contactId.value, fileId: result.value!.fileId, allowDuplicate } }))
    if (saved) done(isQuote.value ? 'Presupuesto registrado' : 'Factura emitida registrada', `${invoice.value!.number ?? ''} · ${eur(invoice.value!.total)}`, `/${isQuote.value ? 'presupuestos' : 'facturas'}/${saved.id}`)
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

// Revisar el gasto en el formulario completo
const expensePrefill = computed<ScanReading | null>(() => (result.value && invoice.value
  ? { ...result.value, data: invoice.value, contact: contactId.value ? { id: contactId.value, name: partyName.value } : null }
  : null))
function onExpenseSaved() {
  // El formulario ya avisa de que se ha guardado
  close()
  refreshNuxtData()
}

// ─── Archivo trimestral ───

const vFolder = ref('otros')
const vYear = ref(new Date().getFullYear())
const vQuarter = ref(1)
const vNote = ref('')
const folderOptions = VAULT_FOLDERS.map(f => ({ value: f.key, label: f.label }))
const quarterOptions = [1, 2, 3, 4].map(q => ({ value: q, label: `${q}T` }))

async function saveVault() {
  saving.value = true
  try {
    await $fetch('/api/vault/claim', { method: 'POST', body: { fileId: result.value!.fileId, folder: vFolder.value, year: Number(vYear.value), quarter: vQuarter.value, notes: vNote.value || null } })
    done('Guardado en el archivo', `${vaultFolder(vFolder.value).label} · ${vQuarter.value}T ${vYear.value}`, `/documentos/archivo?anio=${vYear.value}&t=${vQuarter.value}`)
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

const pickOptions = [{ value: 'auto', label: 'Detectar' }, { value: 'received', label: 'Gasto' }, { value: 'issued', label: 'Emitida' }]
const pickModel = computed({ get: () => pick.value as string, set: (v: string) => { pick.value = v as typeof pick.value } })
const duplicateLink = computed(() => duplicateUrl(result.value?.duplicate))

/** Gasto ya registrado sin su documento (desde el banco, a mano…): se le adjunta este en vez de duplicarlo */
const canAttach = computed(() => direction.value === 'received' && !!result.value?.duplicate?.attachable)
async function attachToExisting() {
  const dup = result.value?.duplicate
  if (!dup?.id) return
  saving.value = true
  try {
    const url: string = `/api/expenses/${dup.id}/document`
    const inv = invoice.value
    const r = await $fetch<{ fiscal: boolean }>(url, {
      method: 'POST',
      body: {
        fileId: result.value!.fileId,
        number: inv?.number ?? null,
        dueDate: inv?.dueDate ?? null,
        party: inv?.party ?? null,
        issueDate: inv?.issueDate ?? null,
        taxLines: inv?.taxLines.map(t => ({ base: t.base, vatRate: t.vatRate, vatAmount: t.vatAmount, surchargeRate: t.surchargeRate })) ?? null,
        irpfRate: inv?.irpfRate ?? null,
      },
    })
    done('Documento adjuntado', r.fiscal ? 'Al gasto que ya tenías, con la fecha y el IVA de la factura: no se ha duplicado' : 'Al gasto que ya tenías registrado: no se ha duplicado', `/gastos?ver=${dup.id}`)
  }
  catch (err) {
    toast.error('No se pudo adjuntar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" size="xl" :persistent="saving || step === 'reading'">
    <template #head>
      <div class="head">
        <span class="h-ic" aria-hidden="true"><Icon name="ph:scan" /></span>
        <div>
          <h2 class="title">Escaneo rápido</h2>
          <p class="subtitle">{{ step === 'result' ? 'Revisa lo leído y guárdalo' : 'Factura o ticket, emitido o recibido' }}</p>
        </div>
      </div>
    </template>

    <!-- Elegir -->
    <div v-if="step === 'pick'" class="pick">
      <DocsDropzone
        :multiple="false"
        camera
        title="Arrastra la factura o el ticket"
        :hint="touch ? 'Foto, PDF o Word.' : 'Foto, PDF o Word. También puedes pegar una captura con Ctrl+V.'"
        accept="image/*,.pdf,.doc,.docx,.odt,.txt,.xml"
        @files="onFiles"
      />
      <div class="pick-dir">
        <span class="label">Es</span>
        <UiSegmented v-model="pickModel" :options="pickOptions" label="Tipo de documento" />
      </div>
    </div>

    <!-- Leyendo -->
    <div v-else-if="step === 'reading'" class="split">
      <DocsFilePreview class="pv" :file="file" />
      <div class="reading" role="status" aria-live="polite">
        <div class="orb" aria-hidden="true"><Icon name="ph:sparkle-fill" /></div>
        <p class="rd-t">{{ MESSAGES[message] }}…</p>
        <p class="rd-s">La IA comprueba que base, IVA y retención cuadren al céntimo</p>
        <div class="rd-lines" aria-hidden="true">
          <span v-for="i in 5" :key="i" class="skeleton" :style="{ width: `${92 - i * 11}%` }" />
        </div>
      </div>
    </div>

    <!-- Resultado -->
    <div v-else-if="result" class="split">
      <DocsFilePreview class="pv" :file="file" />

      <div class="res">
        <div v-if="result.duplicate" class="note dup">
          <Icon name="ph:copy" aria-hidden="true" />
          <span class="grow">
            {{ result.duplicate.certain === false ? `Puede que ya lo tengas. ${result.duplicate.label}` : result.duplicate.label }}
            <template v-if="canAttach"><br>Le falta su documento: adjúntale este en vez de registrarlo otra vez.</template>
          </span>
          <NuxtLink v-if="duplicateLink" :to="duplicateLink" class="link" @click="close()">Ver</NuxtLink>
        </div>

        <template v-if="isInvoice && d">
          <div class="row between gap-3 wrap">
            <UiSegmented v-model="dirModel" :options="dirOptions" label="Tipo de documento" />
            <UiBadge v-if="result.confidence != null" tone="ai" icon="ph:sparkle-fill" size="sm">Confianza {{ result.confidence }} %</UiBadge>
          </div>

          <ImportInvoiceForm v-if="editing && invoice" v-model="invoice" v-model:direction="direction" v-model:contact-id="contactId" />

          <template v-else>
            <div class="party">
              <span v-if="isNewContact" class="p-new" aria-hidden="true"><Icon name="ph:user-plus" /></span>
              <UiAvatar v-else :name="partyName" :size="40" />
              <div class="grow min0">
                <p class="p-name truncate">{{ partyName }}</p>
                <p class="p-sub">
                  {{ d.party?.nif ?? 'Sin NIF' }} ·
                  <span :class="isNewContact ? 'new' : 'known'">{{ isNewContact ? `${direction === 'issued' ? 'cliente' : 'proveedor'} nuevo` : `ya en tus ${direction === 'issued' ? 'clientes' : 'proveedores'}` }}</span>
                </p>
              </div>
            </div>

            <div class="kpis">
              <div><span class="k-l">Número</span><span class="k-v truncate">{{ d.number ?? '—' }}</span></div>
              <div><span class="k-l">Fecha</span><span class="k-v">{{ fdate(d.issueDate) }}</span></div>
              <div><span class="k-l">{{ direction === 'received' ? 'Categoría' : 'Vence' }}</span><span class="k-v truncate">{{ direction === 'received' ? category?.name ?? 'Sin categoría' : fdate(d.dueDate) }}</span></div>
            </div>

            <dl class="amounts">
              <div v-for="(t, i) in d.taxLines" :key="i"><dt>Base {{ num(t.vatRate) }} %</dt><dd class="num">{{ eur(t.base) }}</dd></div>
              <div><dt>IVA</dt><dd class="num">{{ eur(d.taxLines.reduce((s, t) => s + t.vatAmount, 0)) }}</dd></div>
              <div v-if="d.taxLines.some(t => t.surchargeAmount)"><dt>Recargo de equivalencia</dt><dd class="num">{{ eur(d.taxLines.reduce((s, t) => s + t.surchargeAmount, 0)) }}</dd></div>
              <div v-if="d.irpfAmount"><dt>Retención IRPF {{ num(d.irpfRate) }} %</dt><dd class="num neg">−{{ eur(d.irpfAmount) }}</dd></div>
              <div class="grand"><dt>Total</dt><dd class="num">{{ eur(d.total) }}</dd></div>
            </dl>
            <p v-if="d.vatCalculation" class="small muted">{{ d.vatCalculation }}</p>
            <details v-if="d.bodyText" class="body-text">
              <summary>
                <Icon name="ph:text-align-left" aria-hidden="true" />
                <span class="grow truncate">{{ direction === 'issued' ? 'Descripción' : 'Notas' }} · {{ d.bodyText.split('\n')[0]!.replace(/^#+\s*/, '') }}</span>
              </summary>
              <p class="bt-text">{{ d.bodyText.replace(/^#+\s*/gm, '') }}</p>
            </details>
            <p class="check" :class="balanced ? 'ok' : 'bad'">
              <Icon :name="balanced ? 'ph:check-circle-fill' : 'ph:warning-fill'" aria-hidden="true" />
              {{ balanced ? 'Los importes cuadran' : 'Los importes no cuadran: revísalos' }}
              <span v-if="d.paid" class="paid">· {{ direction === 'issued' ? 'Cobrada' : 'Pagada' }}{{ d.paymentMethod ? ` con ${PAYMENT_METHODS[d.paymentMethod]?.toLowerCase()}` : '' }}</span>
            </p>
            <ExpenseDeductible
              v-if="direction === 'received'"
              v-model:pct="dedPct"
              v-model:vat-pct="dedVat"
              compact
              class="scan-ded"
              :has-vat="dedVatAmount !== 0"
              :base="dedBase"
              :vat="dedVatAmount"
              :learned="dedLearned"
            />
          </template>

          <ul v-if="result.warnings.length" class="note warn">
            <li v-for="(w, i) in result.warnings" :key="i"><Icon name="ph:warning-fill" aria-hidden="true" /> {{ w }}</li>
          </ul>
        </template>

        <!-- No es una factura: al archivo trimestral -->
        <template v-else>
          <div class="party">
            <span class="p-new vault" aria-hidden="true"><Icon name="ph:archive" /></span>
            <div class="grow min0">
              <p class="p-name">{{ result.vault?.summary ?? 'Documento' }}</p>
              <p class="p-sub">No es una factura: guárdalo en el archivo trimestral</p>
            </div>
          </div>
          <div class="form-grid">
            <UiSelect v-model="vFolder" class="c-6" label="Carpeta" :options="folderOptions" />
            <UiInput v-model="vYear" class="c-3" label="Año" type="number" />
            <UiSelect v-model="vQuarter" class="c-3" label="Trimestre" :options="quarterOptions" />
            <UiInput v-model="vNote" class="c-12" label="Nota" />
          </div>
        </template>
      </div>
    </div>

    <template v-if="step === 'result' && result" #footer>
      <UiButton variant="ghost" icon="ph:arrow-counter-clockwise" :disabled="saving" @click="again">Escanear otro</UiButton>
      <span class="grow" />
      <template v-if="isInvoice && direction === 'received'">
        <UiButton variant="secondary" icon="ph:pencil-simple" :disabled="saving" @click="expenseOpen = true">Revisar en el formulario</UiButton>
        <UiButton v-if="canAttach" variant="primary" icon="ph:paperclip" :loading="saving" @click="attachToExisting">Adjuntar al gasto</UiButton>
        <UiButton v-else variant="primary" icon="ph:check" :loading="saving" :disabled="!d?.issueDate" @click="saveExpense">Guardar gasto</UiButton>
      </template>
      <template v-else-if="isInvoice">
        <UiButton variant="secondary" :icon="editing ? 'ph:eye' : 'ph:pencil-simple'" :disabled="saving" @click="editing = !editing">{{ editing ? 'Ver resumen' : 'Editar' }}</UiButton>
        <UiButton variant="primary" icon="ph:check" :loading="saving" :disabled="!d?.issueDate" @click="saveSales">Guardar {{ salesLabel }}</UiButton>
      </template>
      <UiButton v-else variant="primary" icon="ph:archive" :loading="saving" @click="saveVault">Guardar en el archivo</UiButton>
    </template>
  </UiModal>

  <LazyExpenseModal v-if="expensePrefill" v-model="expenseOpen" :prefill="expensePrefill" @saved="onExpenseSaved" />
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.h-ic {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  font-size: 18px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-md);
}

.title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.subtitle {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.scan-ded {
  margin-top: var(--s-4);
  padding-top: var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.pick {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.pick-dir {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-3);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: var(--s-6);
  align-items: start;
}

.pv {
  position: sticky;
  top: 0;
  height: min(68dvh, 580px);
}

.reading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  min-height: 320px;
  text-align: center;
}

.orb {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--s-3);
  font-size: 28px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-full);
  box-shadow: 0 0 0 10px rgb(124 58 237 / 0.08), 0 12px 30px -10px rgb(79 70 229 / 0.6);
  animation: orb 1.8s var(--ease-out) infinite;
}

@keyframes orb {
  50% {
    transform: scale(1.06) rotate(8deg);
    box-shadow: 0 0 0 18px rgb(124 58 237 / 0.05), 0 12px 30px -10px rgb(79 70 229 / 0.6);
  }
}

.rd-t {
  font-size: var(--text-lg);
  font-weight: 640;
}

.rd-s {
  color: var(--text-3);
  font-size: var(--text-sm);
}

.rd-lines {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 80%;
  margin-top: var(--s-5);
}

.rd-lines span {
  height: 10px;
}

.res {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  min-width: 0;
}

.min0 {
  min-width: 0;
}

.party {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.p-new {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  font-size: 19px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.p-new.vault {
  color: var(--info);
  background: var(--info-soft);
}

.p-name {
  font-size: var(--text-lg);
  font-weight: 650;
}

.p-sub {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.p-sub .new {
  color: var(--brand-text);
  font-weight: 560;
}

.p-sub .known {
  color: var(--success);
  font-weight: 560;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-2);
}

.kpis > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.k-l {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.k-v {
  font-weight: 600;
}

.amounts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.amounts div {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.amounts .grand {
  margin-top: 4px;
  padding-top: 10px;
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text);
  border-top: 1px solid var(--border);
}

.check {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 540;
}

.check.ok {
  color: var(--success);
}

.check.bad {
  color: var(--warning);
}

.paid {
  color: var(--text-3);
  font-weight: 450;
}

.body-text {
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.body-text summary {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: 10px 12px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-2);
  cursor: pointer;
  list-style: none;
}

.body-text summary::-webkit-details-marker {
  display: none;
}

.bt-text {
  max-height: 220px;
  overflow: auto;
  padding: 0 12px 12px;
  font-size: var(--text-sm);
  color: var(--text-2);
  white-space: pre-line;
}

.note {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: 10px 12px;
  font-size: var(--text-sm);
  border-radius: var(--r-lg);
}

.note.dup {
  color: var(--info);
  background: var(--info-soft);
}

.note.warn {
  flex-direction: column;
  align-items: stretch;
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

.form-grid .c-12 {
  grid-column: span 12;
}

@media (max-width: 820px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }

  .pv {
    height: 260px;
  }
}

@media (max-width: 480px) {
  .kpis {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
