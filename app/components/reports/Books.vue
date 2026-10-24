<script setup lang="ts">
/** Libros registro de facturas emitidas y recibidas del periodo, con búsqueda y descarga en CSV */
const props = defineProps<{
  query: { year: number, quarter?: number, month?: number }
  /** Texto del periodo: 3T 2024, 2024… */
  label: string
}>()

const tab = ref('issued')
const search = ref('')

const bookQuery = computed(() => ({ ...props.query, type: tab.value }))
const { data, status, error, refresh } = await useFetch('/api/reports/book', { query: bookQuery, lazy: true })

interface Row {
  id: number
  number: string | null
  date: string
  name: string
  nif: string | null
  sub: string | null
  base: number
  vat: number
  irpf: number
  total: number
  rates: number[]
  to: string
  tag: string | null
}

const rows = computed<Row[]>(() => {
  const d = data.value
  if (!d) return []
  if (d.type === 'issued' && d.issued) {
    return d.issued.map(r => ({
      id: r.id, number: r.number, date: r.date, name: r.name, nif: r.nif, sub: null,
      base: r.base, vat: round2(r.vat + r.surcharge), irpf: r.irpf, total: r.total,
      rates: r.rates.map(g => g.rate), to: `/facturas/${r.id}`,
      tag: r.kind === 'rectifying' ? 'Rectificativa' : r.imported ? 'Importada' : null,
    }))
  }
  return (d.received ?? []).map(r => ({
    id: r.id, number: r.number, date: r.date, name: r.name, nif: r.nif, sub: r.category,
    base: r.base, vat: r.vat, irpf: r.irpf, total: r.total,
    rates: r.rates.map(g => g.rate), to: `/gastos?ver=${r.id}`,
    tag: r.kind === 'ticket' ? 'Ticket' : null,
  }))
})

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const filtered = computed(() => {
  const q = norm(search.value.trim())
  if (!q) return rows.value
  return rows.value.filter(r => norm(`${r.number ?? ''} ${r.name} ${r.nif ?? ''} ${r.sub ?? ''}`).includes(q))
})
const { page, pages, items: visible } = usePaged(filtered, [bookQuery, search])
const totals = computed(() => filtered.value.reduce((t, r) => ({
  base: round2(t.base + r.base), vat: round2(t.vat + r.vat), irpf: round2(t.irpf + r.irpf), total: round2(t.total + r.total),
}), { base: 0, vat: 0, irpf: 0, total: 0 }))

const qs = computed(() => new URLSearchParams(Object.entries(props.query).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString())
const csvUrl = computed(() => `/api/reports/export?${qs.value}&format=csv&book=${tab.value}`)
const party = computed(() => (tab.value === 'issued' ? 'Cliente' : 'Proveedor'))
const counts = computed(() => (data.value?.type === tab.value ? rows.value.length : null))
</script>

<template>
  <UiCard padding="none" class="books">
    <template #head>
      <h2 class="section-title row gap-2"><Icon name="ph:books" class="h-ic" aria-hidden="true" /> Libros registro</h2>
      <p class="subtitle">Facturas emitidas y recibidas · {{ label }}</p>
    </template>
    <template #actions>
      <UiButton size="sm" variant="ghost" icon="ph:file-csv" :to="csvUrl" external>CSV</UiButton>
    </template>

    <div class="toolbar">
      <UiSegmented
        v-model="tab"
        label="Libro"
        :options="[
          { value: 'issued', label: 'Emitidas', count: tab === 'issued' ? counts : null },
          { value: 'received', label: 'Recibidas', count: tab === 'received' ? counts : null },
        ]"
      />
      <UiInput v-model="search" class="search" icon="ph:magnifying-glass" :placeholder="`Buscar número, ${party.toLowerCase()} o NIF`" aria-label="Buscar en el libro" type="search" />
    </div>

    <div v-if="error && !data" class="state">
      <UiEmpty compact icon="ph:cloud-warning" title="No hemos podido cargar el libro" :text="errorMessage(error)">
        <UiButton size="sm" icon="ph:arrow-clockwise" @click="refresh()">Reintentar</UiButton>
      </UiEmpty>
    </div>

    <div v-else-if="!data || (status === 'pending' && data.type !== tab)" class="state sk" aria-busy="true">
      <div v-for="i in 6" :key="i" class="skeleton" style="height: 18px" />
    </div>

    <div v-else-if="!filtered.length" class="state">
      <UiEmpty
        compact
        :icon="search ? 'ph:magnifying-glass' : tab === 'issued' ? 'ph:receipt' : 'ph:wallet'"
        :title="search ? 'Nada coincide con la búsqueda' : tab === 'issued' ? 'Sin facturas emitidas' : 'Sin gastos registrados'"
        :text="search ? 'Prueba con otro número, nombre o NIF.' : `No hay ${tab === 'issued' ? 'facturas emitidas' : 'facturas recibidas ni gastos'} en ${label}.`"
      />
    </div>

    <div v-else class="table-wrap">
      <table class="table">
        <caption class="sr-only">Libro registro de facturas {{ tab === 'issued' ? 'emitidas' : 'recibidas' }} de {{ label }}</caption>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Número</th>
            <th scope="col">{{ party }}</th>
            <th scope="col" class="r">Base</th>
            <th scope="col" class="r">IVA</th>
            <th scope="col" class="r">IRPF</th>
            <th scope="col" class="r">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in visible" :key="r.id" class="clickable" @click="navigateTo(r.to)">
            <td class="num nowrap">{{ fdateShort(r.date) }}</td>
            <td class="nowrap">
              <NuxtLink :to="r.to" class="strong num" @click.stop>{{ r.number || '—' }}</NuxtLink>
              <span v-if="r.tag" class="sub">{{ r.tag }}</span>
            </td>
            <td class="party">
              <span class="strong truncate">{{ r.name }}</span>
              <span class="sub truncate">{{ [r.nif, r.sub].filter(Boolean).join(' · ') || 'Sin NIF' }}</span>
            </td>
            <td class="r num">{{ eur(r.base) }}</td>
            <td class="r num">
              {{ eur(r.vat) }}
              <span class="sub">{{ r.rates.map(x => `${num(x)} %`).join(' · ') }}</span>
            </td>
            <td class="r num muted">{{ r.irpf ? `−${eur(r.irpf)}` : '—' }}</td>
            <td class="r num strong">{{ eur(r.total) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">{{ filtered.length }} {{ tab === 'issued' ? 'factura' : 'registro' }}{{ filtered.length === 1 ? '' : 's' }}{{ search ? ' encontrados' : '' }}</td>
            <td class="r num">{{ eur(totals.base) }}</td>
            <td class="r num">{{ eur(totals.vat) }}</td>
            <td class="r num">{{ totals.irpf ? `−${eur(totals.irpf)}` : '—' }}</td>
            <td class="r num">{{ eur(totals.total) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <UiPager v-if="data && filtered.length" v-model="page" :pages="pages" />
  </UiCard>
</template>

<style scoped>
.h-ic {
  width: 17px;
  height: 17px;
  color: var(--text-3);
}

.subtitle {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--s-3);
  padding: 0 var(--s-5) var(--s-4);
}

.search {
  width: 300px;
  max-width: 100%;
}

.state {
  padding: var(--s-2) var(--s-5) var(--s-5);
}

.sk {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: var(--s-4);
}

.table-wrap {
  border-top: 1px solid var(--border-subtle);
}

.nowrap {
  white-space: nowrap;
}

.party {
  max-width: 280px;
}

.party .strong {
  display: block;
}

.table td .sub {
  white-space: nowrap;
}

@media (max-width: 767px) {
  .toolbar {
    padding: 0 var(--s-4) var(--s-4);
  }

  .search {
    width: 100%;
  }

  .state {
    padding: var(--s-2) var(--s-4) var(--s-4);
  }

  .party {
    max-width: 180px;
  }
}
</style>
