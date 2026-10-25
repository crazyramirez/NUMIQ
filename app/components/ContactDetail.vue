<script setup lang="ts">
import type { MenuItem } from '~/components/ui/Menu.vue'
import type { CtxItem, CtxSpec } from '~/composables/useContextMenu'

/** Ficha de cliente o proveedor: cifras, documentos y datos */
const props = defineProps<{ role: 'client' | 'supplier', id: number }>()

interface DocRow {
  id: number
  kind: string
  status: string
  number: string | null
  issueDate: string
  dueDate: string | null
  taxBase: number
  total: number
  paidTotal: number
  conceptPreview: string | null
}

interface ExpenseRow {
  id: number
  number: string | null
  issueDate: string
  description: string | null
  total: number
  status: string
}

interface ContactFull {
  id: number
  isClient: boolean
  isSupplier: boolean
  kind: 'company' | 'person'
  name: string
  tradeName: string | null
  contactPerson: string | null
  nif: string | null
  nifType: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string
  iban: string | null
  paymentTermsDays: number | null
  irpfRate: number | null
  equivalenceSurcharge: boolean
  notes: string | null
  logoUrl: string | null
  createdAt: string
  documents: DocRow[]
  expenses: ExpenseRow[]
  salesCount?: number
  invoicesCount?: number
  quotesCount?: number
  expensesCount?: number
}

const toast = useToast()
const { confirm } = useConfirm()
const isClient = computed(() => props.role === 'client')
const listPath = computed(() => (isClient.value ? '/clientes' : '/proveedores'))
const { href: listHref, back, label: backText } = useBackTo(listPath)

const { data: c, status, refresh, error } = useFetch<ContactFull>(() => `/api/contacts/${props.id}`, {
  key: `contact-${props.id}`,
  lazy: true,
})

useHead({ title: () => `${c.value?.name ?? (isClient.value ? 'Cliente' : 'Proveedor')} · NUMIQ` })

// Sin plazo propio, al cliente se le aplica el de la empresa al facturar
const { data: company } = useFetch<{ paymentTermsDays: number | null }>('/api/companies/current', { lazy: true })
const paymentTerms = computed(() => c.value?.paymentTermsDays ?? (c.value?.isClient ? (company.value?.paymentTermsDays ?? 30) : null))

const today = todayISO()
const isOpen = (s: string) => ['issued', 'sent', 'partial'].includes(s)
const invoices = computed(() => (c.value?.documents ?? []).filter(d => d.kind === 'invoice' || d.kind === 'rectifying'))
const quotes = computed(() => (c.value?.documents ?? []).filter(d => d.kind === 'quote' || d.kind === 'proforma'))
const expenses = computed(() => c.value?.expenses ?? [])

const kpis = computed(() => {
  const emitted = invoices.value.filter(d => !['draft', 'cancelled'].includes(d.status))
  const open = emitted.filter(d => isOpen(d.status))
  const overdue = open.filter(d => d.dueDate && d.dueDate < today)
  const yearStart = `${today.slice(0, 4)}-01-01`
  return {
    billed: emitted.reduce((s, d) => s + d.total, 0),
    billedYear: emitted.filter(d => d.issueDate >= yearStart).reduce((s, d) => s + d.total, 0),
    pending: open.reduce((s, d) => s + (d.total - d.paidTotal), 0),
    overdue: overdue.reduce((s, d) => s + (d.total - d.paidTotal), 0),
    overdueCount: overdue.length,
    count: emitted.length,
    avg: emitted.length ? emitted.reduce((s, d) => s + d.total, 0) / emitted.length : 0,
    spent: expenses.value.reduce((s, e) => s + e.total, 0),
    spentYear: expenses.value.filter(e => e.issueDate >= yearStart).reduce((s, e) => s + e.total, 0),
    toPay: expenses.value.filter(e => e.status !== 'paid').reduce((s, e) => s + e.total, 0),
  }
})

const tabs = computed(() => {
  const t: Array<{ value: string, label: string, count?: number }> = []
  if (c.value?.isClient) {
    t.push({ value: 'facturas', label: 'Facturas', count: invoices.value.length })
    t.push({ value: 'presupuestos', label: 'Presupuestos', count: quotes.value.length })
  }
  if (c.value?.isSupplier) t.push({ value: 'gastos', label: 'Gastos', count: expenses.value.length })
  return t
})
// Pestaña, filtro y página en la URL: al volver atrás desde un documento, la ficha sigue igual
const tab = useQueryState('lista', props.role === 'client' ? 'facturas' : 'gastos', { allowed: ['facturas', 'presupuestos', 'gastos'] })

const editing = ref(false)

async function remove() {
  if (!c.value) return
  const invCount = c.value.invoicesCount ?? invoices.value.length
  const quoteCount = c.value.quotesCount ?? quotes.value.length
  const totalSales = invCount + quoteCount
  const expCount = c.value.expensesCount ?? expenses.value.length

  let body = ''
  if (totalSales > 0 && expCount > 0) {
    body = `Este contacto tiene ${invCount} ${invCount === 1 ? 'factura' : 'facturas'}${quoteCount ? ` (${quoteCount} presupuestos)` : ''} y ${expCount} ${expCount === 1 ? 'gasto asignado' : 'gastos asignados'}.\n\nSi aceptas, el contacto se eliminará definitivamente y esos documentos quedarán desasignados (se conservan todos sus datos de emisión e importes, pero quedarán sin contacto vinculado).`
  }
  else if (totalSales > 0) {
    body = `Este cliente tiene ${invCount} ${invCount === 1 ? 'factura asignada' : 'facturas asignadas'}${quoteCount ? ` y ${quoteCount} ${quoteCount === 1 ? 'presupuesto' : 'presupuestos'}` : ''}.\n\nSi aceptas, el cliente se eliminará definitivamente y las facturas se desasignarán (se conservan todos sus datos de emisión e importes, pero quedarán sin ficha de cliente vinculada).`
  }
  else if (expCount > 0) {
    body = `Este proveedor tiene ${expCount} ${expCount === 1 ? 'gasto asignado' : 'gastos asignados'}.\n\nSi aceptas, el proveedor se eliminará definitivamente y los gastos se desasignarán (se conservan todos sus datos e importes, pero quedarán sin proveedor vinculado).`
  }
  else {
    body = `Se eliminará definitivamente a ${c.value.name}. Esta acción no se puede deshacer.`
  }

  const ok = await confirm({
    title: `¿Eliminar a ${c.value.name}?`,
    body,
    confirmLabel: totalSales > 0 || expCount > 0 ? 'Eliminar y desasignar' : 'Eliminar definitivamente',
    danger: true,
  })
  if (!ok) return

  try {
    const res = await $fetch<{ ok: boolean, unassignedSales?: number, unassignedExpenses?: number }>(`/api/contacts/${props.id}`, { method: 'DELETE' })
    const unassignedCount = (res.unassignedSales ?? 0) + (res.unassignedExpenses ?? 0)
    toast.success(
      isClient.value ? 'Cliente eliminado' : 'Proveedor eliminado',
      unassignedCount > 0 ? `Se han desasignado ${unassignedCount} documento(s) correctamente.` : c.value.name,
    )
    navigateTo(listHref.value)
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
}

async function archive() {
  if (!c.value) return
  const ok = await confirm({
    title: `¿Archivar a ${c.value.name}?`,
    body: 'Dejará de aparecer en listados y buscadores. Sus facturas y gastos se conservan intactos.',
    confirmLabel: 'Archivar',
  })
  if (!ok) return
  try {
    await $fetch(`/api/contacts/${props.id}/archive`, { method: 'POST' })
    toast.success('Contacto archivado', c.value.name)
    navigateTo(listHref.value)
  }
  catch (err) {
    toast.error('No se pudo archivar', errorMessage(err))
  }
}

const moreItems = computed<MenuItem[]>(() => [
  ...(c.value?.email ? [{ label: 'Enviar email', icon: 'ph:envelope-simple', onClick: () => window.open(`mailto:${c.value!.email}`) }] : []),
  ...(c.value?.isSupplier ? [{ label: 'Registrar gasto', icon: 'ph:wallet', to: `/gastos?nuevo=1&proveedor=${props.id}` }] : []),
  ...(c.value?.isClient ? [{ label: 'Nuevo presupuesto', icon: 'ph:file-text', to: `/presupuestos/nuevo?cliente=${props.id}` }] : []),
  { divider: true },
  { label: 'Archivar', icon: 'ph:archive', onClick: archive },
  { label: isClient.value ? 'Eliminar cliente' : 'Eliminar proveedor', icon: 'ph:trash', danger: true, onClick: remove },
])

const address = computed(() => {
  const x = c.value
  if (!x) return ''
  return [x.address, [x.postalCode, x.city].filter(Boolean).join(' '), x.province, x.country !== 'ES' ? x.country : null].filter(Boolean).join('\n')
})

const docPath = (d: DocRow) => (d.kind === 'quote' || d.kind === 'proforma' ? `/presupuestos/${d.id}` : `/facturas/${d.id}`)
const docStatus = (d: DocRow) => salesStatus(d.kind, d.status, isOpen(d.status) && !!d.dueDate && d.dueDate < today)
const expenseStatus = (e: ExpenseRow) => e.status === 'paid' ? { label: 'Pagado', tone: 'success' as const } : e.status === 'partial' ? { label: 'Pago parcial', tone: 'warning' as const } : { label: 'Pendiente', tone: 'warning' as const }
// ─── Documentos de la ficha: una sola forma de fila para facturas, presupuestos y gastos ───

type EntryState = 'paid' | 'accepted' | 'open' | 'overdue' | 'draft' | 'closed'
interface Entry {
  id: number
  path: string
  title: string
  number: string | null
  date: string
  due: string | null
  /** «vence en 5 días», «venció hace 3 días»: solo lo que sigue abierto */
  dueRel: string | null
  /** Lo mismo, corto para ir junto al estado en el móvil: «vence en 5 días», «hace 3 días» */
  dueShort: string | null
  status: { label: string, tone: ReturnType<typeof docStatus>['tone'] }
  state: EntryState
  icon: string
  amount: number
  note: string | null
}

const filter = useQueryState('filtro', 'all')
watch(tab, () => (filter.value = 'all'))

const dueText = (iso: string) => (daysUntil(iso) >= 0 ? `vence ${relDays(iso)}` : `venció ${relDays(iso)}`)

const entries = computed<Entry[]>(() => {
  if (tab.value === 'gastos') {
    return expenses.value.map(e => ({
      id: e.id,
      path: `/gastos?ver=${e.id}`,
      title: e.description || 'Gasto',
      number: e.number,
      date: e.issueDate,
      due: null,
      dueRel: null,
      dueShort: null,
      status: expenseStatus(e),
      state: e.status === 'paid' ? 'paid' : 'open',
      icon: 'ph:wallet',
      amount: e.total,
      note: null,
    }))
  }
  const isQ = tab.value === 'presupuestos'
  return (isQ ? quotes.value : invoices.value).map((d) => {
    const overdue = !isQ && isOpen(d.status) && !!d.dueDate && d.dueDate < today
    const state: EntryState = d.status === 'draft'
      ? 'draft'
      : overdue
        ? 'overdue'
        : ['paid', 'accepted', 'invoiced'].includes(d.status)
            ? (isQ ? 'accepted' : 'paid')
            : ['cancelled', 'rejected', 'expired'].includes(d.status) ? 'closed' : 'open'
    return {
      id: d.id,
      path: docPath(d),
      title: d.conceptPreview || d.number || 'Borrador',
      number: d.number,
      date: d.issueDate,
      due: d.dueDate,
      dueRel: !isQ && isOpen(d.status) && d.dueDate ? dueText(d.dueDate) : null,
      dueShort: !isQ && isOpen(d.status) && d.dueDate ? (overdue ? relDays(d.dueDate) : dueText(d.dueDate)) : null,
      status: docStatus(d),
      state,
      icon: isQ ? 'ph:file-text' : 'ph:receipt',
      // Presupuestos, por su base (rotulada); facturas, por su importe total
      amount: isQ ? d.taxBase : d.total,
      note: isQ ? 'base imponible' : d.status === 'partial' ? `pend. ${eur(d.total - d.paidTotal)}` : null,
    }
  })
})

// ─── Clic derecho (o pulsación larga) en un documento de la ficha y en sus datos ───

const viewer = useFileViewer()

function entryCtx(e: Entry): CtxSpec {
  const isExpense = tab.value === 'gastos'
  const isQ = tab.value === 'presupuestos'
  const pdf = `/api/sales/${e.id}/pdf`
  const issued = !isExpense && e.state !== 'draft'
  const items: CtxItem[] = [
    { label: 'Abrir', icon: 'ph:eye', keys: ['↵'], to: e.path },
    ...(!isExpense ? [{ label: 'Editar', icon: 'ph:pencil-simple', to: `${e.path}/editar` }] : []),
    ...(issued
      ? [
          { divider: true },
          { label: 'Ver PDF', icon: 'ph:file-pdf', onClick: () => viewer.open({ url: pdf, downloadUrl: `${pdf}?download=1`, mime: 'application/pdf', name: `${e.number ?? 'documento'}.pdf` }) },
          { label: 'Descargar PDF', icon: 'ph:download-simple', onClick: () => window.open(`${pdf}?download=1`, '_blank') },
        ]
      : []),
    ...(!isExpense && !isQ && issued ? [{ label: 'Crear rectificativa', icon: 'ph:arrow-counter-clockwise', to: `/facturas/nueva?rectifica=${e.id}` }] : []),
    { divider: true },
    {
      label: 'Copiar',
      icon: 'ph:copy',
      children: [
        ...(e.number ? [{ label: 'Número', sub: e.number, icon: 'ph:hash', onClick: () => copyText(e.number, 'Número') }] : []),
        { label: isQ ? 'Base imponible' : 'Importe total', sub: eur(e.amount), icon: 'ph:currency-eur', onClick: () => copyText(plainAmount(e.amount), 'Importe') },
        { label: 'Concepto', sub: e.title, icon: 'ph:text-align-left', onClick: () => copyText(e.title, 'Concepto') },
      ],
    },
  ]
  return { title: e.number ?? e.title, subtitle: `${fdate(e.date)} · ${eur(e.amount)}`, icon: e.icon, items }
}

function dataCtx(): CtxSpec | null {
  const x = c.value
  if (!x) return null
  // La dirección en una línea: para pegarla o buscarla en el mapa
  const line = address.value.replace(/\n/g, ', ')
  const copy: CtxItem[] = [
    { label: 'Nombre', sub: x.name, icon: 'ph:user', onClick: () => copyText(x.name, 'Nombre') },
    ...(x.nif ? [{ label: 'NIF', sub: x.nif, icon: 'ph:identification-card', onClick: () => copyText(x.nif, 'NIF') }] : []),
    ...(x.email ? [{ label: 'Email', sub: x.email, icon: 'ph:envelope-simple', onClick: () => copyText(x.email, 'Email') }] : []),
    ...(x.phone ? [{ label: 'Teléfono', sub: x.phone, icon: 'ph:phone', onClick: () => copyText(x.phone, 'Teléfono') }] : []),
    ...(line ? [{ label: 'Dirección', sub: line, icon: 'ph:map-pin', onClick: () => copyText(line, 'Dirección') }] : []),
    ...(x.iban ? [{ label: 'IBAN', sub: x.iban, icon: 'ph:bank', onClick: () => copyText(x.iban, 'IBAN') }] : []),
    { divider: true },
    // Todo junto, listo para pegar en un email o en otra aplicación
    { label: 'Todos los datos', icon: 'ph:clipboard-text', onClick: () => copyText([x.name, x.nif, line, x.email, x.phone, x.iban].filter(Boolean).join('\n'), 'Datos') },
  ]
  return {
    title: x.name,
    subtitle: x.nif ?? undefined,
    icon: 'ph:identification-card',
    items: [
      { label: 'Editar datos', icon: 'ph:pencil-simple', onClick: () => (editing.value = true) },
      { divider: true },
      ...(x.email ? [{ label: 'Escribir un email', sub: x.email, icon: 'ph:envelope-simple', onClick: () => (window.location.href = `mailto:${x.email}`) }] : []),
      ...(x.phone ? [{ label: 'Llamar', sub: x.phone, icon: 'ph:phone', onClick: () => (window.location.href = `tel:${x.phone!.replace(/\s/g, '')}`) }] : []),
      ...(line ? [{ label: 'Abrir en el mapa', icon: 'ph:map-trifold', onClick: () => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`, '_blank', 'noopener') }] : []),
      ...(x.website ? [{ label: 'Abrir su web', icon: 'ph:globe', onClick: () => window.open(x.website!.startsWith('http') ? x.website! : `https://${x.website}`, '_blank', 'noopener') }] : []),
      { label: 'Copiar', icon: 'ph:copy', children: copy },
    ],
  }
}

const isPending = (e: Entry) => e.state === 'open' || e.state === 'overdue'
const FILTERS: Record<string, Array<{ value: string, label: string, tone?: string, test?: (e: Entry) => boolean }>> = {
  facturas: [
    { value: 'all', label: 'Todas' },
    { value: 'open', label: 'Pendientes', test: isPending },
    { value: 'overdue', label: 'Vencidas', tone: 'danger', test: e => e.state === 'overdue' },
  ],
  presupuestos: [
    { value: 'all', label: 'Todos' },
    { value: 'open', label: 'Abiertos', test: isPending },
    { value: 'accepted', label: 'Aceptados', test: e => e.state === 'accepted' },
  ],
  gastos: [
    { value: 'all', label: 'Todos' },
    { value: 'open', label: 'Pendientes', test: isPending },
    { value: 'paid', label: 'Pagados', test: e => e.state === 'paid' },
  ],
}

// Solo los filtros que de verdad separan algo: ni vacíos ni con todo (además de «Todas»)
const filters = computed(() => (FILTERS[tab.value] ?? [])
  .map(f => ({ ...f, count: f.test ? entries.value.filter(f.test).length : entries.value.length }))
  .filter(f => f.value === 'all' || (f.count > 0 && f.count < entries.value.length)))

const shown = computed(() => {
  const f = (FILTERS[tab.value] ?? []).find(x => x.value === filter.value)
  return f?.test ? entries.value.filter(f.test) : entries.value
})

const { page, pages, items: paged, size: pageSize, total: pageTotal } = usePaged(shown, [tab, filter], 'pagina')

// La página a la vista, por años (la lista ya viene de más reciente a más antigua). Cada año resume
// todo lo suyo, también lo que cae en otras páginas; el total no cuenta borradores ni anulados
const groups = computed(() => {
  const out: Array<{ year: string, items: Entry[], count: number, total: number }> = []
  for (const e of paged.value) {
    const year = e.date.slice(0, 4)
    let g = out.find(x => x.year === year)
    if (!g) out.push(g = { year, items: [], count: 0, total: 0 })
    g.items.push(e)
  }
  for (const e of shown.value) {
    const g = out.find(x => x.year === e.date.slice(0, 4))
    if (!g) continue
    g.count++
    if (e.state !== 'draft' && e.state !== 'closed') g.total += e.amount
  }
  return out
})

const dueLabel = computed(() => (tab.value === 'facturas' ? 'Vencimiento' : tab.value === 'presupuestos' ? 'Válido hasta' : null))
const amountLabel = computed(() => (tab.value === 'presupuestos' ? 'Base imponible' : 'Total'))
const unit = computed(() => (tab.value === 'facturas' ? ['factura', 'facturas'] : tab.value === 'presupuestos' ? ['presupuesto', 'presupuestos'] : ['gasto', 'gastos']))

const emptyOf = computed(() => {
  const id = c.value?.id
  if (tab.value === 'gastos') return { icon: 'ph:wallet', title: 'Sin gastos todavía', text: 'Registra sus facturas para controlar lo que te cuesta.', to: `/gastos?nuevo=1&proveedor=${id}`, cta: 'Registrar gasto' }
  if (tab.value === 'presupuestos') return { icon: 'ph:file-text', title: 'Sin presupuestos todavía', text: 'Cuando le envíes uno aparecerá aquí con su estado.', to: `/presupuestos/nuevo?cliente=${id}`, cta: 'Crear presupuesto' }
  return { icon: 'ph:receipt', title: 'Sin facturas todavía', text: 'Cuando emitas una aparecerá aquí con su estado de cobro.', to: `/facturas/nueva?cliente=${id}`, cta: 'Crear factura' }
})

const nifTypeLabel: Record<string, string> = { nif: 'NIF', vat_eu: 'NIF-IVA', passport: 'Pasaporte', other: 'Documento' }
</script>

<template>
  <div class="page">
    <a :href="listHref" class="back" @click="back">
      <Icon name="ph:arrow-left" aria-hidden="true" /> {{ backText }}
    </a>

    <div v-if="error" class="card">
      <UiEmpty icon="ph:warning-circle" title="No encontramos este contacto" :text="errorMessage(error)">
        <UiButton :to="listPath">Volver al listado</UiButton>
      </UiEmpty>
    </div>

    <template v-else-if="!c && status === 'pending'">
      <div class="head-sk">
        <div class="skeleton" style="width: 64px; height: 64px; border-radius: 18px" />
        <div class="grow">
          <div class="skeleton" style="width: 280px; height: 24px" />
          <div class="skeleton" style="width: 160px; height: 14px; margin-top: 10px" />
        </div>
      </div>
      <div class="kpis">
        <div v-for="i in 4" :key="i" class="skeleton" style="height: 92px; border-radius: 16px" />
      </div>
    </template>

    <template v-else-if="c">
      <header class="hero rise">
        <UiAvatar :name="c.name" :size="64" :square="c.kind === 'company'" :src="c.logoUrl" contain />
        <div class="grow hero-t">
          <h1>{{ c.name }}</h1>
          <div class="chips">
            <span v-if="c.nif" class="mono nif">{{ nifTypeLabel[c.nifType] ?? 'NIF' }} {{ c.nif }}</span>
            <UiBadge v-else tone="warning" icon="ph:warning">Sin NIF</UiBadge>
            <UiBadge v-if="c.isClient" tone="brand">Cliente</UiBadge>
            <UiBadge v-if="c.isSupplier" tone="info">Proveedor</UiBadge>
            <UiBadge v-if="c.equivalenceSurcharge" tone="neutral">Recargo de equivalencia</UiBadge>
            <span v-if="c.tradeName" class="muted">{{ c.tradeName }}</span>
          </div>
        </div>
        <div class="page-actions">
          <UiButton icon="ph:pencil-simple" @click="editing = true">Editar</UiButton>
          <UiButton v-if="isClient" variant="primary" icon="ph:receipt" :to="`/facturas/nueva?cliente=${c.id}`">Nueva factura</UiButton>
          <UiButton v-else variant="primary" icon="ph:wallet" :to="`/gastos?nuevo=1&proveedor=${c.id}`">Registrar gasto</UiButton>
          <UiMenu :items="moreItems" :width="210">
            <template #default="{ toggle }">
              <UiButton square icon="ph:dots-three-bold" aria-label="Más acciones" @click="toggle" />
            </template>
          </UiMenu>
        </div>
      </header>

      <section class="kpis">
        <template v-if="isClient">
          <div class="kpi rise" style="--i: 1">
            <p class="eyebrow">Facturado total</p>
            <p class="v num">{{ eur(kpis.billed) }}</p>
            <p class="s">{{ kpis.count }} {{ kpis.count === 1 ? 'factura' : 'facturas' }} · media {{ eur(kpis.avg, false) }}</p>
          </div>
          <div class="kpi rise" style="--i: 2">
            <p class="eyebrow">Este año</p>
            <p class="v num">{{ eur(kpis.billedYear) }}</p>
            <p class="s">Importe total desde el 1 de enero</p>
          </div>
          <div class="kpi rise" style="--i: 3">
            <p class="eyebrow">Pendiente de cobro</p>
            <p class="v num" :class="{ warn: kpis.pending > 0 }">{{ eur(kpis.pending) }}</p>
            <p class="s">{{ kpis.pending > 0 ? 'Importe total' : 'Todo cobrado' }}</p>
          </div>
          <div class="kpi rise" style="--i: 4" :class="{ alert: kpis.overdueCount }">
            <p class="eyebrow">Vencido</p>
            <p class="v num" :class="{ bad: kpis.overdue > 0 }">{{ eur(kpis.overdue) }}</p>
            <p class="s">{{ kpis.overdueCount ? `${kpis.overdueCount} ${kpis.overdueCount === 1 ? 'factura' : 'facturas'} fuera de plazo` : 'Sin retrasos' }}</p>
          </div>
        </template>
        <template v-else>
          <div class="kpi rise" style="--i: 1">
            <p class="eyebrow">Gastado total</p>
            <p class="v num">{{ eur(kpis.spent) }}</p>
            <p class="s">{{ expenses.length }} {{ expenses.length === 1 ? 'gasto' : 'gastos' }} registrados</p>
          </div>
          <div class="kpi rise" style="--i: 2">
            <p class="eyebrow">Este año</p>
            <p class="v num">{{ eur(kpis.spentYear) }}</p>
            <p class="s">Importe total desde el 1 de enero</p>
          </div>
          <div class="kpi rise" style="--i: 3">
            <p class="eyebrow">Pendiente de pago</p>
            <p class="v num" :class="{ warn: kpis.toPay > 0 }">{{ eur(kpis.toPay) }}</p>
            <p class="s">{{ kpis.toPay > 0 ? 'Gastos sin marcar como pagados' : 'Todo pagado' }}</p>
          </div>
        </template>
      </section>

      <div class="layout">
        <UiCard padding="none" class="rise docs" style="--i: 2">
          <template #head>
            <UiSegmented v-if="tabs.length > 1" v-model="tab" :options="tabs" label="Documentos" />
            <h2 v-else class="section-title">{{ tabs[0]?.label ?? 'Documentos' }}</h2>
          </template>

          <UiEmpty v-if="!entries.length" compact :icon="emptyOf.icon" :title="emptyOf.title" :text="emptyOf.text">
            <UiButton variant="soft" icon="ph:plus-bold" :to="emptyOf.to">{{ emptyOf.cta }}</UiButton>
          </UiEmpty>

          <template v-else>
            <!-- Filtros rápidos con contador -->
            <div v-if="filters.length > 1" class="doc-filters" role="group" aria-label="Filtrar la lista">
              <button
                v-for="f in filters"
                :key="f.value"
                type="button"
                class="fchip"
                :class="[f.tone, { on: filter === f.value }]"
                :aria-pressed="filter === f.value"
                @click="filter = f.value"
              >
                {{ f.label }} <span class="n num">{{ f.count }}</span>
              </button>
            </div>

            <UiEmpty v-if="!shown.length" compact icon="ph:funnel" title="Nada en este filtro">
              <UiButton size="sm" @click="filter = 'all'">Ver todo</UiButton>
            </UiEmpty>

            <template v-else>
              <!-- Móvil: agrupado por año; concepto entero y, debajo, nº, fecha, estado e importe -->
              <div class="mob-list">
                <section v-for="g in groups" :key="g.year" class="grp" :aria-label="g.year">
                  <header class="grp-h">
                    <span class="grp-y">{{ g.year }}</span>
                    <span class="grp-s num">{{ g.count }} · {{ eur(g.total, false) }}</span>
                  </header>
                  <ul>
                    <li v-for="e in g.items" :key="e.id" v-ctx="() => entryCtx(e)">
                      <UiListRow :to="e.path">
                        <template #lead>
                          <span class="st-ic" :class="e.state" aria-hidden="true"><Icon :name="e.icon" /></span>
                        </template>
                        <template #title>{{ e.title }}</template>
                        <template #info>
                          <template v-if="e.number && e.number !== e.title"><span class="mono">{{ e.number }}</span> · </template>{{ fdate(e.date) }}
                        </template>
                        <template #status>
                          <UiBadge :tone="e.status.tone" size="sm" dot>{{ e.status.label }}</UiBadge>
                          <span v-if="e.dueShort" class="st-rel" :class="{ late: e.state === 'overdue' }">{{ e.dueShort }}</span>
                        </template>
                        <template #amount>
                          {{ eur(e.amount) }}
                          <small v-if="e.note">{{ e.note }}</small>
                        </template>
                      </UiListRow>
                    </li>
                  </ul>
                </section>
              </div>

              <!-- Escritorio: concepto como columna principal, agrupado por año -->
              <div class="table-wrap desk-table">
                <table class="table doc-table">
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Fecha</th>
                      <th v-if="dueLabel">{{ dueLabel }}</th>
                      <th>Estado</th>
                      <th class="r">{{ amountLabel }}</th>
                    </tr>
                  </thead>
                  <tbody v-for="g in groups" :key="g.year">
                    <tr class="grp-row">
                      <th :colspan="dueLabel ? 5 : 4" scope="rowgroup">
                        <span class="grp-in">
                          <span class="grp-y">{{ g.year }}</span>
                          <span class="grp-s num">{{ g.count }} {{ g.count === 1 ? unit[0] : unit[1] }} · {{ eur(g.total) }}</span>
                        </span>
                      </th>
                    </tr>
                    <tr
                      v-for="e in g.items"
                      :key="e.id"
                      v-ctx="() => entryCtx(e)"
                      class="clickable"
                      tabindex="0"
                      @click="navigateTo(e.path)"
                      @keydown.enter="navigateTo(e.path)"
                    >
                      <td class="c-concept">
                        <span class="c-title">{{ e.title }}</span>
                        <span v-if="e.number && e.number !== e.title" class="c-num mono">{{ e.number }}</span>
                      </td>
                      <td class="muted nowrap">{{ fdate(e.date) }}</td>
                      <td v-if="dueLabel" class="nowrap">
                        <span class="muted">{{ e.due ? fdate(e.due) : '—' }}</span>
                        <span v-if="e.dueRel" class="c-rel" :class="{ late: e.state === 'overdue' }">{{ e.dueRel }}</span>
                      </td>
                      <td><UiBadge :tone="e.status.tone" dot>{{ e.status.label }}</UiBadge></td>
                      <td class="r num nowrap">
                        <span class="strong">{{ eur(e.amount) }}</span>
                        <span v-if="e.note" class="c-note">{{ e.note }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <UiPager v-model="page" v-model:size="pageSize" :pages="pages" :total="pageTotal" />
            </template>
          </template>
        </UiCard>

        <UiCard v-ctx="dataCtx" title="Datos" icon="ph:identification-card" class="rise data" style="--i: 3">
          <template #actions>
            <UiButton size="sm" variant="ghost" icon="ph:pencil-simple" @click="editing = true">Editar</UiButton>
          </template>
          <ContactMap v-if="address" :contact-id="c.id" :address="address" />
          <dl class="dl">
            <div v-if="c.contactPerson">
              <dt>Persona de contacto</dt>
              <dd>{{ c.contactPerson }}</dd>
            </div>
            <div v-if="c.email">
              <dt>Email</dt>
              <dd><a :href="`mailto:${c.email}`" class="link">{{ c.email }}</a></dd>
            </div>
            <div v-if="c.phone">
              <dt>Teléfono</dt>
              <dd><a :href="`tel:${c.phone.replace(/\s/g, '')}`" class="link">{{ c.phone }}</a></dd>
            </div>
            <div v-if="address">
              <dt>Dirección</dt>
              <dd class="pre">{{ address }}</dd>
            </div>
            <div v-if="c.website">
              <dt>Web</dt>
              <dd><a :href="c.website.startsWith('http') ? c.website : `https://${c.website}`" target="_blank" rel="noopener" class="link">{{ c.website }}</a></dd>
            </div>
            <div v-if="c.iban">
              <dt>IBAN</dt>
              <dd class="mono">{{ c.iban.replace(/(.{4})/g, '$1 ').trim() }}</dd>
            </div>
            <div v-if="paymentTerms != null">
              <dt>Plazo de pago</dt>
              <dd>{{ paymentTerms }} días</dd>
            </div>
            <div v-if="c.irpfRate != null">
              <dt>Retención IRPF</dt>
              <dd>{{ pct(c.irpfRate) }}</dd>
            </div>
            <div>
              <dt>Alta</dt>
              <dd>{{ fdate(c.createdAt) }}</dd>
            </div>
          </dl>
          <div v-if="c.notes" class="notes">
            <p class="eyebrow">Notas</p>
            <p class="pre">{{ c.notes }}</p>
          </div>
          <p v-if="!c.email && !c.phone && !address" class="hint missing">
            <Icon name="ph:info" /> {{ isClient ? 'Completa su dirección y email para que aparezcan en las facturas y poder enviárselas.' : 'Completa su email y teléfono para tenerlos a mano cuando necesites contactar.' }}
          </p>
        </UiCard>
      </div>

      <ContactModal v-model="editing" :role="role" :contact-id="c.id" @saved="refresh()" />
    </template>
  </div>
</template>

<style scoped>
/* ─── Documentos: filtros, grupos por año y filas ─── */

.doc-filters {
  display: flex;
  gap: 6px;
  padding: 12px var(--s-5);
  overflow-x: auto;
  border-bottom: 1px solid var(--border-subtle);
  scrollbar-width: none;
}

.doc-filters::-webkit-scrollbar {
  display: none;
}

.fchip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-2);
  white-space: nowrap;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
}

.fchip:hover {
  background: var(--surface-hover);
}

.fchip .n {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.fchip.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: transparent;
}

.fchip.on .n {
  color: inherit;
}

.fchip.danger.on {
  color: var(--danger);
  background: var(--danger-soft);
}

.mob-list {
  display: none;
}

.grp ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.grp-h {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-3);
  padding: 10px var(--s-4);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-subtle);
}

.grp + .grp .grp-h {
  border-top: 1px solid var(--border-subtle);
}

.grp-y {
  font-size: var(--text-xs);
  font-weight: 650;
  letter-spacing: 0.06em;
  color: var(--text-2);
}

.grp-s {
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* Icono del documento teñido por su estado: se escanea de un vistazo */
.st-ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  font-size: 18px;
  color: var(--text-3);
  background: var(--surface-sunken);
  border-radius: 11px;
}

.st-ic.paid,
.st-ic.accepted {
  color: var(--success);
  background: var(--success-soft);
}

.st-ic.open {
  color: var(--warning);
  background: var(--warning-soft);
}

.st-ic.overdue {
  color: var(--danger);
  background: var(--danger-soft);
}

.c-rel,
.st-rel {
  color: var(--text-3);
}

.st-rel {
  align-self: center;
  font-size: var(--text-xs);
}

.st-rel.late {
  font-weight: 560;
  color: var(--danger);
}

.c-rel.late {
  font-weight: 560;
  color: var(--danger);
}

/* Escritorio */

.doc-table .grp-row th {
  position: static;
  padding: 8px 16px;
  text-transform: none;
  letter-spacing: 0;
  background: var(--surface-2);
}

.grp-in {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-3);
}

.c-concept {
  min-width: 220px;
}

.c-title {
  display: -webkit-box;
  overflow: hidden;
  font-weight: 560;
  color: var(--text);
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.c-num {
  display: block;
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.doc-table .c-rel,
.c-note {
  display: block;
  margin-top: 2px;
  font-size: var(--text-xs);
}

.c-note {
  font-weight: 500;
  color: var(--text-3);
}

.nowrap {
  white-space: nowrap;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--s-4);
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-3);
  transition: color var(--t-fast);
}

.back:hover {
  color: var(--text);
}

.head-sk,
.hero {
  display: flex;
  align-items: center;
  gap: var(--s-5);
  margin-bottom: var(--s-6);
}

.hero {
  flex-wrap: wrap;
}

.hero-t {
  min-width: 220px;
}

.hero h1 {
  font-size: var(--text-3xl);
  font-weight: 680;
  letter-spacing: -0.028em;
}

.chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.nif {
  font-size: var(--text-sm);
  color: var(--text-2);
}

/* Por el ancho real del contenido, no el de la ventana (la barra lateral resta 248 px) */
.page {
  container: contact / inline-size;
}

/* Las cifras van todas en una fila; si no caben, en 2 × 2 (nunca 3 + 1) */
.kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-4);
  margin-bottom: var(--s-5);
}

@container contact (min-width: 760px) {
  .kpis {
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
  }
}

/* En 2 × 2, la que queda sola en la última fila ocupa las dos columnas */
@container contact (max-width: 759px) {
  .kpis > :nth-child(odd):last-child {
    grid-column: 1 / -1;
  }
}

.kpi {
  padding: var(--s-4) var(--s-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.kpi.alert {
  border-color: color-mix(in srgb, var(--danger-solid) 30%, var(--border));
}

.kpi .v {
  margin-top: 6px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.025em;
}

.kpi .v.warn {
  color: var(--warning);
}

.kpi .v.bad {
  color: var(--danger);
}

.kpi .s {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* Documentos y ficha lado a lado solo si la tabla de documentos conserva ~700 px */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s-5);
  align-items: start;
}

@container contact (min-width: 1060px) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 340px;
  }
}

/* Una columna en el lateral; a todo el ancho, los datos se reparten en columnas */
.dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px var(--s-6);
}

.dl dt {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.dl dd {
  margin: 2px 0 0;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.pre {
  white-space: pre-line;
}

.notes {
  margin-top: var(--s-5);
  padding-top: var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.notes .pre {
  margin-top: 4px;
  color: var(--text-2);
}

.missing {
  display: flex;
  gap: 8px;
  margin-top: var(--s-5);
  padding: 10px 12px;
  background: var(--surface-2);
  border-radius: var(--r-md);
}

.missing :deep(svg) {
  flex-shrink: 0;
  margin-top: 2px;
}

@media (max-width: 767px) {
  .hero {
    gap: var(--s-4);
  }

  .hero h1 {
    font-size: var(--text-2xl);
  }

  .hero .page-actions {
    width: 100%;
  }

  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
  }

  .desk-table {
    display: none;
  }

  .mob-list {
    display: block;
  }

  .doc-filters {
    padding-inline: var(--s-4);
  }

  .kpi {
    padding: var(--s-3) var(--s-4);
  }

  .kpi .v {
    font-size: var(--text-lg);
  }

  .hide-sm {
    display: none;
  }
}
</style>
