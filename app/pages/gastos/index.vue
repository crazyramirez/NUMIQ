<script setup lang="ts">
import type { BulkAction } from '~/components/ui/BulkBar.vue'
import type { MenuItem } from '~/components/ui/Menu.vue'
import type { ReviewKind } from '#shared/utils/review'

interface ExpenseRow {
  id: number
  kind: string
  status: 'pending' | 'paid' | 'partial'
  number: string | null
  issueDate: string
  dueDate: string | null
  description: string | null
  supplierId: number | null
  supplierName: string | null
  categoryId: number | null
  categoryName: string | null
  categoryIcon: string | null
  categoryColor: string | null
  taxBase: number
  vatTotal: number
  irpfTotal: number
  total: number
  deductiblePct: number
  vatDeductiblePct: number
  isInvestment: boolean
  paidTotal: number
  reviewed: boolean
  reviewNotes: string[] | null
  aiConfidence: number | null
  fileId: number | null
  approval: 'approved' | 'pending' | 'rejected'
  rejectReason: string | null
  createdBy: number | null
  createdByName: string | null
}

type Changes = { deductiblePct?: number, vatDeductiblePct?: number, categoryId?: number | null }
type Previous = { id: number, deductiblePct: number, vatDeductiblePct: number, categoryId: number | null }

useHead({ title: 'Gastos · NUMIQ' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const { open: openScan } = useScan()

// ─── Filtros ───

// Filtros en la URL: ?estado= y ?periodo= abren la lista ya filtrada (p. ej. «Pendiente de pago» desde Inicio)
// y al volver atrás desde un gasto o una factura el listado sigue igual
const status = useQueryState('estado', 'all', { allowed: ['all', 'pending', 'paid', 'review'] })
const period = useQueryState('periodo', 'y', { allowed: ['q', 'pq', 'y', 'py', 'all'] })
const categoryId = useQueryState<number | null>('categoria', null, { parse: r => Number(r) || undefined })
const deductible = useQueryState<'all' | 'full' | 'partial' | 'none'>('deducible', 'all', { allowed: ['all', 'full', 'partial', 'none'] })
const q = useQueryState('q', '', { debounce: 250 })
const qDebounced = refDebounced(q, 250)

const now = new Date()
const year = now.getFullYear()
const currentQ = quarterOf(now)
const prevQ = (currentQ === 1 ? 4 : currentQ - 1) as Quarter
const prevQYear = currentQ === 1 ? year - 1 : year

const range = computed<{ from?: string, to?: string }>(() => {
  switch (period.value) {
    case 'q': return quarterRange(year, currentQ)
    case 'pq': return quarterRange(prevQYear, prevQ)
    case 'y': return { from: `${year}-01-01`, to: `${year}-12-31` }
    case 'py': return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
    default: return {}
  }
})

const periodOptions = [
  { value: 'q', label: `Este trimestre (${currentQ}T)` },
  { value: 'pq', label: `Trimestre anterior (${prevQ}T${prevQYear !== year ? ` ${prevQYear}` : ''})` },
  { value: 'y', label: `Este año (${year})` },
  { value: 'py', label: `Año pasado (${year - 1})` },
  { value: 'all', label: 'Todo' },
]

const statusOptions = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'paid', label: 'Pagados' },
  { value: 'review', label: 'Por revisar' },
]

const deductibleOptions = [
  { value: 'all', label: 'Deducibles y no deducibles' },
  { value: 'full', label: 'Deducibles' },
  { value: 'partial', label: 'Deducibles en parte' },
  { value: 'none', label: 'No deducibles' },
]

const { data: cats } = useFetch<Array<{ id: number, kind: string, name: string }>>('/api/categories', { key: 'categories', lazy: true })
const categoryOptions = computed(() => [
  { value: null, label: 'Todas las categorías' },
  ...(cats.value ?? []).filter(c => c.kind === 'expense').sort((a, b) => a.name.localeCompare(b.name, 'es')).map(c => ({ value: c.id, label: c.name })),
])

// Aprobación del equipo: ?aprobacion=pending|rejected abre la lista filtrada (desde «Hoy» o un aviso)
const approvalFilter = useQueryState<'pending' | 'rejected' | null>('aprobacion', null, { allowed: ['pending', 'rejected'] })
const { me } = useMe()
const canApprove = computed(() => ['owner', 'admin'].includes(me.value?.company?.role ?? ''))

const { data, status: fetchStatus, refresh } = useFetch<ExpenseRow[]>('/api/expenses', {
  key: 'expenses',
  query: computed(() => ({
    status: status.value,
    q: qDebounced.value.trim() || undefined,
    from: range.value.from,
    to: range.value.to,
    categoryId: categoryId.value ?? undefined,
    deductible: deductible.value === 'all' ? undefined : deductible.value,
    approval: approvalFilter.value ?? undefined,
  })),
  lazy: true,
})

// «Sin justificante» (desde la tarea de Inicio): gastos sin foto ni PDF; nóminas, cuotas e impuestos no llevan factura
const NO_DOC_KINDS = ['payroll', 'social_security', 'tax']
const noFile = useQueryState('justificante', false, { parse: r => r === 'no', format: v => (v ? 'no' : '') })
// «Por revisar»: un motivo concreto (desde el panel de motivos)
const reviewFilter = useQueryState<ReviewKind | null>('motivo', null, { parse: r => r as ReviewKind })
watch(status, (v) => {
  if (v !== 'review') reviewFilter.value = null
})
const kindsOf = (e: ExpenseRow) => new Set((e.reviewNotes ?? []).map(reviewKind).filter(Boolean))
const rows = computed(() => (data.value ?? []).filter(e => (!noFile.value || (!e.fileId && !NO_DOC_KINDS.includes(e.kind)))
  && (!reviewFilter.value || kindsOf(e).has(reviewFilter.value))))
const firstLoad = computed(() => fetchStatus.value === 'pending' && !data.value)
const filtersActive = computed(() => status.value !== 'all' || !!q.value.trim() || categoryId.value != null || deductible.value !== 'all' || noFile.value || !!approvalFilter.value)

// Cuántos esperan aprobación (aviso arriba para quien puede aprobar)
const { data: pendingApproval, refresh: refreshPending } = useFetch<ExpenseRow[]>('/api/expenses', {
  key: 'expenses-to-approve',
  query: { approval: 'pending', limit: 300 },
  lazy: true,
  server: false,
  immediate: false,
})
watch(canApprove, v => v && refreshPending(), { immediate: true })
const toApprove = computed(() => (canApprove.value ? pendingApproval.value?.length ?? 0 : 0))

const approvalBusy = ref<string | null>(null)
async function decide(ids: number[], decision: 'approve' | 'reject') {
  let reason: string | null = null
  if (decision === 'reject') {
    reason = window.prompt('¿Por qué lo rechazas? (lo verá quien lo registró)', '') ?? null
    if (reason === null) return
  }
  approvalBusy.value = `${decision}-${ids.length === 1 ? ids[0] : 'bulk'}`
  try {
    const r = await $fetch<{ done: number }>('/api/expenses/approvals', { method: 'POST', body: { ids, decision, reason } })
    toast.success(decision === 'approve' ? `${r.done === 1 ? 'Gasto aprobado' : `${r.done} gastos aprobados`}` : `${r.done === 1 ? 'Gasto rechazado' : `${r.done} gastos rechazados`}`, decision === 'approve' ? 'Ya cuentan en impuestos e informes.' : 'Avisamos a quien lo registró.')
    stopSelecting()
    await Promise.all([refresh(), refreshPending()])
  }
  catch (err) {
    toast.error('No se pudo completar', errorMessage(err))
  }
  finally {
    approvalBusy.value = null
  }
}
const approvalBadge = (e: ExpenseRow) => (e.approval === 'pending' ? { label: 'Por aprobar', tone: 'warning' as const } : e.approval === 'rejected' ? { label: 'Rechazado', tone: 'danger' as const } : null)

const levelOf = (e: ExpenseRow) => deductibleLevel(e.deductiblePct, e.vatDeductiblePct, e.vatTotal !== 0)

const summary = computed(() => {
  const r = rows.value
  // Lo que espera aprobación (o se rechazó) no cuenta en impuestos ni en pagos, como en Impuestos
  const ok = r.filter(e => e.approval === 'approved')
  return {
    count: r.length,
    total: r.reduce((s, e) => s + e.total, 0),
    deductible: ok.reduce((s, e) => s + e.taxBase * e.deductiblePct / 100, 0),
    vatDeductible: ok.reduce((s, e) => s + e.vatTotal * e.vatDeductiblePct / 100, 0),
    notDeductible: ok.filter(e => levelOf(e) === 'none').length,
    unapproved: r.length - ok.length,
    pending: ok.filter(e => e.status !== 'paid').reduce((s, e) => s + e.total - (e.paidTotal ?? 0), 0),
    pendingCount: ok.filter(e => e.status !== 'paid').length,
  }
})

/** Reparto por categoría (importe total, con impuestos) para la barra apilada */
const byCategory = computed(() => {
  const map = new Map<string, { name: string, color: string, amount: number }>()
  for (const e of rows.value) {
    const key = String(e.categoryId ?? 0)
    const cur = map.get(key) ?? { name: e.categoryName ?? 'Sin categoría', color: e.categoryColor ?? 'var(--text-4)', amount: 0 }
    cur.amount += e.total
    map.set(key, cur)
  }
  const list = [...map.values()].filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount)
  const total = list.reduce((s, c) => s + c.amount, 0) || 1
  const top = list.slice(0, 5)
  const rest = list.slice(5).reduce((s, c) => s + c.amount, 0)
  if (rest > 0) top.push({ name: 'Otras', color: 'var(--border-strong)', amount: rest })
  return top.map(c => ({ ...c, share: c.amount / total }))
})

const today = todayISO()
function statusOf(e: ExpenseRow) {
  if (e.status === 'paid') return { label: 'Pagado', tone: 'success' as const }
  if (e.status === 'partial') return { label: 'Pago parcial', tone: 'warning' as const }
  if (e.dueDate && e.dueDate < today) return { label: 'Vencido', tone: 'danger' as const }
  return { label: 'Pendiente', tone: 'warning' as const }
}

// ─── Modal: ?nuevo=1, ?proveedor=ID, ?ver=ID ───

const modalOpen = ref(false)
const editId = ref<number | null>(null)
const prefillSupplier = ref<number | null>(null)

watch(() => [route.query.nuevo, route.query.ver, route.query.proveedor], () => {
  if (route.query.ver) {
    editId.value = Number(route.query.ver) || null
    prefillSupplier.value = null
    modalOpen.value = true
  }
  else if (route.query.nuevo) {
    editId.value = null
    prefillSupplier.value = Number(route.query.proveedor) || null
    modalOpen.value = true
  }
}, { immediate: true })

watch(modalOpen, (v) => {
  if (!v && (route.query.nuevo || route.query.ver || route.query.proveedor)) {
    router.replace({ query: { ...route.query, nuevo: undefined, ver: undefined, proveedor: undefined } })
  }
})

function openNew() {
  editId.value = null
  prefillSupplier.value = null
  modalOpen.value = true
}

function openEdit(id: number) {
  router.replace({ query: { ...route.query, ver: String(id) } })
}

const paying = ref<number | null>(null)
async function markPaid(e: ExpenseRow) {
  paying.value = e.id
  try {
    await $fetch(`/api/expenses/${e.id}/pay`, { method: 'POST', body: {} })
    toast.success('Marcado como pagado', `${eur(e.total)}${e.supplierName ? ` · ${e.supplierName}` : ''}`)
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo marcar', errorMessage(err))
  }
  finally {
    paying.value = null
  }
}

function clearFilters() {
  status.value = 'all'
  q.value = ''
  categoryId.value = null
  deductible.value = 'all'
  noFile.value = false
}

// ─── Páginas (50 por defecto) y selección de todo lo filtrado: marcar muchos gastos de una vez (los que llegan del banco o de una importación) ───

const { page, pages, items: shown, size: pageSize, total: pageTotal } = usePaged(rows, [status, period, categoryId, deductible, qDebounced, approvalFilter, noFile, reviewFilter], 'pagina')
const { selected, selectedSet, selecting, allSelected, toggle, toggleAll, selectAll, clear: stopSelecting } = useSelection(rows, shown)
const selectedTotal = computed(() => rows.value.reduce((s, e) => s + (selectedSet.value.has(e.id) ? e.total : 0), 0))

// ─── Deducible / categoría en bloque, con deshacer ───

const applying = ref(false)
const plural = (n: number) => `${n} ${n === 1 ? 'gasto' : 'gastos'}`

async function apply(ids: number[], changes: Changes, title: string) {
  if (!ids.length) return
  applying.value = true
  const one = ids.length === 1 ? rows.value.find(e => e.id === ids[0]) : null
  const who = one ? one.supplierName || one.description || eur(one.total) : null
  // Al instante en pantalla; el servidor confirma
  const touched = new Set(ids)
  for (const e of rows.value) if (touched.has(e.id)) Object.assign(e, changes)
  try {
    const r = await $fetch<{ updated: number, previous: Previous[] }>('/api/expenses/bulk', { method: 'POST', body: { ids, ...changes } })
    selected.value = []
    selecting.value = false
    toast.push({
      tone: 'success',
      title,
      body: who ?? plural(r.updated),
      action: { label: 'Deshacer', run: () => undo(r.previous, changes) },
    }, 7000)
  }
  catch (err) {
    toast.error('No se pudo cambiar', errorMessage(err))
  }
  finally {
    applying.value = false
    await refresh()
  }
}

/** Vuelve a dejar cada gasto como estaba (agrupados por valor para hacer pocas llamadas) */
async function undo(previous: Previous[], changes: Changes) {
  const groups = new Map<string, { ids: number[], body: Changes }>()
  for (const p of previous) {
    const body: Changes = {
      ...('deductiblePct' in changes ? { deductiblePct: p.deductiblePct } : {}),
      ...('vatDeductiblePct' in changes ? { vatDeductiblePct: p.vatDeductiblePct } : {}),
      ...('categoryId' in changes ? { categoryId: p.categoryId } : {}),
    }
    const key = JSON.stringify(body)
    const g = groups.get(key) ?? { ids: [], body }
    g.ids.push(p.id)
    groups.set(key, g)
  }
  try {
    await Promise.all([...groups.values()].map(g => $fetch('/api/expenses/bulk', { method: 'POST', body: { ids: g.ids, ...g.body } })))
    toast.success('Cambio deshecho', plural(previous.length))
  }
  catch (err) {
    toast.error('No se pudo deshacer', errorMessage(err))
  }
  finally {
    await refresh()
  }
}

async function deleteBulk(ids: number[]) {
  if (!ids.length) return
  const ok = await confirm({
    title: `¿Eliminar ${plural(ids.length)} definitivamente?`,
    body: `Se borrarán de forma permanente junto con sus pagos y archivos asociados. Si están conciliados con el banco, los movimientos bancarios quedarán de nuevo pendientes de conciliar.`,
    confirmLabel: `Eliminar ${plural(ids.length)}`,
    danger: true,
  })
  if (!ok) return
  applying.value = true
  try {
    const res = await $fetch<{ ok: boolean, deleted: number }>('/api/expenses/bulk', { method: 'DELETE', body: { ids } })
    toast.success(`${plural(res.deleted)} eliminados`)
    stopSelecting()
    await refresh()
  }
  catch (err) {
    toast.error('No se pudieron eliminar', errorMessage(err))
  }
  finally {
    applying.value = false
  }
}

// ─── Revisión sin abrir cada gasto: motivos agrupados, dar por buenos y pasar a euros ───

const REVIEW_HINT: Record<ReviewKind, string> = {
  currency: 'Se pasan a euros con el cambio oficial del BCE de su fecha, o con el cargo real si están conciliados con el banco.',
  supplier: 'El documento no dice quién lo emite: elige el proveedor en cada uno.',
  parties: 'La factura va a nombre de otro NIF. Si es tuya, dala por buena: las demás de ese proveedor se desmarcan solas.',
  amounts: 'Base, IVA y total no cuadran entre sí: compáralos con el original.',
  vat: 'No se encontró el IVA: confirma la base y el tipo.',
  nif: 'El NIF del proveedor no es válido: corrígelo en su ficha.',
  number: 'Sin nº de factura no se puede deducir el IVA: añádelo si lo tiene.',
  date: 'La fecha no salió del documento: confírmala.',
  reading: 'La IA no leyó el documento con claridad: compáralo con el original.',
  recurring: 'Creados por un gasto fijo en modo revisión: confirma el importe.',
}

const unreviewed = computed(() => (data.value ?? []).filter(e => !e.reviewed))
const reviewGroups = computed(() => {
  const map = new Map<ReviewKind, number[]>()
  for (const e of unreviewed.value) {
    for (const k of kindsOf(e)) map.set(k!, [...(map.get(k!) ?? []), e.id])
  }
  return [...map].map(([kind, ids]) => ({ kind, ids, label: REVIEW_LABEL[kind], hint: REVIEW_HINT[kind] })).sort((a, b) => b.ids.length - a.ids.length)
})
const reviewBusy = ref<string | null>(null)

async function confirmReview(ids: number[], key = 'bulk') {
  if (!ids.length) return
  reviewBusy.value = key
  try {
    const r = await $fetch<{ confirmed: number, resolved: number }>('/api/expenses/review', { method: 'POST', body: { ids, action: 'confirm' } })
    toast.success(r.confirmed === 1 ? 'Gasto revisado' : `${plural(r.confirmed)} revisados`, r.resolved ? `Y ${plural(r.resolved)} más del mismo proveedor, que ya no tenían dudas.` : undefined)
    stopSelecting()
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo marcar', errorMessage(err))
  }
  finally {
    reviewBusy.value = null
  }
}

async function convertToEur(ids: number[], key = 'bulk') {
  if (!ids.length) return
  reviewBusy.value = key
  try {
    const r = await $fetch<{ converted: number, failed: number, message: string | null }>('/api/expenses/review', { method: 'POST', body: { ids, action: 'convert' } })
    if (r.converted) toast.success(r.converted === 1 ? 'Gasto pasado a euros' : `${plural(r.converted)} pasados a euros`, 'El importe original y el cambio usado quedan en sus notas.')
    if (r.failed) toast.error(`${plural(r.failed)} sin convertir`, r.message ?? undefined)
    stopSelecting()
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo convertir', errorMessage(err))
  }
  finally {
    reviewBusy.value = null
  }
}

const selectedUnreviewed = computed(() => unreviewed.value.filter(e => selectedSet.value.has(e.id)))
const selectedForeign = computed(() => selectedUnreviewed.value.filter(e => kindsOf(e).has('currency')))

function markDeductible(ids: number[], level: 'full' | 'none') {
  const one = ids.length === 1
  if (level === 'full') return apply(ids, { deductiblePct: 100, vatDeductiblePct: 100 }, one ? 'Gasto deducible' : 'Marcados como deducibles')
  return apply(ids, { deductiblePct: 0, vatDeductiblePct: 0 }, one ? 'Gasto no deducible' : 'Marcados como no deducibles')
}

function markPartial(ids: number[], p: number, v: number) {
  return apply(ids, { deductiblePct: p, vatDeductiblePct: v }, `Deducible al ${deductibleLabel(p, v)}`)
}

const expenseCats = computed(() => (cats.value ?? []).filter(c => c.kind === 'expense').sort((a, b) => a.name.localeCompare(b.name, 'es')))
const categoryMenu = computed<MenuItem[]>(() => [
  { heading: 'Mover a la categoría' },
  ...expenseCats.value.map(c => ({ label: c.name, icon: 'ph:tag', onClick: () => apply(selected.value, { categoryId: c.id }, `Movidos a ${c.name}`) })),
  { divider: true },
  { label: 'Sin categoría', icon: 'ph:tag-simple', onClick: () => apply(selected.value, { categoryId: null }, 'Sin categoría') },
])

// ─── Pagados, pendientes o vencimiento en bloque ───

const paidOpen = ref(false)
const dueOpen = ref(false)

async function runStatus(body: Record<string, unknown>, ok: (n: number) => string) {
  const ids = [...selected.value]
  if (!ids.length) return
  applying.value = true
  try {
    const res = await $fetch<BulkStatusResult>('/api/expenses/bulk-status', { method: 'POST', body: { ids, ...body } })
    if (res.done) toast.success(ok(res.done))
    if (res.skipped.length) {
      const { body: why, already } = skippedSummary(res.skipped)
      if (already) toast.info(`${plural(res.skipped.length)} sin cambiar`, why)
      else toast.error(`${plural(res.skipped.length)} sin cambiar`, why)
    }
    stopSelecting()
  }
  catch (err) {
    toast.error('No se pudo cambiar', errorMessage(err))
  }
  finally {
    applying.value = false
    await refresh()
  }
}

async function markPendingBulk() {
  const paid = rows.value.filter(e => selectedSet.value.has(e.id) && e.status !== 'pending').length
  if (paid) {
    const ok = await confirm({
      title: `¿Dejar ${paid === 1 ? 'pendiente el gasto pagado' : `pendientes ${paid} gastos pagados`}?`,
      body: 'Se borrarán sus pagos registrados. Los movimientos del banco conciliados con ellos volverán a quedar pendientes de conciliar; los gastos se conservan.',
      confirmLabel: 'Dejar pendientes',
    })
    if (!ok) return
  }
  return runStatus({ action: 'pending' }, n => `${plural(n)} ${n === 1 ? 'pendiente' : 'pendientes'} de pago`)
}

const statusMenu = computed<MenuItem[]>(() => [
  { heading: 'Marcar como' },
  { label: 'Pagados…', icon: 'ph:check-circle', onClick: () => (paidOpen.value = true) },
  { label: 'Pendientes de pago', icon: 'ph:clock', onClick: markPendingBulk },
  { divider: true },
  { label: 'Vencimiento…', hint: 'Vencidos', icon: 'ph:calendar-x', onClick: () => (dueOpen.value = true) },
])

const bulkActions = computed<BulkAction[]>(() => [
  ...(canApprove.value && approvalFilter.value === 'pending'
    ? [
        { label: 'Aprobar', icon: 'ph:check-bold', tone: 'success' as const, onClick: () => decide(selected.value, 'approve') },
        { label: 'Rechazar', icon: 'ph:x-bold', tone: 'danger' as const, onClick: () => decide(selected.value, 'reject') },
      ]
    : []),
  ...(selectedForeign.value.length ? [{ label: 'A euros', icon: 'ph:currency-eur', onClick: () => convertToEur(selectedForeign.value.map(e => e.id)) }] : []),
  ...(selectedUnreviewed.value.length ? [{ label: 'Revisados', icon: 'ph:check-bold', onClick: () => confirmReview(selectedUnreviewed.value.map(e => e.id)) }] : []),
  { label: 'Deducibles', icon: 'ph:check-circle-fill', tone: 'success', onClick: () => markDeductible(selected.value, 'full') },
  { label: 'En parte…', icon: 'ph:circle-half-fill', tone: 'warning', onClick: () => openPartial(selected.value) },
  { label: 'No deducibles', icon: 'ph:prohibit', onClick: () => markDeductible(selected.value, 'none') },
  { label: 'Categoría', icon: 'ph:tag', menu: categoryMenu.value, menuWidth: 260 },
  { label: 'Pago', icon: 'ph:wallet', menu: statusMenu.value, menuWidth: 240 },
  { label: 'Eliminar', icon: 'ph:trash', tone: 'danger', onClick: () => deleteBulk(selected.value) },
])

const isHalf = (e: ExpenseRow) => e.deductiblePct === 50 && (e.vatDeductiblePct === 50 || e.vatTotal === 0)

/** Menú de la etiqueta «Deducible» de cada fila */
function deductibleMenu(e: ExpenseRow): MenuItem[] {
  const level = levelOf(e)
  return [
    { label: 'Deducible', icon: 'ph:check-circle', active: level === 'full', onClick: () => markDeductible([e.id], 'full') },
    { label: 'Deducible al 50 %', hint: 'Uso mixto', icon: 'ph:circle-half', active: level === 'partial' && isHalf(e), onClick: () => markPartial([e.id], 50, 50) },
    { label: 'Otro porcentaje…', icon: 'ph:percent', active: level === 'partial' && !isHalf(e), onClick: () => openPartial([e.id], e) },
    { label: 'No deducible', icon: 'ph:prohibit', active: level === 'none', onClick: () => markDeductible([e.id], 'none') },
  ]
}

// «En parte…»: % del gasto y del IVA
const partialOpen = ref(false)
const partialIds = ref<number[]>([])
const partialPct = ref<number | null>(50)
const partialVat = ref<number | null>(50)
const partialHasVat = computed(() => rows.value.some(e => partialIds.value.includes(e.id) && e.vatTotal !== 0))
const partialId = useId()

function openPartial(ids: number[], from?: ExpenseRow) {
  partialIds.value = [...ids]
  const partial = !!from && levelOf(from) === 'partial'
  partialPct.value = partial ? from.deductiblePct : 50
  partialVat.value = partial ? from.vatDeductiblePct : 50
  partialOpen.value = true
}

function savePartial() {
  const clamp = (n: number | null) => Math.min(100, Math.max(0, Number(n) || 0))
  const p = clamp(partialPct.value)
  partialOpen.value = false
  markPartial(partialIds.value, p, partialHasVat.value ? clamp(partialVat.value) : p)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Gastos</h1>
        <p class="sub">Facturas recibidas, tickets y cuotas. Todo lo que deduces, en un sitio.</p>
      </div>
      <div class="page-actions">
        <UiButton icon="ph:scan" compact @click="openScan('received')">Escanear con IA</UiButton>
        <UiButton variant="primary" icon="ph:plus-bold" compact @click="openNew">Añadir gasto</UiButton>
      </div>
    </header>

    <button v-if="toApprove && approvalFilter !== 'pending'" type="button" class="approve-banner rise" @click="approvalFilter = 'pending'; period = 'all'">
      <Icon name="ph:check-square-offset" class="ab-ic" aria-hidden="true" />
      <span class="grow"><strong>{{ toApprove }} {{ toApprove === 1 ? 'gasto del equipo espera' : 'gastos del equipo esperan' }} tu aprobación</strong><span class="ab-s">No cuentan en impuestos hasta que los apruebes</span></span>
      <span class="ab-go">Revisar <Icon name="ph:arrow-right" aria-hidden="true" /></span>
    </button>

    <section class="summary rise" aria-label="Resumen de gastos filtrados">
      <div class="sum main">
        <p class="eyebrow">Total gastado</p>
        <p class="v num">{{ eur(summary.total) }}</p>
        <p class="s">{{ summary.count }} {{ summary.count === 1 ? 'gasto' : 'gastos' }} · importe total</p>
      </div>
      <div class="sum">
        <!-- Cifra fiscal: va sobre la base imponible y lo dice -->
        <p class="eyebrow">Base deducible</p>
        <p class="v num">{{ eur(summary.deductible) }}</p>
        <p class="s">
          + {{ eur(summary.vatDeductible) }} de IVA en el 303<template v-if="summary.notDeductible">
            · <button type="button" class="link s-link" @click="deductible = 'none'">{{ summary.notDeductible }} no {{ summary.notDeductible === 1 ? 'deducible' : 'deducibles' }}</button>
          </template><template v-if="summary.unapproved">
            · {{ summary.unapproved }} sin aprobar no {{ summary.unapproved === 1 ? 'cuenta' : 'cuentan' }}
          </template>
        </p>
      </div>
      <div class="sum">
        <p class="eyebrow">Pendiente de pago</p>
        <p class="v num" :class="{ warn: summary.pending > 0 }">{{ eur(summary.pending) }}</p>
        <p class="s">{{ summary.pendingCount ? `${summary.pendingCount} sin pagar` : 'Todo al día' }}</p>
      </div>
      <div v-if="byCategory.length" class="sum cats">
        <p class="eyebrow">Por categoría</p>
        <div class="cat-bar" role="img" :aria-label="byCategory.map(c => `${c.name} ${Math.round(c.share * 100)} %`).join(', ')">
          <span v-for="c in byCategory" :key="c.name" :style="{ width: `${c.share * 100}%`, background: c.color }" :title="`${c.name}: ${eur(c.amount)}`" />
        </div>
        <ul class="legend">
          <li v-for="c in byCategory.slice(0, 4)" :key="c.name">
            <span class="dot" :style="{ background: c.color }" aria-hidden="true" />
            <span class="truncate">{{ c.name }}</span>
            <span class="num muted">{{ Math.round(c.share * 100) }} %</span>
          </li>
        </ul>
      </div>
    </section>

    <section v-if="status === 'review' && reviewGroups.length" class="review-panel rise" aria-label="Por qué están por revisar">
      <header class="rp-head">
        <span class="rp-ic" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
        <div>
          <h2>Por qué están por revisar</h2>
          <p>Solo se marca lo que necesita tu ojo. Corrígelo y guarda, o dalo por bueno desde aquí.</p>
        </div>
      </header>
      <ul class="rp-list">
        <li v-for="g in reviewGroups" :key="g.kind" :class="{ on: reviewFilter === g.kind }">
          <span class="rp-n num">{{ g.ids.length }}</span>
          <div class="rp-txt">
            <strong>{{ g.label }}</strong>
            <span>{{ g.hint }}</span>
          </div>
          <div class="rp-acts">
            <UiButton size="sm" variant="ghost" :aria-pressed="reviewFilter === g.kind" @click="reviewFilter = reviewFilter === g.kind ? null : g.kind">
              {{ reviewFilter === g.kind ? 'Ver todos' : 'Ver' }}
            </UiButton>
            <UiButton v-if="g.kind === 'currency'" size="sm" variant="ai" icon="ph:currency-eur" :loading="reviewBusy === g.kind" @click="convertToEur(g.ids, g.kind)">Pasar a euros</UiButton>
            <UiButton v-else size="sm" icon="ph:check-bold" :loading="reviewBusy === g.kind" @click="confirmReview(g.ids, g.kind)">Dar por buenos</UiButton>
          </div>
        </li>
      </ul>
    </section>

    <UiCard padding="none" class="rise" style="--i: 1">
      <div class="toolbar">
        <UiSegmented v-model="status" :options="statusOptions" label="Estado" />
        <div class="filters">
          <UiInput v-model="q" icon="ph:magnifying-glass" placeholder="Proveedor, concepto o nº" aria-label="Buscar gastos" type="search" class="search" />
          <UiSelect v-model="categoryId" :options="categoryOptions" aria-label="Categoría" class="cat" />
          <UiSelect v-model="deductible" :options="deductibleOptions" aria-label="Deducibilidad" class="ded-filter" />
          <UiSelect v-model="period" :options="periodOptions" aria-label="Periodo" class="period" />
          <button v-if="approvalFilter" type="button" class="nofile-chip" @click="approvalFilter = null">
            <Icon name="ph:check-square-offset" aria-hidden="true" /> {{ approvalFilter === 'pending' ? 'Por aprobar' : 'Rechazados' }} <Icon name="ph:x-bold" class="x" aria-label="Quitar filtro" />
          </button>
          <button v-if="reviewFilter" type="button" class="nofile-chip" @click="reviewFilter = null">
            <Icon name="ph:sparkle" aria-hidden="true" /> {{ REVIEW_LABEL[reviewFilter] }} <Icon name="ph:x-bold" class="x" aria-label="Quitar filtro" />
          </button>
          <button v-if="noFile" type="button" class="nofile-chip" @click="noFile = false">
            <Icon name="ph:paperclip" aria-hidden="true" /> Sin justificante <Icon name="ph:x-bold" class="x" aria-label="Quitar filtro" />
          </button>
          <UiButton
            v-if="rows.length"
            class="mobile sel-toggle"
            :variant="selecting ? 'primary' : 'secondary'"
            :icon="selecting ? 'ph:x' : 'ph:check-square'"
            @click="selecting ? stopSelecting() : (selecting = true)"
          >
            {{ selecting ? 'Cancelar selección' : 'Seleccionar' }}
          </UiButton>
        </div>
      </div>

      <div v-if="firstLoad" class="skeletons">
        <div v-for="i in 7" :key="i" class="sk-row">
          <div class="skeleton" style="width: 70px; height: 12px" />
          <div class="grow">
            <div class="skeleton" style="width: 40%; height: 12px" />
            <div class="skeleton" style="width: 25%; height: 10px; margin-top: 8px" />
          </div>
          <div class="skeleton" style="width: 80px; height: 12px" />
        </div>
      </div>

      <UiEmpty
        v-else-if="!rows.length && !filtersActive"
        icon="ph:wallet"
        title="Sin gastos en este periodo"
        text="Registra facturas de proveedores, tickets y cuotas: cada gasto deducible reduce lo que pagas de IVA e IRPF."
      >
        <UiButton variant="primary" icon="ph:plus-bold" @click="openNew">Añadir gasto</UiButton>
        <UiButton icon="ph:scan" @click="openScan('received')">Escanear con IA</UiButton>
      </UiEmpty>

      <UiEmpty v-else-if="!rows.length" compact icon="ph:funnel" title="Ningún gasto coincide" text="Cambia los filtros o el periodo.">
        <UiButton @click="clearFilters">Quitar filtros</UiButton>
      </UiEmpty>

      <template v-else>
        <div class="table-wrap desktop">
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
                <th>Fecha</th>
                <th>Proveedor y concepto</th>
                <th class="c-cat">Categoría</th>
                <th>Deducible</th>
                <th class="r">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="e in shown"
                :key="e.id"
                class="clickable"
                :class="{ sel: selectedSet.has(e.id) }"
                tabindex="0"
                @click="openEdit(e.id)"
                @keydown.enter.self="openEdit(e.id)"
              >
                <td class="pick" @click.stop="toggle(e.id, $event)">
                  <input
                    type="checkbox"
                    :checked="selectedSet.has(e.id)"
                    :aria-label="`Seleccionar ${e.supplierName || e.description || 'gasto'} de ${eur(e.total)}`"
                    @click.stop="toggle(e.id, $event)"
                  >
                </td>
                <td class="muted nowrap">{{ fdate(e.issueDate) }}</td>
                <td>
                  <div class="who">
                    <span v-if="e.categoryName" class="cat-ic cat-lead" :style="{ '--c': e.categoryColor ?? 'var(--text-4)' }" :title="e.categoryName" aria-hidden="true">
                      <Icon :name="e.categoryIcon || 'ph:tag'" />
                    </span>
                    <span class="strong truncate">{{ e.supplierName || EXPENSE_KIND[e.kind] || 'Gasto' }}</span>
                    <UiBadge v-if="!e.reviewed" tone="ai" size="sm" icon="ph:sparkle-fill" :title="e.reviewNotes?.join('\n')">{{ e.reviewNotes?.length ? REVIEW_LABEL[reviewKind(e.reviewNotes[0]!) ?? 'reading'] : 'Revisar' }}</UiBadge>
                  </div>
                  <span class="sub truncate">{{ [e.description, e.number].filter(Boolean).join(' · ') || '—' }}</span>
                </td>
                <td class="c-cat">
                  <span v-if="e.categoryName" class="cat-chip">
                    <span class="cat-ic" :style="{ '--c': e.categoryColor ?? 'var(--text-4)' }" aria-hidden="true">
                      <Icon :name="e.categoryIcon || 'ph:tag'" />
                    </span>
                    <span class="truncate">{{ e.categoryName }}</span>
                  </span>
                  <span v-else class="muted">Sin categoría</span>
                </td>
                <td @click.stop>
                  <UiMenu :items="deductibleMenu(e)" :width="236" align="start">
                    <template #default="{ toggle: openMenu }">
                      <button
                        type="button"
                        class="ded-pill"
                        :class="levelOf(e)"
                        :aria-label="`${deductibleLabel(e.deductiblePct, e.vatDeductiblePct, e.vatTotal !== 0)}. Cambiar`"
                        @click="openMenu"
                      >
                        <Icon :name="levelOf(e) === 'full' ? 'ph:check-circle-fill' : levelOf(e) === 'partial' ? 'ph:circle-half-fill' : 'ph:prohibit'" aria-hidden="true" />
                        <span>{{ levelOf(e) === 'full' ? 'Sí' : levelOf(e) === 'none' ? 'No' : deductibleLabel(e.deductiblePct, e.vatDeductiblePct, e.vatTotal !== 0) }}</span>
                        <Icon name="ph:caret-down" class="caret" aria-hidden="true" />
                      </button>
                    </template>
                  </UiMenu>
                </td>
                <td class="r num strong">{{ eur(e.total) }}</td>
                <td @click.stop>
                  <div class="st-cell">
                    <UiBadge v-if="approvalBadge(e)" :tone="approvalBadge(e)!.tone" dot :title="e.rejectReason ?? (e.createdByName ? `Registrado por ${e.createdByName}` : undefined)">{{ approvalBadge(e)!.label }}</UiBadge>
                    <UiBadge v-else :tone="statusOf(e).tone" dot>{{ statusOf(e).label }}</UiBadge>
                    <template v-if="canApprove && e.approval === 'pending'">
                      <UiButton size="sm" variant="ghost" square icon="ph:check-bold" :aria-label="`Aprobar ${e.supplierName ?? 'gasto'}`" title="Aprobar" :loading="approvalBusy === `approve-${e.id}`" @click="decide([e.id], 'approve')" />
                      <UiButton size="sm" variant="ghost" square icon="ph:x-bold" :aria-label="`Rechazar ${e.supplierName ?? 'gasto'}`" title="Rechazar" :loading="approvalBusy === `reject-${e.id}`" @click="decide([e.id], 'reject')" />
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ul class="cards mobile">
          <li v-for="e in shown" :key="e.id">
            <UiListRow :selecting="selecting" :selected="selectedSet.has(e.id)" @toggle="toggle(e.id)" @open="openEdit(e.id)">
              <template #lead>
                <span class="cat-ic lg" :style="{ '--c': e.categoryColor ?? 'var(--text-4)' }" aria-hidden="true">
                  <Icon :name="e.categoryIcon || 'ph:wallet'" />
                </span>
              </template>
              <template #title>{{ e.supplierName || e.description || 'Gasto' }}</template>
              <template v-if="e.supplierName && e.description" #sub>{{ e.description }}</template>
              <template #info>{{ fdate(e.issueDate) }}{{ e.categoryName ? ` · ${e.categoryName}` : '' }}</template>
              <template v-if="e.approval === 'pending' ? e.createdByName : e.approval === 'rejected' && e.rejectReason" #note>
                <span class="appr-note" :class="e.approval">
                  {{ e.approval === 'pending' ? `Registrado por ${e.createdByName!.split(' ')[0]}` : `Motivo: ${e.rejectReason}` }}
                </span>
              </template>
              <template v-if="canApprove && e.approval === 'pending'" #after>
                <div class="appr-acts">
                  <UiButton size="sm" variant="ghost" icon="ph:x-bold" :loading="approvalBusy === `reject-${e.id}`" @click="decide([e.id], 'reject')">Rechazar</UiButton>
                  <UiButton size="sm" variant="primary" icon="ph:check-bold" :loading="approvalBusy === `approve-${e.id}`" @click="decide([e.id], 'approve')">Aprobar</UiButton>
                </div>
              </template>
              <template #status>
                <UiBadge v-if="approvalBadge(e)" :tone="approvalBadge(e)!.tone" size="sm" dot>{{ approvalBadge(e)!.label }}</UiBadge>
                <UiBadge v-else :tone="statusOf(e).tone" size="sm" dot>{{ statusOf(e).label }}</UiBadge>
                <UiBadge v-if="!e.reviewed" tone="ai" size="sm" icon="ph:sparkle-fill">{{ e.reviewNotes?.length ? REVIEW_LABEL[reviewKind(e.reviewNotes[0]!) ?? 'reading'] : 'Revisar' }}</UiBadge>
                <span v-if="levelOf(e) !== 'full'" class="ded-mini" :class="levelOf(e)">
                  <Icon :name="levelOf(e) === 'partial' ? 'ph:circle-half-fill' : 'ph:prohibit'" aria-hidden="true" />
                  {{ deductibleLabel(e.deductiblePct, e.vatDeductiblePct, e.vatTotal !== 0) }}
                </span>
              </template>
              <template #amount>{{ eur(e.total) }}</template>
            </UiListRow>
          </li>
        </ul>

        <UiPager v-model="page" v-model:size="pageSize" :pages="pages" :total="pageTotal" />
      </template>
    </UiCard>

    <UiBulkBar
      :count="selected.length"
      :total="rows.length"
      :title="selected.length === 1 ? 'gasto seleccionado' : 'gastos seleccionados'"
      :sub="eur(selectedTotal)"
      :actions="bulkActions"
      :busy="applying"
      label="Acciones con los gastos seleccionados"
      @all="selectAll"
      @clear="stopSelecting"
    />

    <BulkPaidModal
      v-model="paidOpen"
      title="Marcar como pagados"
      :subtitle="`${plural(selected.length)} · ${eur(selectedTotal)}`"
      :confirm-label="`Marcar ${selected.length} como pagados`"
      what="pago"
      @apply="({ date, method }) => runStatus({ action: 'paid', date, method }, n => `${plural(n)} ${n === 1 ? 'pagado' : 'pagados'}`)"
    />

    <BulkDueModal
      v-model="dueOpen"
      title="Vencimiento"
      :subtitle="plural(selected.length)"
      late="Los pendientes de pago con el vencimiento ya pasado aparecen como vencidos."
      @apply="body => runStatus({ action: 'due', ...body }, n => `Vencimiento de ${plural(n)} cambiado`)"
    />

    <UiModal v-model="partialOpen" title="Deducible en parte" :subtitle="partialIds.length === 1 ? 'Uso mixto: solo cuenta la parte profesional' : `${plural(partialIds.length)} · uso mixto`" size="sm">
      <form :id="partialId" class="partial-form" novalidate @submit.prevent="savePartial">
        <div class="partial-grid">
          <UiInput v-model="partialPct" numeric suffix="%" :label="partialHasVat ? 'Del gasto' : 'Deducible'" hint="Resta en tu renta o en Sociedades" />
          <UiInput v-if="partialHasVat" v-model="partialVat" numeric suffix="%" label="Del IVA" hint="Se resta en el 303" />
        </div>
        <div class="presets" role="group" aria-label="Porcentajes habituales">
          <button v-for="p in [50, 30, 25]" :key="p" type="button" class="preset" :class="{ on: partialPct === p && (!partialHasVat || partialVat === p) }" @click="partialPct = p; partialVat = p">
            {{ p }} %
          </button>
        </div>
        <p class="partial-tip">
          <Icon name="ph:lightbulb-filament" aria-hidden="true" />
          <span>Vehículo de uso mixto: lo habitual es el 50 % del gasto y del IVA. Suministros de tu casa: el 30 % de la parte que dedicas a la actividad.</span>
        </p>
      </form>
      <template #footer>
        <UiButton @click="partialOpen = false">Cancelar</UiButton>
        <UiButton type="submit" :form="partialId" variant="primary" icon="ph:check-bold">Aplicar</UiButton>
      </template>
    </UiModal>

    <ExpenseModal
      v-model="modalOpen"
      :expense-id="editId"
      :prefill-supplier-id="prefillSupplier"
      @saved="refresh()"
      @deleted="refresh()"
    />
  </div>
</template>

<style scoped>
.summary {
  display: grid;
  gap: var(--s-4);
  margin-bottom: var(--s-5);
}

.sum {
  min-width: 0;
  padding: var(--s-4) var(--s-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.sum .v {
  margin-top: 6px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.025em;
}

.sum .v.warn {
  color: var(--warning);
}

.sum .s {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.cat-bar {
  display: flex;
  gap: 2px;
  height: 8px;
  margin-top: 12px;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--surface-active);
}

.cat-bar span {
  min-width: 3px;
  height: 100%;
  transition: width var(--t-slow) var(--ease-out);
}

.legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px var(--s-3);
  margin-top: 10px;
  padding: 0;
  list-style: none;
  font-size: var(--text-xs);
}

.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--text-2);
}

.legend .num {
  flex-shrink: 0;
  margin-left: auto;
  white-space: nowrap;
}

.dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 3px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  flex-wrap: wrap;
  padding: var(--s-4) var(--s-5);
  border-bottom: 1px solid var(--border-subtle);
}

.filters {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex-wrap: wrap;
}

.search {
  width: 240px;
}

.cat {
  width: 200px;
}

.period {
  width: 210px;
}

.ded-filter {
  width: 244px;
}

.sel-toggle {
  display: none;
}

.s-link {
  font-size: inherit;
}

/* ─── Selección ─── */

.pick {
  width: 1%;
  padding-right: 0 !important;
  cursor: default;
}

.table tbody tr.sel {
  background: color-mix(in srgb, var(--brand) 6%, transparent);
}

.table tbody tr.sel:hover {
  background: color-mix(in srgb, var(--brand) 9%, transparent);
}

input[type='checkbox'] {
  display: block;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--brand);
  cursor: pointer;
}

/* ─── Deducible ─── */

.ded-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 7px 0 8px;
  font-size: var(--text-xs);
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid transparent;
  border-radius: var(--r-full);
  transition: background var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast);
}

.ded-pill :deep(svg) {
  width: 13px;
  height: 13px;
  flex: none;
}

.ded-pill .caret {
  width: 10px;
  height: 10px;
  opacity: 0;
  transition: opacity var(--t-fast);
}

.ded-pill:hover .caret,
.ded-pill:focus-visible .caret {
  opacity: 0.7;
}

.ded-pill.full {
  color: var(--success);
  background: var(--success-soft);
}

.ded-pill.partial {
  color: var(--warning);
  background: var(--warning-soft);
}

.ded-pill.none {
  color: var(--text-3);
  background: var(--surface-sunken);
  border-color: var(--border-subtle);
}

.ded-pill:hover {
  border-color: var(--border);
}

.ded-pill:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.approve-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin-bottom: var(--s-4);
  padding: 12px var(--s-4);
  text-align: left;
  color: var(--text);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 25%, transparent);
  border-radius: var(--r-xl);
}

.ab-ic {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--warning);
}

.approve-banner strong {
  display: block;
  font-weight: 650;
}

.ab-s {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.ab-go {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--warning);
}

.st-cell {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.appr-note {
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
}

.appr-note.rejected {
  color: var(--danger);
}

.appr-acts {
  display: flex;
  justify-content: flex-end;
  gap: var(--s-2);
  padding: 0 var(--s-4) 12px;
}

/* ─── Motivos de «Por revisar» ─── */
.review-panel {
  container: review / inline-size;
  margin-bottom: var(--s-5);
  padding: var(--s-4) var(--s-5);
  background: linear-gradient(135deg, color-mix(in srgb, var(--ai-soft) 70%, var(--surface)), var(--surface) 60%);
  border: 1px solid color-mix(in srgb, var(--ai-2) 22%, var(--border));
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.rp-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: var(--s-3);
}

.rp-ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  font-size: 16px;
  color: var(--ai-2);
  background: var(--ai-soft);
  border-radius: var(--r-md);
}

.rp-head h2 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 650;
}

.rp-head p {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.rp-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rp-list li {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid var(--border-subtle);
}

.rp-list li.on .rp-n {
  color: var(--surface);
  background: var(--ai-2);
}

.rp-n {
  display: grid;
  flex: none;
  place-items: center;
  min-width: 32px;
  height: 26px;
  padding: 0 8px;
  font-size: var(--text-sm);
  font-weight: 650;
  color: var(--ai-2);
  background: var(--ai-soft);
  border-radius: 999px;
}

.rp-txt {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.rp-txt strong {
  font-size: var(--text-sm);
  font-weight: 620;
}

.rp-txt span {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.rp-acts {
  display: flex;
  flex: none;
  gap: var(--s-2);
}

@container review (max-width: 620px) {
  .rp-list li {
    flex-wrap: wrap;
  }

  .rp-txt {
    flex-basis: calc(100% - 44px);
  }

  .rp-acts {
    justify-content: flex-end;
    width: 100%;
  }
}

.nofile-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.nofile-chip .x {
  width: 12px;
  height: 12px;
  opacity: 0.7;
}

.ded-mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: var(--text-2xs);
  font-weight: 600;
  border-radius: var(--r-full);
}

.ded-mini :deep(svg) {
  width: 11px;
  height: 11px;
}

.ded-mini.partial {
  color: var(--warning);
  background: var(--warning-soft);
}

.ded-mini.none {
  color: var(--text-3);
  background: var(--surface-sunken);
}

/* ─── Modal «En parte» ─── */

.partial-form {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.partial-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-3);
}

.presets {
  display: flex;
  gap: 6px;
}

.preset {
  height: 30px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-full);
  transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
}

.preset:hover {
  color: var(--text);
  border-color: var(--border);
}

.preset.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: var(--brand-soft-2);
}

.preset:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.partial-tip {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  font-size: var(--text-xs);
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.partial-tip :deep(svg) {
  flex: none;
  margin-top: 1px;
  color: var(--warning);
}

.skeletons {
  padding: var(--s-2) var(--s-5) var(--s-4);
}

.sk-row {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 15px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.nowrap {
  white-space: nowrap;
}

.who {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 320px;
}

.table .sub {
  max-width: 320px;
}

.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 200px;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.cat-ic {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
  border-radius: 7px;
}

.cat-ic.lg {
  width: 36px;
  height: 36px;
  font-size: 17px;
  border-radius: 10px;
}

.act {
  width: 1%;
  text-align: right;
  white-space: nowrap;
}

.cards {
  display: none;
  list-style: none;
  padding: 0;
}

.block {
  display: block;
}

.cat-lead {
  display: none;
}

/* Por el ancho real del contenido (la barra lateral resta 248 px), no el de la ventana:
   ≥ 1100 resumen en 4 · < 1000 sin columna de categoría (va el icono junto al proveedor) · < 760 filas de móvil */
.page {
  container: gastos / inline-size;
}

.summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.cats {
  container: cats / inline-size;
  grid-column: 1 / -1;
}

@container gastos (min-width: 1100px) {
  .summary {
    grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr);
  }

  .cats {
    grid-column: auto;
  }
}

/* Leyenda en una columna si en dos se cortarían los nombres */
@container cats (max-width: 420px) {
  .legend {
    grid-template-columns: minmax(0, 1fr);
  }
}

@container gastos (max-width: 999px) {
  .c-cat {
    display: none;
  }

  .cat-lead {
    display: grid;
  }
}

@container gastos (max-width: 759px) {
  .desktop {
    display: none;
  }

  .cards {
    display: block;
  }

  .sel-toggle {
    display: inline-flex;
  }
}

@media (max-width: 1023px) {
  .filters {
    width: 100%;
  }

  .search {
    flex: 1;
    min-width: 180px;
  }
}

@media (max-width: 767px) {
  .toolbar {
    padding: var(--s-3) var(--s-4);
  }

  .search,
  .cat,
  .ded-filter,
  .period {
    width: 100%;
    flex-basis: 100%;
  }

  .sel-toggle {
    width: 100%;
  }

  .partial-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
  }

  .sum.main {
    grid-column: 1 / -1;
  }

  .sum {
    padding: var(--s-3) var(--s-4);
  }

  .sum .v {
    font-size: var(--text-xl);
  }
}
</style>
