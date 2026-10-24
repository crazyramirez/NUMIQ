<script setup lang="ts">
/** Crear el gasto de un cargo del banco (ya pagado): proveedor, categoría e IVA, con la propuesta precargada */
interface Suggestion { expenseKind?: string, categoryId?: number | null, supplier?: string | null, vatRate?: number | null, deductiblePct?: number | null, vatDeductiblePct?: number | null, contactId?: number | null }
const props = defineProps<{ tx: { id: number, date: string, amount: number, description: string, suggestion: Suggestion | null } | null }>()
const emit = defineEmits<{ created: [] }>()
const open = defineModel<boolean>({ default: false })
const toast = useToast()

const { data: cats } = useFetch<Array<{ id: number, kind: string, name: string }>>('/api/categories', { key: 'categories', lazy: true, server: false })
const categoryOptions = computed(() => [{ value: null, label: 'Sin categoría' }, ...(cats.value ?? []).filter(c => c.kind === 'expense').map(c => ({ value: c.id, label: c.name }))])
const KINDS = [
  { value: 'ticket', label: 'Compra o servicio' },
  { value: 'invoice', label: 'Factura de proveedor' },
  { value: 'social_security', label: 'Seguridad Social' },
  { value: 'payroll', label: 'Nómina' },
  { value: 'tax', label: 'Tributo (IBI, IAE, tasas)' },
  { value: 'other', label: 'Otro gasto' },
]
const VAT = [21, 10, 4, 0]

const form = reactive({ kind: 'ticket', supplier: '', categoryId: null as number | null, vatRate: 21, description: '', deductiblePct: 100, vatDeductiblePct: 100 })
const busy = ref(false)
const showFullDesc = ref(false)
/** Proveedor cuya deducibilidad de la última vez se ha propuesto */
const learned = ref<string | null>(null)
let ready = false

watch(open, (v) => {
  if (!v || !props.tx) return
  ready = false
  showFullDesc.value = false
  const s = props.tx.suggestion
  Object.assign(form, {
    kind: s?.expenseKind ?? 'ticket',
    supplier: s?.supplier ?? '',
    categoryId: s?.categoryId ?? null,
    vatRate: s?.vatRate ?? 21,
    description: '',
    deductiblePct: s?.deductiblePct ?? 100,
    vatDeductiblePct: s?.vatDeductiblePct ?? s?.deductiblePct ?? 100,
  })
  learned.value = null
  // La propuesta guardada puede ser de antes de marcar otros gastos: se vuelve a preguntar
  guess().finally(() => (ready = true))
})

// Deducibilidad: lo que marcaste la última vez con este proveedor o el % de la categoría
let seq = 0
async function guess() {
  const n = ++seq
  const g = await $fetch<{ deductiblePct: number, vatDeductiblePct: number, source: string }>('/api/expenses/deductible', {
    query: { supplier: form.supplier.trim() || undefined, categoryId: form.categoryId ?? undefined },
  }).catch(() => null)
  if (!g || n !== seq) return
  form.deductiblePct = g.deductiblePct
  form.vatDeductiblePct = g.vatDeductiblePct
  learned.value = g.source === 'supplier' ? form.supplier.trim() : null
}
watch(() => form.categoryId, () => ready && guess())
const supplierTyped = refDebounced(toRef(form, 'supplier'), 400)
watch(supplierTyped, () => ready && guess())

const total = computed(() => Math.abs(props.tx?.amount ?? 0))
const base = computed(() => round2(total.value / (1 + form.vatRate / 100)))

async function submit() {
  if (!props.tx) return
  busy.value = true
  try {
    const url: string = `/api/bank/transactions/${props.tx.id}/expense`
    // El proveedor reconocido en el movimiento, mientras no se cambie el nombre
    const s = props.tx.suggestion
    const contactId = s?.contactId && form.supplier.trim() === (s.supplier ?? '').trim() ? s.contactId : null
    const r = await $fetch<{ linked?: boolean }>(url, { method: 'POST', body: { ...form, supplier: form.supplier || null, description: form.description || null, contactId } })
    // Ya estaba anotado (escaneado, importado o a mano): se concilia con él en vez de duplicarlo
    if (r.linked) toast.success('Ya estaba anotado', `${eur(total.value)} · conciliado con el gasto que tenías, sin duplicarlo`)
    else toast.success('Gasto creado y conciliado', `${eur(total.value)} · ya cuenta en tus impuestos`)
    open.value = false
    emit('created')
  }
  catch (err) {
    toast.error('No se pudo crear el gasto', errorMessage(err))
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" title="Crear gasto desde el banco" subtitle="Queda pagado y conciliado con este cargo." size="md" :persistent="busy">
    <form v-if="tx" id="bank-expense" class="ef" novalidate @submit.prevent="submit">
      <div class="tx">
        <div class="min0 grow">
          <p class="tx-d selectable" :class="{ truncate: !showFullDesc }" :title="tx.description" @click="showFullDesc = !showFullDesc">
            {{ tx.description }}
          </p>
          <p class="tx-s">
            <span>{{ fdate(tx.date) }}</span>
            <button v-if="tx.description.length > 45" type="button" class="tx-toggle" @click="showFullDesc = !showFullDesc">
              {{ showFullDesc ? 'Contraer' : 'Ver concepto completo' }}
            </button>
          </p>
        </div>
        <strong class="num">{{ eur(tx.amount) }}</strong>
      </div>
      <div class="form-grid">
        <UiInput v-model="form.supplier" class="c-6" label="Proveedor" placeholder="Ej. Endesa" />
        <UiSelect v-model="form.categoryId" class="c-6" label="Categoría" :options="categoryOptions" />
        <UiSelect v-model="form.kind" class="c-6" label="Tipo" :options="KINDS" />
        <div class="c-6 vat">
          <span class="label">IVA</span>
          <div class="vat-opts" role="radiogroup" aria-label="Tipo de IVA">
            <button v-for="v in VAT" :key="v" type="button" role="radio" :aria-checked="form.vatRate === v" class="vat-o" :class="{ on: form.vatRate === v }" @click="form.vatRate = v">
              {{ v }} %
            </button>
          </div>
        </div>
        <UiInput v-model="form.description" class="c-12" label="Concepto (opcional)" :placeholder="tx.description.slice(0, 80)" />
      </div>
      <ExpenseDeductible
        v-model:pct="form.deductiblePct"
        v-model:vat-pct="form.vatDeductiblePct"
        compact
        :has-vat="form.vatRate > 0"
        :base="base"
        :vat="round2(total - base)"
        :learned="learned"
      />
      <div class="split">
        <div><span>Base</span><strong class="num">{{ eur(base) }}</strong></div>
        <div><span>IVA {{ form.vatRate }} %</span><strong class="num">{{ eur(round2(total - base)) }}</strong></div>
        <div><span>Total</span><strong class="num">{{ eur(total) }}</strong></div>
      </div>
      <p class="tip"><Icon name="ph:info" aria-hidden="true" /> Si tienes la factura, adjúntala después en el gasto para poder deducir el IVA.</p>
    </form>
    <template #footer>
      <UiButton variant="ghost" :disabled="busy" @click="open = false">Cancelar</UiButton>
      <UiButton variant="primary" type="submit" form="bank-expense" icon="ph:check-bold" :loading="busy">Crear gasto</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.ef {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.tx {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 12px 14px;
  background: var(--surface-sunken);
  border-radius: var(--r-lg);
}

.tx-d {
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
  cursor: pointer;
}

.tx-s {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.tx-toggle {
  background: none;
  border: 0;
  padding: 0;
  font-size: 11px;
  color: var(--brand-text);
  cursor: pointer;
}

.tx-toggle:hover {
  text-decoration: underline;
}

.vat {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-2);
}

.vat-opts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 3px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.vat-o {
  min-height: 34px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
  background: none;
  border: 0;
  border-radius: calc(var(--r-md) - 3px);
  cursor: pointer;
}

.vat-o.on {
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.vat-o:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.split {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--s-2);
}

.split div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--surface-sunken);
  border-radius: var(--r-md);
}

.split span {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.tip {
  display: flex;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.tip :deep(svg) {
  flex: none;
  margin-top: 1px;
}

.min0 {
  min-width: 0;
}
</style>
