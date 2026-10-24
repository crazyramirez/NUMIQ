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
      <UiInput v-model="q" icon="ph:magnifying-glass" type="search" :placeholder="income ? 'Cliente o nº de factura' : 'Proveedor, concepto o nº'" aria-label="Buscar" />
      <div class="list" :aria-busy="loading">
        <template v-if="loading && !items.length">
          <div v-for="i in 4" :key="i" class="skeleton" style="height: 52px" />
        </template>
        <button
          v-for="c in items"
          :key="`${c.kind}:${c.id}`"
          type="button"
          class="cand"
          :disabled="!!busy"
          @click="pick(c)"
        >
          <span class="c-ic" :class="c.kind" aria-hidden="true"><Icon :name="c.kind === 'invoice' ? 'ph:receipt' : 'ph:wallet'" /></span>
          <span class="grow min0">
            <span class="c-t truncate">{{ c.title }}</span>
            <span class="c-s truncate">{{ [c.subtitle, fdate(c.date)].filter(Boolean).join(' · ') }}</span>
          </span>
          <span class="c-amt">
            <span class="num">{{ eur(c.amount) }}</span>
            <span v-if="candDiff(c.amount) <= 0.01" class="exact">Mismo importe</span>
            <span v-else-if="candDiff(c.amount) <= 1.00" class="exact near">Dif. &lt; 1 €</span>
          </span>
          <span v-if="busy === `${c.kind}:${c.id}`" class="spinner" aria-hidden="true" />
        </button>
        <p v-if="!loading && !items.length" class="none">
          {{ income ? 'No hay facturas pendientes de cobro que coincidan.' : 'No hay gastos que coincidan.' }}
        </p>
      </div>
    </div>
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
