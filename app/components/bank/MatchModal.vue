<script setup lang="ts">
/** Buscar a mano la factura o el gasto que corresponde a un movimiento */
const props = defineProps<{
  tx: {
    id: number
    date: string
    amount: number
    description: string
    status?: 'pending' | 'matched' | 'ignored'
    link?: { kind: 'invoice' | 'expense', id: number, label: string, detail: string | null } | null
  } | null
}>()
const emit = defineEmits<{ matched: [] }>()
const open = defineModel<boolean>({ default: false })
const toast = useToast()

interface Candidate { kind: 'invoice' | 'expense' | 'payment', id: number, title: string, subtitle: string, amount: number, date: string, exact: boolean }

const q = ref('')
const items = ref<Candidate[]>([])
const loading = ref(false)
const busy = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

async function load() {
  if (!props.tx) return
  loading.value = true
  try {
    const r = await $fetch<{ items: Candidate[] }>(`/api/bank/transactions/${props.tx.id}/candidates`, { query: { q: q.value } })
    items.value = r.items
  }
  catch (err) {
    toast.error('No se pudo buscar', errorMessage(err))
  }
  finally {
    loading.value = false
  }
}

const showFullDesc = ref(false)

watch(open, (v) => {
  if (!v) return
  q.value = ''
  items.value = []
  showFullDesc.value = false
  multi.value = false
  picked.value = []
  load()
})
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(load, 250)
})

async function pick(c: Candidate) {
  if (!props.tx) return
  busy.value = `${c.kind}:${c.id}`
  try {
    await $fetch(`/api/bank/transactions/${props.tx.id}/match`, { method: 'POST', body: { kind: c.kind, id: c.id } })
    toast.success(isReassign.value ? 'Movimiento reasignado' : 'Movimiento conciliado', c.title)
    open.value = false
    emit('matched')
  }
  catch (err) {
    toast.error('No se pudo conciliar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

/** Un ingreso que paga varias facturas del mismo cliente: se marcan y se cobran todas a la vez */
const multi = ref(false)
const picked = ref<Candidate[]>([])
const isPicked = (c: Candidate) => picked.value.some(p => p.id === c.id)
/** Marcada la primera, solo las del mismo cliente (el subtítulo de una factura es su cliente) */
const otherClient = (c: Candidate) => !!picked.value.length && !isPicked(c) && c.subtitle !== picked.value[0]!.subtitle
const pickedSum = computed(() => Math.round(picked.value.reduce((s, c) => s + c.amount, 0) * 100) / 100)
const pickedFits = computed(() => picked.value.length >= 2 && candDiff(pickedSum.value) <= 1)
const canMulti = computed(() => income.value && items.value.filter(c => c.kind === 'invoice').length >= 2)

function toggle(c: Candidate) {
  picked.value = isPicked(c) ? picked.value.filter(p => p.id !== c.id) : [...picked.value, c]
}

function onRow(c: Candidate) {
  if (multi.value) {
    if (c.kind === 'invoice') toggle(c)
    return
  }
  pick(c)
}

async function pickMany() {
  if (!props.tx || !pickedFits.value) return
  busy.value = 'many'
  try {
    const ids = picked.value.map(c => c.id)
    await $fetch(`/api/bank/transactions/${props.tx.id}/match`, { method: 'POST', body: { kind: 'invoice', id: ids[0], ids } })
    toast.success(`${ids.length} facturas cobradas`, picked.value.map(c => c.title.replace(/^Factura /, '')).join(' + '))
    open.value = false
    emit('matched')
  }
  catch (err) {
    toast.error('No se pudo conciliar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

const income = computed(() => (props.tx?.amount ?? 0) > 0)
const isReassign = computed(() => props.tx?.status === 'matched')
const modalTitle = computed(() => {
  if (isReassign.value) return income.value ? 'Reasignar cobro a otra factura' : 'Reasignar pago a otro gasto'
  return income.value ? '¿Qué factura cobra este ingreso?' : '¿Qué gasto paga este cargo?'
})
const modalSubtitle = computed(() => {
  if (isReassign.value && props.tx?.link) {
    return `Actualmente conciliado con ${props.tx.link.label}. Al elegir otra factura o gasto, se desvinculará del anterior.`
  }
  return undefined
})

function candDiff(candAmount: number) {
  const txAmount = Math.abs(props.tx?.amount ?? 0)
  return Math.round(Math.abs(candAmount - txAmount) * 100) / 100
}
</script>

<template>
  <UiModal v-model="open" :title="modalTitle" :subtitle="modalSubtitle" size="md">
    <div v-if="tx" class="mm">
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
        <strong class="num" :class="income ? 'pos' : 'neg'">{{ eur(tx.amount) }}</strong>
      </div>
      <div class="search-row">
        <UiInput v-model="q" icon="ph:magnifying-glass" type="search" :placeholder="income ? 'Cliente o nº de factura' : 'Proveedor, concepto o nº'" aria-label="Buscar" class="grow" />
        <UiButton
          v-if="canMulti || multi"
          :variant="multi ? 'soft' : 'secondary'"
          icon="ph:stack"
          :aria-pressed="multi"
          title="Un solo ingreso que paga varias facturas del mismo cliente"
          @click="multi = !multi; picked = []"
        >
          Varias<span class="long"> facturas</span>
        </UiButton>
      </div>
      <p v-if="multi" class="multi-hint">Marca las facturas que paga este ingreso: deben ser del mismo cliente y sumar su importe.</p>
      <div class="list" :aria-busy="loading">
        <template v-if="loading && !items.length">
          <div v-for="i in 4" :key="i" class="skeleton" style="height: 52px" />
        </template>
        <button
          v-for="c in items"
          :key="`${c.kind}:${c.id}`"
          type="button"
          class="cand"
          :class="{ on: multi && isPicked(c) }"
          :disabled="!!busy || (multi && (c.kind !== 'invoice' || otherClient(c)))"
          :aria-pressed="multi ? isPicked(c) : undefined"
          @click="onRow(c)"
        >
          <span v-if="multi" class="c-check" aria-hidden="true"><Icon :name="isPicked(c) ? 'ph:check-square-fill' : 'ph:square'" /></span>
          <span v-else class="c-ic" :class="c.kind" aria-hidden="true"><Icon :name="c.kind === 'invoice' ? 'ph:receipt' : 'ph:wallet'" /></span>
          <span class="grow min0">
            <span class="c-t truncate">{{ c.title }}</span>
            <span class="c-s truncate">{{ [c.subtitle, fdate(c.date)].filter(Boolean).join(' · ') }}</span>
          </span>
          <span class="c-amt">
            <span class="num">{{ eur(c.amount) }}</span>
            <span v-if="!multi && candDiff(c.amount) <= 0.01" class="exact">Mismo importe</span>
            <span v-else-if="!multi && candDiff(c.amount) <= 1.00" class="exact near">Dif. &lt; 1 €</span>
          </span>
          <span v-if="busy === `${c.kind}:${c.id}`" class="spinner" aria-hidden="true" />
        </button>
        <p v-if="!loading && !items.length" class="none">
          {{ income ? 'No hay facturas pendientes de cobro que coincidan.' : 'No hay gastos que coincidan.' }}
        </p>
      </div>
    </div>

    <template v-if="multi" #footer>
      <div class="multi-foot">
        <span class="multi-sum">
          <strong class="num">{{ eur(pickedSum) }}</strong>
          <span>de {{ eur(Math.abs(tx?.amount ?? 0)) }}</span>
          <span v-if="picked.length && !pickedFits" class="multi-gap">
            {{ pickedSum > Math.abs(tx?.amount ?? 0) ? 'Te pasas' : 'Faltan' }} {{ eur(candDiff(pickedSum)) }}
          </span>
        </span>
        <UiButton variant="primary" icon="ph:check-bold" :disabled="!pickedFits" :loading="busy === 'many'" @click="pickMany">
          Cobrar {{ picked.length || '' }} facturas
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.mm {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
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

.pos {
  color: var(--success);
}

.neg {
  color: var(--text);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 380px;
  overflow-y: auto;
  margin-inline: -4px;
  padding: 2px 4px;
}

.cand {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast);
}

.cand:hover:not(:disabled) {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.cand:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.c-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: var(--r-md);
  color: var(--brand);
  background: var(--brand-soft);
}

.c-ic.expense {
  color: var(--warning);
  background: var(--warning-soft);
}

.c-t {
  display: block;
  font-size: var(--text-sm);
  font-weight: 600;
}

.c-s {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.c-amt {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: var(--text-sm);
  font-weight: 600;
  white-space: nowrap;
}

.exact {
  font-size: 11px;
  font-weight: 600;
  color: var(--success);
}

.exact.near {
  color: var(--brand-text);
}

.search-row {
  display: flex;
  gap: var(--s-2);
}

@media (max-width: 640px) {
  .search-row .long {
    display: none;
  }
}

.cand:disabled:not(.on) {
  opacity: 0.45;
  cursor: default;
}

.multi-hint {
  margin-top: calc(-1 * var(--s-1));
  font-size: var(--text-xs);
  color: var(--text-3);
}

.cand.on {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.c-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  font-size: 22px;
  color: var(--text-3);
}

.cand.on .c-check {
  color: var(--brand);
}

.multi-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  width: 100%;
}

.multi-sum {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.multi-sum strong {
  color: var(--text);
}

.multi-gap {
  color: var(--warning);
  font-weight: 600;
}

.none {
  padding: var(--s-5);
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.min0 {
  min-width: 0;
}
</style>
