<script setup lang="ts">
import type { MenuItem } from '~/components/ui/Menu.vue'
import type { CtxItem, CtxSpec } from '~/composables/useContextMenu'
import type { RecurringForm } from '~/components/recurring/Modal.vue'

/**
 * Recurrentes de un tipo: facturas que se emiten solas (Ventas › Recurrentes) o gastos fijos que se
 * registran solos (Gastos › Gastos fijos). Misma pantalla, cada una con lo suyo.
 */
const props = defineProps<{ kind: 'invoice' | 'expense' }>()
const isInvoice = computed(() => props.kind === 'invoice')

interface Row {
  id: number
  kind: 'invoice' | 'expense'
  name: string
  frequency: Frequency
  interval: number
  startDate: string
  nextDate: string
  endDate: string | null
  autoIssue: boolean
  autoSend: boolean
  active: boolean
  status: 'active' | 'paused' | 'finished'
  lastRunAt: string | null
  runCount: number
  lastError: string | null
  base: number
  total: number
  paid: boolean
  contact: { id: number, name: string, email: string | null } | null
  category: { id: number, name: string, icon: string | null, color: string | null } | null
  lastDocument: { type: 'sales' | 'expense', id: number, number: string | null, date: string, status: string } | null
}

useHead({ title: () => (isInvoice.value ? 'Facturas recurrentes · NUMIQ' : 'Gastos fijos · NUMIQ') })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const today = todayISO()

const { data, status: fetchStatus, refresh } = useFetch<Row[]>('/api/recurrings', { key: 'recurrings', lazy: true })
const all = computed(() => data.value ?? [])
const rows = computed(() => all.value.filter(r => r.kind === props.kind))
const firstLoad = computed(() => fetchStatus.value === 'pending' && !data.value)

// ─── Resumen ───

// Equivalente mensual del importe total (con impuestos)
const monthlyOf = (r: Row) => r.total * monthlyEquivalent(r.frequency, r.interval)
const live = computed(() => rows.value.filter(r => r.status === 'active'))
// El margen mira las dos caras: lo que entra por cuotas menos lo que sale en gastos fijos
const liveAll = computed(() => all.value.filter(r => r.status === 'active'))
const mrr = computed(() => round2(liveAll.value.filter(r => r.kind === 'invoice').reduce((s, r) => s + monthlyOf(r), 0)))
const fixed = computed(() => round2(liveAll.value.filter(r => r.kind === 'expense').reduce((s, r) => s + monthlyOf(r), 0)))
const margin = computed(() => round2(mrr.value - fixed.value))
const monthly = computed(() => (isInvoice.value ? mrr.value : fixed.value))

/** Todo lo que se generará en los próximos 30 días, agrupado por día */
const horizon = shiftDays(today, 30)
const upcoming = computed(() => {
  const out: Array<{ date: string, row: Row }> = []
  for (const r of live.value) {
    const end = r.endDate && r.endDate < horizon ? r.endDate : horizon
    for (const date of upcomingOccurrences(r.startDate, r.frequency, r.interval, r.nextDate, 40, end)) out.push({ date, row: r })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.row.name.localeCompare(b.row.name))
})
const upcomingDays = computed(() => {
  const map = new Map<string, Array<{ date: string, row: Row }>>()
  for (const u of upcoming.value) map.set(u.date, [...(map.get(u.date) ?? []), u])
  return [...map.entries()].map(([date, items]) => ({ date, items }))
})
const upcomingTotal = computed(() => round2(upcoming.value.reduce((s, u) => s + u.row.total, 0)))

// ─── Filtro ───

const filter = useQueryState('filtro', 'all', { allowed: ['all', 'active', 'paused'] })
const filterOptions = computed(() => [
  { value: 'all', label: isInvoice.value ? 'Todas' : 'Todos', count: rows.value.length || null },
  { value: 'active', label: isInvoice.value ? 'Activas' : 'Activos', count: rows.value.filter(r => r.status === 'active').length || null },
  { value: 'paused', label: 'En pausa', count: rows.value.filter(r => r.status !== 'active').length || null },
])
const shown = computed(() => rows.value.filter(r =>
  filter.value === 'all' ? true : filter.value === 'paused' ? r.status !== 'active' : r.status === 'active',
))
const { page, pages, items: paged, size: pageSize, total: pageTotal } = usePaged(shown, [filter], 'pagina')

function statusOf(r: Row) {
  if (r.status === 'finished') return { label: 'Terminado', tone: 'neutral' as const }
  if (r.status === 'paused') return { label: 'En pausa', tone: 'neutral' as const }
  if (r.lastError) return { label: 'Con aviso', tone: 'warning' as const }
  return { label: 'Activo', tone: 'success' as const }
}

function modeOf(r: Row) {
  if (!r.autoIssue) return { label: 'Con revisión', icon: 'ph:eye' }
  if (r.kind === 'expense') return { label: 'Automático', icon: 'ph:lightning' }
  return r.autoSend ? { label: 'Emite y envía', icon: 'ph:paper-plane-tilt' } : { label: 'Emite sola', icon: 'ph:lightning' }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const subtitleOf = (r: Row) => [r.contact?.name, r.kind === 'expense' ? r.category?.name : null].filter(Boolean).join(' · ') || (r.kind === 'invoice' ? 'Sin cliente' : 'Sin proveedor')
const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric' })
const shortMonth = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')
const weekday = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')
const docLink = (d: NonNullable<Row['lastDocument']>) => (d.type === 'sales' ? `/facturas/${d.id}` : `/gastos?ver=${d.id}`)

// ─── Modal: ?nuevo=factura|gasto, ?ver=ID, ?desde=FACTURA, ?gasto=GASTO ───

const modalOpen = ref(false)
const editId = ref<number | null>(null)
const prefill = ref<Partial<RecurringForm> | null>(null)

function openNew(kind: 'invoice' | 'expense', extra: Partial<RecurringForm> = {}) {
  editId.value = null
  prefill.value = { kind, ...extra }
  modalOpen.value = true
}

function openEdit(id: number) {
  editId.value = id
  prefill.value = null
  modalOpen.value = true
}

/** Primera fecha de la serie a partir de un documento: el mismo día, el mes que viene (o el siguiente que no haya pasado) */
function nextFrom(date: string) {
  let d = nextOccurrence(date, 'monthly', 1, date)
  while (d < today) d = nextOccurrence(date, 'monthly', 1, d)
  return d
}

interface SalesDoc {
  contactId: number | null
  issueDate: string
  dueDate: string | null
  irpfRate: number
  paymentMethod: string | null
  notes: string | null
  customerReference: string | null
  seriesId: number | null
  contact: { name: string } | null
  lines: Array<{ itemId: number | null, description: string, quantity: number, unitPrice: number, discountPct: number, vatRate: number }>
}

interface ExpenseDoc {
  kind: string
  supplierId: number | null
  supplier: { name: string } | null
  categoryId: number | null
  description: string | null
  issueDate: string
  irpfRate: number
  paymentMethod: string | null
  status: string
  deductiblePct: number
  vatDeductiblePct: number
  taxLines: Array<{ base: number, vatRate: number }>
}

async function fromInvoice(id: number) {
  try {
    const d = await $fetch<SalesDoc>(String(`/api/sales/${id}`))
    const first = d.lines[0]?.description.split('\n')[0] ?? 'Cuota'
    openNew('invoice', {
      name: d.contact ? `${d.contact.name} · ${first}`.slice(0, 160) : first.slice(0, 160),
      contactId: d.contactId,
      nextDate: nextFrom(d.issueDate),
      irpfRate: d.irpfRate,
      paymentMethod: d.paymentMethod ?? 'transfer',
      dueDays: d.dueDate ? Math.max(0, Math.round((new Date(`${d.dueDate}T12:00:00`).getTime() - new Date(`${d.issueDate}T12:00:00`).getTime()) / 86_400_000)) : null,
      notes: d.notes,
      customerReference: d.customerReference,
      seriesId: d.seriesId,
      lines: d.lines.map(l => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: l.vatRate })),
    })
  }
  catch (err) {
    toast.error('No se pudo leer la factura', errorMessage(err))
  }
}

async function fromExpense(id: number) {
  try {
    const e = await $fetch<ExpenseDoc>(String(`/api/expenses/${id}`))
    openNew('expense', {
      name: (e.supplier?.name ?? e.description ?? 'Gasto fijo').slice(0, 160),
      contactId: e.supplierId,
      categoryId: e.categoryId,
      description: e.description,
      expenseKind: e.kind,
      nextDate: nextFrom(e.issueDate),
      irpfRate: e.irpfRate,
      paymentMethod: e.paymentMethod ?? 'direct_debit',
      paid: e.status === 'paid',
      autoIssue: true,
      taxLines: e.taxLines.map(l => ({ base: l.base, vatRate: l.vatRate })),
      deductiblePct: e.deductiblePct,
      vatDeductiblePct: e.vatDeductiblePct,
    })
  }
  catch (err) {
    toast.error('No se pudo leer el gasto', errorMessage(err))
  }
}

watch(() => [route.query.nuevo, route.query.ver, route.query.desde, route.query.gasto], () => {
  const q = route.query
  // Cada tipo en su pantalla (también los enlaces de antes, que iban todos a /recurrentes)
  if (isInvoice.value && (q.gasto || q.nuevo === 'gasto')) {
    navigateTo({ path: '/gastos/fijos', query: q }, { replace: true })
    return
  }
  if (!isInvoice.value && (q.desde || q.nuevo === 'factura')) {
    navigateTo({ path: '/recurrentes', query: q }, { replace: true })
    return
  }
  if (q.ver) openEdit(Number(q.ver))
  else if (q.desde) fromInvoice(Number(q.desde))
  else if (q.gasto) fromExpense(Number(q.gasto))
  else if (q.nuevo) openNew(q.nuevo === 'gasto' ? 'expense' : 'invoice')
}, { immediate: true })

watch(modalOpen, (v) => {
  const q = route.query
  if (!v && (q.nuevo || q.ver || q.desde || q.gasto)) router.replace({ query: { ...q, nuevo: undefined, ver: undefined, desde: undefined, gasto: undefined } })
})

// ─── Acciones ───

const busy = ref<number | null>(null)
// Ruta como string: evita que la inferencia de rutas tipadas de $fetch se dispare con plantillas
const call = <T = unknown>(path: string, method: 'POST' | 'DELETE' = 'POST', body?: Record<string, unknown>) => $fetch<T>(path, { method, body })

async function act(r: Row, fn: () => Promise<unknown>, ok?: string) {
  busy.value = r.id
  try {
    await fn()
    if (ok) toast.success(ok)
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo completar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function runNow(r: Row) {
  const after = r.status === 'active' ? nextOccurrence(r.startDate, r.frequency, r.interval, r.nextDate) : null
  const what = r.kind === 'invoice' ? (r.autoIssue ? 'Se emitirá una factura' : 'Se creará un borrador de factura') : 'Se registrará un gasto'
  const ok = await confirm({
    title: `¿Generar ${r.kind === 'invoice' ? 'la factura' : 'el gasto'} ahora?`,
    body: after
      ? `${what} con fecha de hoy por ${eur(r.total)}. Se adelanta la del ${fdate(r.nextDate)} y la serie sigue el ${fdate(after)}.`
      : `${what} con fecha de hoy por ${eur(r.total)}. La programación no cambia.`,
    confirmLabel: 'Generar',
  })
  if (!ok) return
  busy.value = r.id
  try {
    const res = await call<{ type: 'sales' | 'expense', id: number, number: string | null, warning: string | null }>(`/api/recurrings/${r.id}/run`)
    const to = res.type === 'sales' ? `/facturas/${res.id}` : `/gastos?ver=${res.id}`
    toast.push({
      tone: res.warning ? 'info' : 'success',
      title: res.type === 'sales' ? (res.number ? `Factura ${res.number} emitida` : 'Borrador de factura creado') : 'Gasto registrado',
      body: res.warning ?? r.name,
      action: { label: res.type === 'sales' ? 'Ver factura' : 'Ver gasto', run: () => navigateTo(to) },
    }, 7000)
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo generar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function skip(r: Row) {
  const ok = await confirm({ title: '¿Saltar la próxima?', body: `No se generará la del ${fdate(r.nextDate)}. La serie sigue en la fecha siguiente.`, confirmLabel: 'Saltar' })
  if (ok) await act(r, () => call(`/api/recurrings/${r.id}/skip`), 'Fecha saltada')
}

const setActive = (r: Row, active: boolean) =>
  act(r, () => call(`/api/recurrings/${r.id}/active`, 'POST', { active }), active ? 'Recurrente reanudado' : 'Recurrente en pausa')

async function remove(r: Row) {
  const ok = await confirm({ title: `¿Eliminar «${r.name}»?`, body: 'Dejará de generarse. Las facturas y gastos ya creados se conservan.', confirmLabel: 'Eliminar', danger: true })
  if (ok) await act(r, () => call(`/api/recurrings/${r.id}`, 'DELETE'), 'Recurrente eliminado')
}

function menuOf(r: Row): MenuItem[] {
  const items: MenuItem[] = [
    { label: 'Editar', icon: 'ph:pencil-simple', onClick: () => openEdit(r.id) },
    { label: 'Generar ahora', icon: 'ph:lightning', onClick: () => runNow(r) },
  ]
  if (r.status === 'active') {
    items.push({ label: 'Saltar la próxima', icon: 'ph:skip-forward', onClick: () => skip(r) })
    items.push({ label: 'Pausar', icon: 'ph:pause', onClick: () => setActive(r, false) })
  }
  if (r.status === 'paused') items.push({ label: 'Reanudar', icon: 'ph:play', onClick: () => setActive(r, true) })
  if (r.lastDocument) items.push({ label: r.kind === 'invoice' ? 'Ver la última factura' : 'Ver el último gasto', icon: 'ph:arrow-square-out', to: docLink(r.lastDocument) })
  items.push({ divider: true }, { label: 'Eliminar', icon: 'ph:trash', danger: true, onClick: () => remove(r) })
  return items
}

// Clic derecho (o pulsación larga) en una fila o en el calendario: las mismas acciones, con quién y cuánto
function rowCtx(r: Row): CtxSpec {
  const items: CtxItem[] = [...menuOf(r)]
  const extra: CtxItem[] = []
  if (r.contact) {
    const path = r.kind === 'invoice' ? `/clientes/${r.contact.id}` : `/proveedores/${r.contact.id}`
    extra.push({ label: r.kind === 'invoice' ? 'Ficha del cliente' : 'Ficha del proveedor', sub: r.contact.name, icon: r.kind === 'invoice' ? 'ph:user' : 'ph:storefront', to: path })
  }
  extra.push({
    label: 'Copiar',
    icon: 'ph:copy',
    children: [
      { label: 'Nombre', sub: r.name, icon: 'ph:text-aa', onClick: () => copyText(r.name, 'Nombre') },
      { label: 'Importe', sub: eur(r.total), icon: 'ph:currency-eur', onClick: () => copyText(plainAmount(r.total), 'Importe') },
      ...(r.status !== 'finished' ? [{ label: 'Próxima fecha', sub: fdate(r.nextDate), icon: 'ph:calendar-dots', onClick: () => copyText(fdate(r.nextDate), 'Fecha') }] : []),
    ],
  })
  // Antes del separador de «Eliminar»
  items.splice(items.length - 2, 0, { divider: true }, ...extra)
  return {
    title: r.name,
    subtitle: `${eur(r.total)} · ${frequencyLabel(r.frequency, r.interval)}${r.status === 'active' ? ` · próxima ${fdate(r.nextDate)}` : r.status === 'paused' ? ' · en pausa' : ''}`,
    icon: r.kind === 'invoice' ? 'ph:receipt' : (r.category?.icon || 'ph:wallet'),
    items,
  }
}

const ALL_IDEAS = Object.freeze([
  { kind: 'invoice' as const, icon: 'ph:handshake', label: 'Iguala mensual', name: 'Iguala mensual' },
  { kind: 'invoice' as const, icon: 'ph:globe', label: 'Mantenimiento web', name: 'Mantenimiento web' },
  { kind: 'expense' as const, icon: 'ph:buildings', label: 'Alquiler', name: 'Alquiler del local' },
  { kind: 'expense' as const, icon: 'ph:identification-card', label: 'Cuota de autónomos', name: 'Cuota de autónomos' },
  { kind: 'expense' as const, icon: 'ph:cloud', label: 'Software', name: 'Suscripción de software' },
])
const IDEAS = computed(() => ALL_IDEAS.filter(i => i.kind === props.kind))
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>{{ isInvoice ? 'Facturas recurrentes' : 'Gastos fijos' }}</h1>
        <p class="sub">{{ isInvoice ? 'Cuotas, igualas y mantenimientos que se facturan solos en su fecha.' : 'Alquiler, cuota de autónomos, software… se registran solos cada mes.' }}</p>
      </div>
      <div class="page-actions">
        <UiButton variant="primary" icon="ph:plus-bold" compact @click="openNew(kind)">{{ isInvoice ? 'Factura recurrente' : 'Gasto fijo' }}</UiButton>
      </div>
    </header>

    <section v-if="rows.length" class="kpis rise" aria-label="Resumen mensual">
      <div class="kpi">
        <p class="eyebrow">{{ isInvoice ? 'Ingresos recurrentes' : 'Gastos fijos' }}</p>
        <p class="v num">{{ eur(monthly) }}<span class="per">/mes</span></p>
        <p class="s">{{ isInvoice ? plural(live.length, 'activa', 'activas') : plural(live.length, 'activo', 'activos') }} · importe total</p>
      </div>
      <div class="kpi">
        <p class="eyebrow">Margen recurrente</p>
        <p class="v num" :class="margin >= 0 ? 'pos' : 'neg'">{{ margin >= 0 ? '+' : '' }}{{ eur(margin) }}<span class="per">/mes</span></p>
        <p class="s">{{ fixed > 0 && mrr > 0 ? `Tus cuotas cubren el ${Math.round(Math.min(mrr / fixed, 9.99) * 100)} % de los gastos fijos` : 'Lo que entra menos lo que sale cada mes' }}</p>
      </div>
      <div class="kpi">
        <p class="eyebrow">Próximos 30 días</p>
        <p class="v num">{{ upcoming.length }}<span class="per">{{ isInvoice ? (upcoming.length === 1 ? ' factura' : ' facturas') : (upcoming.length === 1 ? ' gasto' : ' gastos') }}</span></p>
        <p class="s"><span :class="isInvoice ? 'pos' : 'neg'">{{ isInvoice ? '+' : '−' }}{{ eur(upcomingTotal, false) }}</span></p>
      </div>
    </section>

    <section v-if="upcomingDays.length" class="card timeline rise" style="--i: 1" aria-label="Calendario de los próximos 30 días">
      <header class="tl-head">
        <h2 class="section-title">Calendario</h2>
        <span class="muted small">Hasta el {{ fdate(horizon) }}</span>
      </header>
      <ol class="tl">
        <li v-for="d in upcomingDays" :key="d.date" class="tl-day" :class="{ today: d.date === today }">
          <div class="tl-date">
            <span class="wd">{{ d.date === today ? 'hoy' : weekday(d.date) }}</span>
            <span class="dn num">{{ shortDay(d.date) }}</span>
            <span class="mo">{{ shortMonth(d.date) }}</span>
          </div>
          <ul class="tl-items">
            <li v-for="u in d.items" :key="`${u.row.id}-${u.date}`">
              <button v-ctx="() => rowCtx(u.row)" type="button" class="tl-item" :class="u.row.kind" @click="openEdit(u.row.id)">
                <span class="truncate">{{ u.row.name }}</span>
                <span class="num">{{ u.row.kind === 'invoice' ? '+' : '−' }}{{ eur(u.row.total, false) }}</span>
              </button>
            </li>
          </ul>
        </li>
      </ol>
    </section>

    <UiCard padding="none" class="rise" style="--i: 2">
      <div v-if="rows.length" class="toolbar">
        <UiSegmented v-model="filter" :options="filterOptions" label="Filtrar" />
      </div>

      <div v-if="firstLoad" class="skeletons">
        <div v-for="i in 4" :key="i" class="sk-row">
          <div class="skeleton" style="width: 38px; height: 38px; border-radius: 11px" />
          <div class="grow">
            <div class="skeleton" style="width: 45%; height: 12px" />
            <div class="skeleton" style="width: 28%; height: 10px; margin-top: 8px" />
          </div>
          <div class="skeleton" style="width: 90px; height: 12px" />
        </div>
      </div>

      <UiEmpty
        v-else-if="!rows.length"
        icon="ph:arrows-clockwise"
        :title="isInvoice ? 'Lo que facturas cada mes, que se haga solo' : 'Lo que pagas cada mes, que se apunte solo'"
        :text="isInvoice ? 'Cuotas de mantenimiento, igualas o suscripciones: prográmalas una vez y NUMIQ genera cada factura en su fecha, como borrador o emitida y enviada.' : 'Alquiler, cuota de autónomos, gestoría o software: prográmalos una vez y NUMIQ registra cada gasto en su fecha, ya categorizado.'"
      >
        <UiButton variant="primary" :icon="isInvoice ? 'ph:receipt' : 'ph:wallet'" @click="openNew(kind)">{{ isInvoice ? 'Factura recurrente' : 'Gasto fijo' }}</UiButton>
      </UiEmpty>

      <UiEmpty v-else-if="!shown.length" compact icon="ph:funnel" title="Nada en este filtro">
        <UiButton @click="filter = 'all'">Ver todos</UiButton>
      </UiEmpty>

      <template v-else>
      <ul class="list">
        <li v-for="(r, i) in paged" :key="r.id" v-ctx="() => rowCtx(r)" class="item rise" :class="{ off: r.status !== 'active' }" :style="{ '--i': Math.min(i, 8) }">
          <button type="button" class="it-main" @click="openEdit(r.id)">
            <span class="it-ic" :class="r.kind" aria-hidden="true">
              <Icon :name="r.kind === 'invoice' ? 'ph:receipt' : (r.category?.icon || 'ph:wallet')" />
            </span>
            <span class="grow">
              <span class="it-name">
                <span class="truncate">{{ r.name }}</span>
                <UiBadge :tone="statusOf(r).tone" size="sm" dot>{{ statusOf(r).label }}</UiBadge>
              </span>
              <span class="it-sub truncate">
                {{ subtitleOf(r) }} · {{ frequencyLabel(r.frequency, r.interval) }}
              </span>
              <span v-if="r.lastError" class="it-err"><Icon name="ph:warning-circle-fill" aria-hidden="true" /> <span class="truncate">{{ r.lastError }}</span></span>
            </span>
            <span class="it-mode"><Icon :name="modeOf(r).icon" aria-hidden="true" /> {{ modeOf(r).label }}</span>
            <span class="it-next">
              <span class="eyebrow">{{ r.status === 'finished' ? 'Terminó' : 'Próxima' }}</span>
              <span v-if="r.status === 'finished'" class="num">{{ r.endDate ? fdate(r.endDate) : '—' }}</span>
              <template v-else>
                <span class="num">{{ fdate(r.nextDate) }}</span>
                <span class="rel" :class="{ late: r.nextDate < today }">{{ r.status === 'paused' ? 'en pausa' : relDays(r.nextDate) }}</span>
              </template>
            </span>
            <span class="it-amount">
              <span class="num" :class="r.kind === 'invoice' ? 'inc' : ''">{{ eur(r.total) }}</span>
              <span class="per num">{{ eur(monthlyOf(r), false) }}/mes</span>
            </span>
          </button>
          <div class="it-act">
            <span v-if="r.status === 'finished'" class="spacer" aria-hidden="true" />
            <UiButton
              v-else
              class="pause"
              size="sm"
              variant="ghost"
              square
              :icon="r.status === 'active' ? 'ph:pause' : 'ph:play'"
              :loading="busy === r.id"
              :aria-label="r.status === 'active' ? `Pausar ${r.name}` : `Reanudar ${r.name}`"
              :title="r.status === 'active' ? 'Pausar' : 'Reanudar'"
              @click="setActive(r, r.status !== 'active')"
            />
            <UiMenu :items="menuOf(r)" :width="230">
              <template #default="{ toggle }">
                <UiButton size="sm" variant="ghost" square icon="ph:dots-three-bold" :aria-label="`Más acciones de ${r.name}`" @click="toggle" />
              </template>
            </UiMenu>
          </div>
        </li>
      </ul>

      <!-- Móvil: nombre y concepto enteros; debajo, próxima fecha, estado e importe -->
      <ul class="mlist">
        <li v-for="r in paged" :key="r.id" v-ctx="() => rowCtx(r)" :class="{ off: r.status !== 'active' }">
          <UiListRow @open="openEdit(r.id)">
            <template #lead>
              <span class="it-ic" :class="r.kind" aria-hidden="true">
                <Icon :name="r.kind === 'invoice' ? 'ph:receipt' : (r.category?.icon || 'ph:wallet')" />
              </span>
            </template>
            <template #title>{{ r.name }}</template>
            <template #sub>{{ subtitleOf(r) }} · {{ frequencyLabel(r.frequency, r.interval) }}</template>
            <template v-if="r.lastError" #note>
              <span class="it-err"><Icon name="ph:warning-circle-fill" aria-hidden="true" /> {{ r.lastError }}</span>
            </template>
            <template #info>
              <template v-if="r.status === 'finished'">Terminó{{ r.endDate ? ` el ${fdate(r.endDate)}` : '' }}</template>
              <template v-else>
                Próxima {{ fdate(r.nextDate) }} · <span class="rel" :class="{ late: r.nextDate < today }">{{ r.status === 'paused' ? 'en pausa' : relDays(r.nextDate) }}</span>
              </template>
            </template>
            <template #status>
              <UiBadge :tone="statusOf(r).tone" size="sm" dot>{{ statusOf(r).label }}</UiBadge>
              <span class="it-mode"><Icon :name="modeOf(r).icon" aria-hidden="true" /> {{ modeOf(r).label }}</span>
            </template>
            <template #amount>
              {{ eur(r.total) }}
              <small v-if="Math.abs(monthlyOf(r) - r.total) > 0.005">{{ eur(monthlyOf(r), false) }}/mes</small>
            </template>
            <template #menu>
              <UiMenu :items="menuOf(r)" :width="230">
                <template #default="{ toggle }">
                  <UiButton size="sm" variant="ghost" square icon="ph:dots-three-bold" :aria-label="`Más acciones de ${r.name}`" @click="toggle" />
                </template>
              </UiMenu>
            </template>
          </UiListRow>
        </li>
      </ul>

      <UiPager v-model="page" v-model:size="pageSize" :pages="pages" :total="pageTotal" />
      </template>
    </UiCard>

    <section v-if="!firstLoad && !rows.length" class="ideas rise" style="--i: 3" aria-label="Ideas para empezar">
      <p class="eyebrow">Ideas para empezar</p>
      <div class="chips">
        <button v-for="idea in IDEAS" :key="idea.label" type="button" class="chip" @click="openNew(idea.kind, { name: idea.name })">
          <Icon :name="idea.icon" aria-hidden="true" /> {{ idea.label }}
        </button>
      </div>
    </section>

    <RecurringModal v-model="modalOpen" :recurring-id="editId" :prefill="prefill" @saved="refresh()" @deleted="refresh()" />
  </div>
</template>

<style scoped>
/* ─── Resumen ─── */

.kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-4);
  margin-bottom: var(--s-5);
}

.kpi {
  min-width: 0;
  padding: var(--s-4) var(--s-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.kpi .v {
  margin-top: 6px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.025em;
}

.per {
  margin-left: 2px;
  font-size: var(--text-sm);
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-3);
}

.kpi .s {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* ─── Calendario ─── */

.timeline {
  margin-bottom: var(--s-5);
  padding: var(--s-4) var(--s-5) var(--s-3);
}

.tl-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-3);
  margin-bottom: var(--s-3);
}

.small {
  font-size: var(--text-xs);
}

.tl {
  display: flex;
  gap: var(--s-3);
  margin: 0;
  padding: 2px 2px var(--s-3);
  list-style: none;
  overflow-x: auto;
  scroll-snap-type: x proximity;
}

.tl-day {
  display: flex;
  gap: 10px;
  flex: 0 0 auto;
  width: 272px;
  padding: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  scroll-snap-align: start;
}

.tl-day.today {
  border-color: color-mix(in srgb, var(--brand) 40%, var(--border));
  background: var(--brand-soft);
}

.tl-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 38px;
  flex-shrink: 0;
  line-height: 1.1;
}

.wd,
.mo {
  font-size: var(--text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
}

.dn {
  font-size: var(--text-xl);
  font-weight: 680;
}

.today .wd,
.today .dn,
.today .mo {
  color: var(--brand-text);
}

.tl-items {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  min-width: 0;
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tl-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  font-size: var(--text-xs);
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--c);
  border-radius: var(--r-sm);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.tl-item:hover {
  background: var(--surface-hover);
}

.tl-item.invoice {
  --c: var(--chart-income);
}

.tl-item.expense {
  --c: var(--chart-expense);
}

.tl-item .truncate {
  flex: 1;
  min-width: 0;
}

.tl-item .num {
  flex-shrink: 0;
  font-weight: 600;
}

/* ─── Lista ─── */

.toolbar {
  padding: var(--s-4) var(--s-5);
  border-bottom: 1px solid var(--border-subtle);
}

.skeletons {
  padding: var(--s-2) var(--s-5) var(--s-4);
}

.sk-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding-right: var(--s-4);
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--t-fast);
}

.item:last-child {
  border-bottom: 0;
}

.item:hover {
  background: var(--surface-hover);
}

.item.off .it-ic,
.item.off .it-amount {
  opacity: 0.55;
}

.mlist {
  display: none;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mlist li.off .it-ic,
.mlist li.off :deep(.lrow-amount) {
  opacity: 0.55;
}

.mlist .it-err {
  margin-top: 0;
}

.it-main {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 140px 130px 120px;
  align-items: center;
  gap: var(--s-4);
  flex: 1;
  min-width: 0;
  padding: 14px 0 14px var(--s-5);
  text-align: left;
}

.it-ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  font-size: 18px;
  border-radius: 11px;
}

.it-ic.invoice {
  color: var(--chart-income);
  background: color-mix(in srgb, var(--chart-income) 13%, transparent);
}

.it-ic.expense {
  color: var(--chart-expense);
  background: color-mix(in srgb, var(--chart-expense) 14%, transparent);
}

.it-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-weight: 590;
}

.it-sub {
  display: block;
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.it-err {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--warning);
}

.it-err svg {
  flex-shrink: 0;
}

.it-mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-2);
}

.it-mode svg {
  color: var(--text-3);
}

.it-next {
  display: flex;
  flex-direction: column;
  font-size: var(--text-sm);
}

.it-next .eyebrow {
  font-size: 10px;
}

.rel {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.rel.late {
  color: var(--warning);
}

.it-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-weight: 620;
}

.it-amount .inc {
  color: var(--text);
}

.it-amount .per {
  font-size: var(--text-xs);
  font-weight: 500;
}

.it-act {
  display: flex;
  align-items: center;
  gap: 2px;
}

.spacer {
  width: 32px;
}

/* ─── Ideas ─── */

.ideas {
  margin-top: var(--s-5);
  text-align: center;
}

.chips {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-top: var(--s-3);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  font-size: var(--text-sm);
  font-weight: 540;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  box-shadow: var(--shadow-xs);
  transition: border-color var(--t-fast), color var(--t-fast), transform var(--t-fast) var(--ease-out);
}

.chip:hover {
  color: var(--brand-text);
  border-color: color-mix(in srgb, var(--brand) 40%, var(--border));
  transform: translateY(-1px);
}

@media (max-width: 1279px) {
  .it-main {
    grid-template-columns: 40px minmax(0, 1fr) 130px 120px;
  }

  .it-mode {
    display: none;
  }
}

/* Las tres cifras en fila hasta el móvil; ahí 2 + 1 con la tercera a todo el ancho */
@media (max-width: 767px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
  }

  /* La tercera, sola en su fila: a todo el ancho */
  .kpi:nth-child(odd):last-child {
    grid-column: 1 / -1;
  }

  .kpi {
    padding: var(--s-3) var(--s-4);
  }

  .kpi .v {
    font-size: var(--text-xl);
  }

  .timeline {
    padding: var(--s-3) var(--s-4) var(--s-2);
  }

  .tl-day {
    width: 220px;
  }

  .toolbar {
    padding: var(--s-3) var(--s-4);
  }

  .list {
    display: none;
  }

  .mlist {
    display: block;
  }
}
</style>
