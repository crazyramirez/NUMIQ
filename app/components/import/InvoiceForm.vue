<script setup lang="ts">
import type { ImportInvoiceData, ImportParty } from '#shared/types/import'

/**
 * Revisión de una factura leída con IA: emitida o recibida, contacto (existente o nuevo), fechas,
 * bases por tipo de IVA, retención y total, con aviso en vivo si los importes no cuadran.
 */
const data = defineModel<ImportInvoiceData>({ required: true })
const direction = defineModel<'issued' | 'received'>('direction', { required: true })
const contactId = defineModel<number | null>('contactId', { default: null })

interface ContactOpt { id: number, name: string, nif: string | null, city: string | null, logoUrl: string | null }
interface Category { id: number, kind: string, name: string, accountCode: string | null }

const contacts = ref<ContactOpt[]>([])
const categories = ref<Category[]>([])

watch(direction, async (d) => {
  contacts.value = await $fetch<ContactOpt[]>('/api/contacts', { query: { role: d === 'issued' ? 'client' : 'supplier', limit: 500 } }).catch(() => [])
}, { immediate: true })
onMounted(async () => {
  categories.value = await $fetch<Category[]>('/api/categories').catch(() => [])
})

const contactOptions = computed(() => contacts.value.map(c => ({ value: c.id, label: c.name, sub: c.nif ?? c.city, image: c.logoUrl })))
const linked = computed(() => contacts.value.find(c => c.id === contactId.value) ?? null)
const categoryOptions = computed(() => [
  { value: null, label: 'Sin categoría' },
  ...categories.value.filter(c => c.kind === 'expense').sort((a, b) => a.name.localeCompare(b.name, 'es')).map(c => ({ value: c.id, label: c.name })),
])

const blankParty = (): ImportParty => ({ name: '', nif: null, address: null, postalCode: null, city: null, province: null, country: 'ES', email: null, phone: null, isPerson: false })
const showParty = ref(false)

function useNewContact() {
  contactId.value = null
  data.value.party ??= blankParty()
  showParty.value = true
}

const nifState = computed(() => {
  const nif = data.value.party?.nif
  if (!nif || data.value.party?.country !== 'ES') return null
  return validateNif(nif).valid
})

// ─── Importes ───

const vatOptions = [...VAT_RATES, 5, 2].map(r => ({ value: r, label: `${num(r)} %` }))
const manualVat = ref<boolean[]>(data.value.taxLines.map(t => Math.abs(t.vatAmount - pctOf(t.base, t.vatRate)) > 0.004))

function setBase(i: number, v: unknown) {
  const t = data.value.taxLines[i]!
  t.base = Number(v) || 0
  if (!manualVat.value[i]) t.vatAmount = pctOf(t.base, t.vatRate)
  if (t.surchargeRate) t.surchargeAmount = pctOf(t.base, t.surchargeRate)
  syncIrpf()
}

function setRate(i: number, v: unknown) {
  const t = data.value.taxLines[i]!
  t.vatRate = Number(v)
  manualVat.value[i] = false
  t.vatAmount = pctOf(t.base, t.vatRate)
  if (t.surchargeRate) {
    t.surchargeRate = SURCHARGE_BY_VAT[t.vatRate] ?? 0
    t.surchargeAmount = pctOf(t.base, t.surchargeRate)
  }
}

function setVat(i: number, v: unknown) {
  const t = data.value.taxLines[i]!
  t.vatAmount = Number(v) || 0
  manualVat.value[i] = Math.abs(t.vatAmount - pctOf(t.base, t.vatRate)) > 0.004
}

function addLine() {
  const used = new Set(data.value.taxLines.map(t => t.vatRate))
  data.value.taxLines.push({ base: 0, vatRate: VAT_RATES.find(r => !used.has(r)) ?? 21, vatAmount: 0, surchargeRate: 0, surchargeAmount: 0 })
  manualVat.value.push(false)
}

function removeLine(i: number) {
  data.value.taxLines.splice(i, 1)
  manualVat.value.splice(i, 1)
  syncIrpf()
}

const taxBase = computed(() => round2(data.value.taxLines.reduce((s, t) => s + (t.base || 0), 0)))

function syncIrpf() {
  if (data.value.irpfRate) data.value.irpfAmount = Math.abs(pctOf(taxBase.value, data.value.irpfRate)) * Math.sign(taxBase.value || 1)
}

function setIrpfRate(v: unknown) {
  data.value.irpfRate = Number(v)
  data.value.irpfAmount = data.value.irpfRate ? Math.abs(pctOf(taxBase.value, data.value.irpfRate)) * Math.sign(taxBase.value || 1) : 0
}

const computedTotal = computed(() => round2(data.value.taxLines.reduce((s, t) => s + (t.base || 0) + (t.vatAmount || 0) + (t.surchargeAmount || 0), 0) - (data.value.irpfAmount || 0)))
const diff = computed(() => round2((data.value.total || 0) - computedTotal.value))

// ─── Estado de pago (sin dato = lo decide la opción de la importación) ───

const paidModel = computed({
  get: () => (data.value.paid === true ? 'yes' : data.value.paid === false ? 'no' : 'auto'),
  set: (v: string) => { data.value.paid = v === 'yes' ? true : v === 'no' ? false : null },
})
const paidOptions = computed(() => [
  { value: 'auto', label: 'Según vencimiento' },
  { value: 'yes', label: direction.value === 'issued' ? 'Cobrada' : 'Pagada' },
  { value: 'no', label: 'Pendiente' },
])
const methodOptions = [{ value: null, label: 'Sin indicar' }, ...Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))]
// Presupuestos y proformas solo los emite la empresa (los de proveedores van al archivo)
const docTypeOptions = computed(() => [
  { value: 'invoice', label: 'Factura' },
  { value: 'simplified', label: 'Factura simplificada' },
  { value: 'ticket', label: 'Ticket o recibo' },
  { value: 'credit_note', label: 'Rectificativa / abono' },
  ...(direction.value === 'issued' ? [{ value: 'quote', label: 'Presupuesto' }, { value: 'proforma', label: 'Factura proforma' }] : []),
])
const isQuote = computed(() => data.value.docType === 'quote' || data.value.docType === 'proforma')
watch(direction, (v) => {
  if (v === 'received' && isQuote.value) data.value.docType = 'invoice'
})
const dirOptions = [
  { value: 'received', label: 'Recibida · gasto' },
  { value: 'issued', label: 'Emitida · venta' },
]
const dirModel = computed({ get: () => direction.value as string, set: (v: string) => { direction.value = v as 'issued' | 'received' } })
const showLines = ref(false)
</script>

<template>
  <div class="inv-form">
    <p v-if="data.vatCalculation" class="small muted">{{ data.vatCalculation }}</p>
    <UiSegmented v-model="dirModel" :options="dirOptions" label="Tipo de factura" class="dir" />

    <!-- Contacto -->
    <section class="block">
      <p class="eyebrow">{{ direction === 'issued' ? 'Cliente' : 'Proveedor' }}</p>
      <div v-if="linked" class="contact on">
        <UiAvatar :name="linked.name" :size="28" />
        <div class="grow min0">
          <p class="c-name truncate">{{ linked.name }}</p>
          <p class="c-sub">{{ linked.nif ?? 'Sin NIF' }} · ya está en tus {{ direction === 'issued' ? 'clientes' : 'proveedores' }}</p>
        </div>
        <UiButton size="sm" variant="ghost" @click="useNewContact">Crear otro</UiButton>
      </div>
      <template v-else>
        <div v-if="data.party" class="contact new">
          <span class="new-ic" aria-hidden="true"><Icon name="ph:user-plus" /></span>
          <div class="grow min0">
            <p class="c-name truncate">{{ data.party.name || 'Sin nombre' }}</p>
            <p class="c-sub">{{ data.party.nif ?? 'Sin NIF' }} · se creará al importar</p>
          </div>
          <UiButton size="sm" variant="ghost" :icon="showParty ? 'ph:caret-up' : 'ph:pencil-simple'" @click="showParty = !showParty">{{ showParty ? 'Cerrar' : 'Editar' }}</UiButton>
        </div>
        <div v-if="data.party && showParty" class="form-grid party">
          <UiInput v-model="data.party.name" class="c-8" label="Nombre o razón social" required />
          <UiInput v-model="data.party.nif" class="c-4 upper" label="NIF" :error="nifState === false ? 'Revisa la letra de control' : null" />
          <UiInput v-model="data.party.address" class="c-8" label="Dirección" />
          <UiInput v-model="data.party.postalCode" class="c-4" label="C. postal" />
          <UiInput v-model="data.party.city" class="c-6" label="Población" />
          <UiInput v-model="data.party.province" class="c-6" label="Provincia" />
          <UiInput v-model="data.party.email" class="c-8" label="Email" type="email" />
          <UiInput v-model="data.party.country" class="c-4 upper" label="País" maxlength="2" />
        </div>
        <UiCombobox
          v-model="contactId"
          class="pick"
          :options="contactOptions"
          :placeholder="`O asigna a un ${direction === 'issued' ? 'cliente' : 'proveedor'} existente…`"
          :aria-label="`Asignar a un ${direction === 'issued' ? 'cliente' : 'proveedor'} existente`"
          avatars
        />
      </template>
    </section>

    <!-- Datos -->
    <div class="form-grid">
      <UiInput v-model="data.number" class="c-4" :label="isQuote ? 'Número' : 'Nº de factura'" />
      <UiInput v-model="data.issueDate" class="c-4" label="Fecha" type="date" required :error="data.issueDate ? null : 'Falta la fecha'" />
      <UiInput v-model="data.dueDate" class="c-4" :label="isQuote ? 'Válido hasta' : 'Vencimiento'" type="date" />
      <UiSelect v-model="data.docType" class="c-6" label="Documento" :options="docTypeOptions" />
      <UiSelect v-if="direction === 'received'" v-model="data.categoryId" class="c-6" label="Categoría" :options="categoryOptions" />
      <UiInput v-else v-model="data.customerReference" class="c-6" label="Orden de Pedido" placeholder="Nº de pedido del cliente" />
      <UiInput v-model="data.description" class="c-12" label="Concepto" placeholder="Ej. Fibra y móvil de octubre" />
      <UiTextarea
        v-model="data.bodyText"
        class="c-12"
        :label="direction === 'issued' ? 'Descripción' : 'Notas'"
        rows="6"
        :hint="direction === 'issued' ? 'Se muestra antes de los conceptos. «## » marca un título y «- » una viñeta' : 'Texto descriptivo del documento original'"
        placeholder="Sin texto descriptivo en el documento"
      />
      <UiInput v-if="data.docType === 'credit_note'" v-model="data.rectifiedNumber" class="c-6" label="Factura que rectifica" />
    </div>

    <!-- Importes -->
    <section class="block amounts">
      <div class="row between">
        <p class="eyebrow">Importes</p>
        <button v-if="data.taxLines.length < 6" type="button" class="link small" @click="addLine"><Icon name="ph:plus" aria-hidden="true" /> Otro tipo de IVA</button>
      </div>
      <div class="tl head" aria-hidden="true">
        <span>Base</span><span>IVA</span><span>Cuota</span><span />
      </div>
      <div v-for="(t, i) in data.taxLines" :key="i" class="tl">
        <UiInput :model-value="t.base" numeric suffix="€" :aria-label="`Base ${i + 1}`" @update:model-value="setBase(i, $event)" />
        <UiSelect :model-value="t.vatRate" :options="vatOptions" :aria-label="`Tipo de IVA ${i + 1}`" @update:model-value="setRate(i, $event)" />
        <UiInput :model-value="t.vatAmount" numeric suffix="€" :aria-label="`Cuota ${i + 1}`" @update:model-value="setVat(i, $event)" />
        <UiButton variant="ghost" size="sm" square icon="ph:trash" :aria-label="`Quitar base ${i + 1}`" :disabled="data.taxLines.length === 1" @click="removeLine(i)" />
        <p v-if="t.surchargeAmount" class="sur">Recargo de equivalencia {{ num(t.surchargeRate) }} %: {{ eur(t.surchargeAmount) }}</p>
      </div>

      <div class="form-grid tot-grid">
        <IrpfField :model-value="data.irpfRate" class="c-4" @update:model-value="setIrpfRate" />
        <UiInput v-model="data.irpfAmount" class="c-4" label="Importe retenido" numeric suffix="€" :disabled="!data.irpfRate" />
        <UiInput v-model="data.total" class="c-4" label="Total del documento" numeric suffix="€" required />
      </div>
      <p class="check" :class="Math.abs(diff) <= 0.05 ? 'ok' : 'bad'" aria-live="polite">
        <Icon :name="Math.abs(diff) <= 0.05 ? 'ph:check-circle-fill' : 'ph:warning-fill'" aria-hidden="true" />
        <template v-if="Math.abs(diff) <= 0.05">Cuadra: base {{ eur(taxBase) }} + IVA − retención = {{ eur(computedTotal) }}</template>
        <template v-else>
          No cuadra: la suma da {{ eur(computedTotal) }} ({{ diff > 0 ? '+' : '' }}{{ eur(diff) }})
          <button type="button" class="link" @click="data.total = computedTotal">Usar la suma</button>
        </template>
      </p>
    </section>

    <div class="form-grid">
      <UiSelect v-if="!isQuote" v-model="paidModel" class="c-6" :label="direction === 'issued' ? 'Cobro' : 'Pago'" :options="paidOptions" />
      <UiSelect v-model="data.paymentMethod" class="c-6" label="Forma de pago" :options="methodOptions" />
    </div>

    <!-- Conceptos -->
    <section v-if="data.lines.length" class="block">
      <button type="button" class="lines-toggle" :aria-expanded="showLines" @click="showLines = !showLines">
        <Icon :name="showLines ? 'ph:caret-down' : 'ph:caret-right'" aria-hidden="true" />
        Conceptos ({{ data.lines.length }})
        <span class="muted small">{{ data.linesMatch ? '· se importan tal cual' : '· resumidos por tipo de IVA' }}</span>
      </button>
      <ul v-if="showLines" class="lines">
        <li v-for="(l, i) in data.lines" :key="i">
          <span class="grow l-desc">{{ l.description }}</span>
          <span class="num l-q">{{ num(l.quantity) }} × {{ eur(l.unitPrice) }}</span>
          <span class="num l-t">{{ eur(lineAmounts(l).base) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.inv-form {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.dir {
  align-self: flex-start;
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.contact {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface-2);
}

.contact.on {
  border-color: color-mix(in srgb, var(--success-solid) 35%, var(--border));
  background: var(--success-soft);
}

.new-ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.c-name {
  font-weight: 600;
}

.c-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.min0 {
  min-width: 0;
}

.party {
  padding: var(--s-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.form-grid .c-12 {
  grid-column: span 12;
}

.amounts {
  padding: var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.tl {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.9fr) minmax(0, 1.1fr) 32px;
  gap: var(--s-2);
  align-items: center;
}

.tl.head span {
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
}

.sur {
  grid-column: 1 / -1;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.tot-grid {
  margin-top: var(--s-2);
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

.small {
  font-size: var(--text-sm);
}

.lines-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  font-weight: 580;
  color: var(--text-2);
}

.lines {
  list-style: none;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.lines li {
  display: flex;
  align-items: baseline;
  gap: var(--s-3);
  padding: 9px 12px;
  font-size: var(--text-sm);
}

.lines li + li {
  border-top: 1px solid var(--border-subtle);
}

.l-desc {
  white-space: pre-line;
}

.l-q {
  color: var(--text-3);
  white-space: nowrap;
}

.l-t {
  min-width: 84px;
  text-align: right;
  font-weight: 560;
}

@media (max-width: 520px) {
  .tl {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
  }

  .tl > :nth-child(3) {
    grid-column: 1 / 3;
    grid-row: 2;
  }

  .tl.head {
    display: none;
  }

  .lines li {
    flex-wrap: wrap;
  }
}
</style>
