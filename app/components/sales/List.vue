<script setup lang="ts">
import type { BulkAction } from '~/components/ui/BulkBar.vue'
import type { MenuItem } from '~/components/ui/Menu.vue'
import type { SalesInvoiceLink } from '#shared/types/sales-links'
interface Row {
  id: number
  kind: string
  status: string
  number: string | null
  issueDate: string
  dueDate: string | null
  contactId: number | null
  contactName: string | null
  contactLogoUrl: string | null
  taxBase: number
  vatTotal: number
  irpfTotal: number
  total: number
  paidTotal: number
  viewedAt?: string | null
  overdue: boolean
  invoices: SalesInvoiceLink[]
  conceptPreview?: string | null
  descriptionText?: string | null
  linesSummary?: string | null
}

const props = defineProps<{ kind: 'invoice' | 'quote' }>()
const { verifactu } = useMe()
const route = useRoute()
const router = useRouter()
const isQuote = computed(() => props.kind === 'quote')
const base = computed(() => (isQuote.value ? '/presupuestos' : '/facturas'))

const status = ref(String(route.query.estado ?? 'all'))
const q = ref('')
const period = ref(String(route.query.periodo ?? 'all'))
const debouncedQ = refDebounced(q, 250)

watch([status, period], () => router.replace({ query: { ...route.query, estado: status.value === 'all' ? undefined : status.value, periodo: period.value === 'all' ? undefined : period.value } }))

const range = computed(() => {
  const now = new Date()
  const y = now.getFullYear()
  const qn = quarterOf(now)
  if (period.value === 'quarter') return quarterRange(y, qn)
  if (period.value === 'prev-quarter') return qn === 1 ? quarterRange(y - 1, 4) : quarterRange(y, (qn - 1) as Quarter)
  if (period.value === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` }
  if (period.value === 'prev-year') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  return { from: undefined, to: undefined }
})

const { data: rows, status: loadState, refresh } = useFetch<Row[]>('/api/sales', {
  query: computed(() => ({ kind: props.kind, status: status.value, q: debouncedQ.value || undefined, from: range.value.from, to: range.value.to })),
  lazy: true,
})

// Contadores de las pestañas: sobre el periodo, sin el filtro de estado
const { data: all, refresh: refreshCounts } = useFetch<Row[]>('/api/sales', {
  query: computed(() => ({ kind: props.kind, q: debouncedQ.value || undefined, from: range.value.from, to: range.value.to })),
  lazy: true,
  key: `sales-counts-${props.kind}`,
})

const counts = computed(() => {
  const r = all.value ?? []
  const open = r.filter(x => ['issued', 'sent', 'partial'].includes(x.status))
  return {
    draft: r.filter(x => x.status === 'draft').length,
    open: open.length,
    overdue: r.filter(x => x.overdue).length,
    paid: r.filter(x => x.status === 'paid').length,
    accepted: r.filter(x => ['accepted', 'invoiced'].includes(x.status)).length,
    rejected: r.filter(x => ['rejected', 'expired'].includes(x.status)).length,
  }
})

const tabs = computed(() => isQuote.value
  ? [
      { value: 'all', label: 'Todos' },
      { value: 'draft', label: 'Borradores', count: counts.value.draft },
      { value: 'open', label: 'Pendientes', count: counts.value.open },
      { value: 'accepted', label: 'Aceptados', count: counts.value.accepted },
      { value: 'rejected', label: 'Rechazados', count: counts.value.rejected },
    ]
  : [
      { value: 'all', label: 'Todas' },
      { value: 'draft', label: 'Borradores', count: counts.value.draft },
      { value: 'open', label: 'Pendientes', count: counts.value.open },
      { value: 'overdue', label: 'Vencidas', count: counts.value.overdue },
      { value: 'paid', label: 'Cobradas', count: counts.value.paid },
    ])

const PERIODS = [
  { value: 'all', label: 'Siempre' },
  { value: 'quarter', label: 'Este trimestre' },
  { value: 'prev-quarter', label: 'Trimestre anterior' },
  { value: 'year', label: 'Este año' },
  { value: 'prev-year', label: 'Año anterior' },
]

// Presupuestos y proformas: base imponible (rotulada como tal); facturas: total con impuestos
const amountOf = (x: { taxBase: number, total: number }) => (isQuote.value ? x.taxBase : x.total)
// «Vista»: el cliente abrió el enlace y aún no está cobrada ni cerrada (cuando más útil es saberlo)
const seen = (r: Row) => !!r.viewedAt && !['paid', 'cancelled', 'invoiced', 'rejected', 'accepted', 'draft'].includes(r.status)

const summary = computed(() => {
  const r = (all.value ?? []).filter(x => x.status !== 'draft' && x.status !== 'cancelled')
  return {
    base: r.reduce((s, x) => s + x.taxBase, 0),
    total: r.reduce((s, x) => s + x.total, 0),
    pending: r.filter(x => ['issued', 'sent', 'partial'].includes(x.status)).reduce((s, x) => s + x.total - x.paidTotal, 0),
    overdue: r.filter(x => x.overdue).reduce((s, x) => s + x.total - x.paidTotal, 0),
    accepted: r.filter(x => ['accepted', 'invoiced'].includes(x.status)).reduce((s, x) => s + amountOf(x), 0),
    count: r.length,
  }
})

const payDoc = ref<Row | null>(null)
const payOpen = computed({ get: () => !!payDoc.value, set: (v) => { if (!v) payDoc.value = null } })

const toast = useToast()
const { confirm } = useConfirm()

function open(r: Row) {
  navigateTo(`${base.value}/${r.id}`)
}

async function removeDoc(r: Row) {
  const isQ = isQuote.value
  const hasPayments = (r.paidTotal ?? 0) > 0
  const ok = await confirm({
    title: `¿Eliminar ${isQ ? 'el presupuesto' : 'la factura'} ${r.number ?? 'borrador'} definitivamente?`,
    body: `Se borrará de forma permanente de la base de datos junto con sus líneas y cobros.${hasPayments ? ' Los movimientos bancarios conciliados quedarán de nuevo pendientes de conciliar.' : ''}`,
    confirmLabel: 'Eliminar definitivamente',
    danger: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/sales/${r.id}`, { method: 'DELETE' })
    toast.success(isQ ? 'Presupuesto eliminado' : 'Factura eliminada')
    refresh()
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
}

function rowMenu(r: Row): MenuItem[] {
  const isQ = isQuote.value
  const items: MenuItem[] = [
    { label: 'Ver detalle', icon: 'ph:eye', to: `${base.value}/${r.id}` },
    { label: 'Editar', icon: 'ph:pencil-simple', to: `${base.value}/${r.id}/editar` },
  ]
  // También aquí: en pantallas medianas el botón «Cobrar» de la fila no se muestra
  if (!isQ && ['issued', 'sent', 'partial'].includes(r.status)) {
    items.push({ label: 'Registrar cobro', icon: 'ph:hand-coins', onClick: () => { payDoc.value = r } })
  }
  if (r.status !== 'draft') {
    items.push({ label: 'Descargar PDF', icon: 'ph:download-simple', onClick: () => window.open(`/api/sales/${r.id}/pdf?download=1`, '_blank') })
  }
  items.push({ divider: true }, { label: isQ ? 'Eliminar presupuesto' : 'Eliminar factura', icon: 'ph:trash', danger: true, onClick: () => removeDoc(r) })
  return items
}

// ─── Páginas de 25 y selección (de la página a la vista): eliminar muchos de una vez ───

const list = computed(() => rows.value ?? [])
const { page, pages, items: shown } = usePaged(list, [status, debouncedQ, period])
const { selected, selectedSet, selectedRows, selecting, allSelected, toggle: pick, toggleAll, clear } = useSelection(shown)
const busy = ref(false)
const selectedTotal = computed(() => selectedRows.value.reduce((s, r) => s + amountOf(r), 0))
const noun = (n: number) => (isQuote.value ? (n === 1 ? 'presupuesto' : 'presupuestos') : (n === 1 ? 'factura' : 'facturas'))

async function deleteBulk() {
  const picked = selectedRows.value
  const n = picked.length
  if (!n) return
  const issued = isQuote.value ? 0 : picked.filter(r => r.status !== 'draft').length
  const charged = picked.filter(r => r.paidTotal > 0).length
  const ok = await confirm({
    title: `¿Eliminar ${n} ${noun(n)} definitivamente?`,
    body: [
      `Se borrarán con sus líneas${isQuote.value ? '' : ' y cobros'}.${charged ? ' Los movimientos del banco conciliados con ellas volverán a quedar pendientes.' : ''}`,
      issued ? `${issued === n ? (n === 1 ? 'Ya está emitida' : 'Todas están emitidas') : `${issued} ya ${issued === 1 ? 'está emitida' : 'están emitidas'}`}: borrarlas deja huecos en la numeración y puede descuadrar trimestres ya presentados. Para anular una factura emitida, lo correcto es una rectificativa.` : '',
      'Clientes, rectificativas y presupuestos relacionados se conservan: solo pierden el enlace. Esta acción no se puede deshacer.',
    ].filter(Boolean).join('\n\n'),
    confirmLabel: `Eliminar ${n}`,
    danger: true,
  })
  if (!ok) return
  busy.value = true
  try {
    const res = await $fetch<{ deleted: number, blocked: Array<{ id: number, number: string | null }> }>('/api/sales/bulk', { method: 'DELETE', body: { ids: picked.map(r => r.id) } })
    if (res.deleted) toast.success(`${res.deleted} ${noun(res.deleted)} ${isQuote.value ? (res.deleted === 1 ? 'eliminado' : 'eliminados') : (res.deleted === 1 ? 'eliminada' : 'eliminadas')}`)
    if (res.blocked.length) {
      toast.error(
        `${res.blocked.length} ${res.blocked.length === 1 ? 'no se pudo eliminar' : 'no se pudieron eliminar'}`,
        `${res.blocked.map(b => b.number).join(', ')}: registradas en VeriFactu. Anúlalas con una rectificativa.`,
      )
    }
    clear()
  }
  catch (err) {
    toast.error('No se pudieron eliminar', errorMessage(err))
  }
  finally {
    busy.value = false
    await Promise.all([refresh(), refreshCounts()])
  }
}

const bulkActions = computed<BulkAction[]>(() => [
  { label: 'Eliminar', icon: 'ph:trash', tone: 'danger', onClick: deleteBulk },
])
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>{{ isQuote ? 'Presupuestos' : 'Facturas' }}</h1>
        <p class="sub">{{ isQuote ? 'Ofertas a clientes: conviértelas en factura con un clic.' : `Emitidas con numeración correlativa${verifactu ? ' y registro VeriFactu' : ''}.` }}</p>
      </div>
      <div class="page-actions">
        <UiButton variant="primary" icon="ph:plus-bold" compact :to="`${base}/${isQuote ? 'nuevo' : 'nueva'}`">{{ isQuote ? 'Nuevo presupuesto' : 'Nueva factura' }}</UiButton>
      </div>
    </header>

    <div class="stats">
      <div class="stat card rise" style="--i: 0">
        <span class="s-label">{{ isQuote ? 'Presupuestado' : 'Total facturado' }}</span>
        <strong class="num">{{ eur(isQuote ? summary.base : summary.total) }}</strong>
        <span class="s-sub">{{ summary.count }} {{ isQuote ? 'presupuestos · base imponible' : 'documentos · importe total' }}</span>
      </div>
      <div v-if="!isQuote" class="stat card rise" style="--i: 1">
        <span class="s-label">Pendiente de cobro</span>
        <strong class="num">{{ eur(summary.pending) }}</strong>
        <span class="s-sub">{{ counts.open }} abiertas</span>
      </div>
      <div v-if="!isQuote" class="stat card rise" :class="{ danger: summary.overdue > 0 }" style="--i: 2">
        <span class="s-label">Vencido</span>
        <strong class="num">{{ eur(summary.overdue) }}</strong>
        <span class="s-sub">{{ counts.overdue ? `${counts.overdue} sin cobrar fuera de plazo` : 'Todo al día' }}</span>
      </div>
      <div v-if="isQuote" class="stat card rise" style="--i: 1">
        <span class="s-label">Aceptado</span>
        <strong class="num">{{ eur(summary.accepted) }}</strong>
        <span class="s-sub">{{ counts.accepted }} {{ counts.accepted === 1 ? 'aceptado' : 'aceptados' }} · base imponible</span>
      </div>
      <div v-if="isQuote" class="stat card rise" style="--i: 2">
        <span class="s-label">Tasa de aceptación</span>
        <strong class="num">{{ counts.accepted + counts.rejected ? pct((counts.accepted / (counts.accepted + counts.rejected)) * 100) : '—' }}</strong>
        <span class="s-sub">de los presupuestos resueltos</span>
      </div>
    </div>

    <div class="toolbar">
      <UiSegmented v-model="status" :options="tabs" label="Estado" />
      <div class="tools-right">
        <div class="control search">
          <Icon name="ph:magnifying-glass" />
          <input v-model="q" type="search" placeholder="Número, cliente, NIF…" aria-label="Buscar">
        </div>
        <select v-model="period" class="control period" aria-label="Periodo">
          <option v-for="p in PERIODS" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
      </div>
      <UiButton
        v-if="list.length"
        class="sel-toggle"
        :variant="selecting ? 'primary' : 'secondary'"
        :icon="selecting ? 'ph:x' : 'ph:check-square'"
        @click="selecting ? clear() : (selecting = true)"
      >
        {{ selecting ? 'Cancelar selección' : 'Seleccionar' }}
      </UiButton>
    </div>

    <div class="card list">
      <div v-if="loadState === 'pending' && !rows" class="sk">
        <div v-for="i in 6" :key="i" class="sk-row"><span class="skeleton" style="width: 14%" /><span class="skeleton" style="width: 30%" /><span class="skeleton" style="width: 12%" /><span class="skeleton" style="width: 10%" /></div>
      </div>

      <UiEmpty
        v-else-if="!rows?.length"
        :icon="isQuote ? 'ph:file-text' : 'ph:receipt'"
        :title="q || status !== 'all' || period !== 'all' ? 'Nada con estos filtros' : isQuote ? 'Aún no hay presupuestos' : 'Emite tu primera factura'"
        :text="q || status !== 'all' || period !== 'all' ? 'Prueba con otra búsqueda o cambia el periodo.' : isQuote ? 'Envía ofertas profesionales y conviértelas en factura cuando el cliente acepte.' : 'En menos de un minuto: elige cliente, añade conceptos de tu catálogo y emite. Los impuestos se calculan solos.'"
      >
        <UiButton v-if="!(q || status !== 'all' || period !== 'all')" variant="primary" icon="ph:plus-bold" :to="`${base}/${isQuote ? 'nuevo' : 'nueva'}`">{{ isQuote ? 'Crear presupuesto' : 'Crear factura' }}</UiButton>
      </UiEmpty>

      <template v-else>
        <div class="table-wrap desk">
          <table class="table">
            <thead>
              <tr>
                <th class="pick">
                  <input
                    type="checkbox"
                    :checked="allSelected"
                    :indeterminate="!!selected.length && !allSelected"
                    :aria-label="allSelected ? 'Quitar la selección' : 'Seleccionar todos'"
                    @change="toggleAll"
                  >
                </th>
                <th class="col-num">Número</th>
                <th class="col-client">Cliente</th>
                <th class="col-date">Fecha</th>
                <th class="col-due">{{ isQuote ? 'Válido hasta' : 'Vencimiento' }}</th>
                <th class="r col-total">{{ isQuote ? 'Base imponible' : 'Total' }}</th>
                <th class="col-status">Estado</th>
                <th class="act-col"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in shown" :key="r.id" class="clickable" :class="{ sel: selectedSet.has(r.id) }" tabindex="0" @click="open(r)" @keydown.enter.self="open(r)">
                <td class="pick" @click.stop="pick(r.id, $event)">
                  <input
                    type="checkbox"
                    :checked="selectedSet.has(r.id)"
                    :aria-label="`Seleccionar ${r.number ?? 'borrador'} de ${r.contactName ?? 'sin cliente'}`"
                    @click.stop="pick(r.id, $event)"
                  >
                </td>
                <td class="col-num"><span class="num strong docnum" :class="{ draft: !r.number }">{{ r.number ?? 'Borrador' }}</span><span v-if="r.kind === 'rectifying'" class="sub">Rectificativa</span></td>
                <td class="client-td">
                  <div class="client-cell">
                    <div class="client-head">
                      <UiAvatar :name="r.contactName ?? '—'" :size="24" :src="r.contactLogoUrl" contain />
                      <span class="truncate cname">{{ r.contactName ?? 'Sin cliente' }}</span>
                    </div>
                    <p v-if="r.conceptPreview" class="doc-desc" :title="r.conceptPreview">
                      {{ r.conceptPreview }}
                    </p>
                  </div>
                </td>
                <td class="col-date muted">
                  {{ fdate(r.issueDate) }}
                  <!-- Sin columna de vencimiento (pantallas medianas), el plazo va debajo de la fecha -->
                  <span v-if="r.dueDate" class="sub due-sub" :class="{ late: r.overdue }">
                    <template v-if="isQuote">Hasta {{ fdate(r.dueDate) }}</template>
                    <template v-else-if="['issued', 'sent', 'partial'].includes(r.status)">{{ r.overdue ? 'Venció' : 'Vence' }} {{ relDays(r.dueDate) }}</template>
                  </span>
                </td>
                <td class="col-due" :class="r.overdue ? 'late' : 'muted'">
                  <template v-if="r.dueDate && ['issued', 'sent', 'partial'].includes(r.status)">{{ relDays(r.dueDate) }}</template>
                  <template v-else>{{ fdate(r.dueDate) }}</template>
                </td>
                <td class="r col-total num strong">{{ eur(amountOf(r)) }}<span v-if="r.status === 'partial'" class="sub">pend. {{ eur(r.total - r.paidTotal) }}</span></td>
                <td class="col-status">
                  <span class="st-wrap">
                    <UiBadge v-bind="{ tone: salesStatus(r.kind, r.status, r.overdue).tone }" dot>{{ salesStatus(r.kind, r.status, r.overdue).label }}</UiBadge>
                    <Icon v-if="seen(r)" name="ph:eye-fill" class="seen" :title="`Vista por el cliente ${relTime(r.viewedAt!)}`" :aria-label="`Vista por el cliente ${relTime(r.viewedAt!)}`" />
                  </span>
                </td>
                <td class="act-col" @click.stop @keydown.stop>
                  <div class="row-acts">
                    <SalesInvoiceLinks v-if="isQuote && r.invoices.length" :invoices="r.invoices" />
                    <UiButton v-if="!isQuote && ['issued', 'sent', 'partial'].includes(r.status)" size="sm" variant="ghost" icon="ph:hand-coins" class="quick" @click="payDoc = r">Cobrar</UiButton>
                    <UiMenu :items="rowMenu(r)" :width="190">
                      <template #default="{ toggle }">
                        <UiButton variant="ghost" size="sm" square icon="ph:dots-three-bold" :aria-label="`Acciones de ${r.number ?? 'borrador'}`" @click="toggle" />
                      </template>
                    </UiMenu>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ul class="mobile">
          <li v-for="r in shown" :key="r.id">
            <UiListRow
              :to="`${base}/${r.id}`"
              :selecting="selecting"
              :selected="selectedSet.has(r.id)"
              @toggle="pick(r.id)"
            >
              <template #lead>
                <UiAvatar :name="r.contactName ?? '—'" :size="38" :src="r.contactLogoUrl" contain />
              </template>
              <template #title>{{ r.contactName ?? 'Sin cliente' }}</template>
              <template v-if="r.conceptPreview" #sub>{{ r.conceptPreview }}</template>
              <template #info>
                <template v-if="r.number"><span class="mono">{{ r.number }}</span> · </template>{{ fdate(r.issueDate) }}
              </template>
              <template #status>
                <UiBadge :tone="salesStatus(r.kind, r.status, r.overdue).tone" size="sm" dot>{{ salesStatus(r.kind, r.status, r.overdue).label }}</UiBadge>
                <span v-if="seen(r)" class="seen-m"><Icon name="ph:eye-fill" aria-hidden="true" /> Vista</span>
              </template>
              <template #amount>
                {{ eur(amountOf(r)) }}
                <small v-if="isQuote">base imponible</small>
                <small v-else-if="r.status === 'partial'">pend. {{ eur(r.total - r.paidTotal) }}</small>
              </template>
              <template #menu>
                <UiMenu :items="rowMenu(r)" :width="190">
                  <template #default="{ toggle }">
                    <UiButton variant="ghost" size="sm" square icon="ph:dots-three-bold" :aria-label="`Acciones de ${r.number ?? 'borrador'}`" @click="toggle" />
                  </template>
                </UiMenu>
              </template>
              <template v-if="isQuote && r.invoices.length" #after>
                <div class="m-invoices">
                  <SalesInvoiceLinks :invoices="r.invoices" />
                </div>
              </template>
            </UiListRow>
          </li>
        </ul>

        <UiPager v-model="page" :pages="pages" />
      </template>
    </div>

    <UiBulkBar
      :count="selected.length"
      :total="shown.length"
      :title="`${noun(selected.length)} ${isQuote ? (selected.length === 1 ? 'seleccionado' : 'seleccionados') : (selected.length === 1 ? 'seleccionada' : 'seleccionadas')}`"
      :sub="isQuote ? `${eur(selectedTotal)} de base imponible` : eur(selectedTotal)"
      :actions="bulkActions"
      :busy="busy"
      :label="`Acciones con ${isQuote ? 'los presupuestos seleccionados' : 'las facturas seleccionadas'}`"
      @all="toggleAll"
      @clear="clear"
    />

    <SalesPaymentModal v-if="payDoc" v-model="payOpen" :document-id="payDoc.id" :remaining="round2(payDoc.total - payDoc.paidTotal)" :number="payDoc.number" @saved="refresh" />
  </div>
</template>

<style scoped>
/* La tabla se adapta al ancho real del contenido (con la barra lateral, una tableta deja ~870 px):
   ≥ 1000 completa · 760–999 sin columna de vencimiento · < 760 filas de móvil */
.page {
  container: sales / inline-size;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-4);
  margin-bottom: var(--s-6);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--s-4) var(--s-5);
}

.s-label {
  font-size: var(--text-sm);
  color: var(--text-3);
  font-weight: 520;
}

.stat strong {
  margin-top: 4px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.03em;
}

.s-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.stat.danger strong {
  color: var(--danger);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  flex-wrap: wrap;
  margin-bottom: var(--s-4);
}

.tools-right {
  display: flex;
  gap: var(--s-2);
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 260px;
  color: var(--text-3);
}

.search input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: 0;
  outline: none;
  background: none;
  color: var(--text);
}

.period {
  width: auto;
}

.list {
  overflow: hidden;
}

.strong {
  font-weight: 600;
  color: var(--text);
}

.draft {
  color: var(--text-3);
  font-style: italic;
  font-family: var(--font-sans);
  font-weight: 500;
}

.col-num,
.col-date,
.col-due,
.col-total,
.col-status {
  white-space: nowrap;
  width: 1%;
}

.st-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.seen {
  width: 15px;
  height: 15px;
  color: var(--info);
}

.seen-m {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--info);
}

.col-client {
  width: auto;
}

.client-td {
  max-width: 0;
  width: auto;
}

.client-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  width: 100%;
}

.client-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.cname {
  font-weight: 540;
  min-width: 0;
  flex: 1;
}

.doc-desc {
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--text-3);
  padding-left: 32px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.late,
.sub.late {
  color: var(--danger);
  font-weight: 560;
}

.due-sub {
  display: none;
}

.act-col {
  width: 120px;
  text-align: right;
  padding-right: var(--s-3);
}

.row-acts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--s-1);
}

.quick {
  opacity: 0;
  transition: opacity var(--t-fast);
}

tr:hover .quick,
.quick:focus-visible {
  opacity: 1;
}

.sk {
  padding: var(--s-2) var(--s-5);
}

.sk-row {
  display: flex;
  gap: var(--s-6);
  padding: 16px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.sk-row .skeleton {
  height: 14px;
}

.mobile {
  display: none;
  margin: 0;
  padding: 0;
  list-style: none;
}

.m-invoices {
  display: flex;
  justify-content: flex-end;
  padding: 0 var(--s-4) 12px;
}

.small {
  font-size: var(--text-xs);
}

/* ─── Selección ─── */

.pick {
  width: 1%;
  padding-right: 0 !important;
  cursor: default;
}

input[type='checkbox'] {
  display: block;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--brand);
  cursor: pointer;
}

.table tbody tr.sel {
  background: color-mix(in srgb, var(--brand) 6%, transparent);
}

.table tbody tr.sel:hover {
  background: color-mix(in srgb, var(--brand) 9%, transparent);
}

.sel-toggle {
  display: none;
}

@container sales (max-width: 999px) {
  .col-due,
  .quick {
    display: none;
  }

  .due-sub {
    display: block;
  }

  .act-col {
    width: 1%;
  }
}

@container sales (max-width: 759px) {
  .desk {
    display: none;
  }

  .mobile {
    display: block;
  }

  .toolbar :deep(.seg) {
    width: 100%;
  }

  .sel-toggle {
    display: inline-flex;
  }
}

@media (max-width: 900px) {
  .tools-right {
    width: 100%;
  }

  .search {
    flex: 1;
    width: auto;
    min-width: 0;
  }

  .sel-toggle {
    width: 100%;
  }
}

@media (max-width: 767px) {
  /* Buscador y periodo a todo el ancho, uno debajo del otro (como en Gastos): el texto de ayuda se lee entero */
  .tools-right {
    flex-wrap: wrap;
  }

  .search,
  .period {
    flex: 1 1 100%;
  }

  .stats {
    grid-template-columns: 1fr 1fr;
    gap: var(--s-3);
  }

  .stats .stat:first-child {
    grid-column: span 2;
  }

  .stat strong {
    font-size: var(--text-xl);
  }
}
</style>
