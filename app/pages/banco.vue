<script setup lang="ts">
import type { BulkAction } from '~/components/ui/BulkBar.vue'
import type { CtxItem, CtxSpec } from '~/composables/useContextMenu'
import type { ImportResult } from '~/components/bank/ImportModal.vue'

useHead({ title: 'Banco · NUMIQ' })

interface Suggestion {
  kind: 'invoice' | 'expense' | 'payment' | 'new_expense' | 'ignore'
  id?: number | null
  ids?: number[] | null
  label: string
  detail?: string | null
  confidence: number
  source: 'match' | 'rule' | 'ai'
  expenseKind?: string
  categoryId?: number | null
  supplier?: string | null
  vatRate?: number | null
  deductiblePct?: number | null
  vatDeductiblePct?: number | null
  contactId?: number | null
}
interface Tx {
  id: number
  accountId: number
  date: string
  valueDate?: string | null
  amount: number
  description: string
  counterparty: string | null
  reference?: string | null
  bankCode: string | null
  balance?: number | null
  status: 'pending' | 'matched' | 'ignored'
  suggestion: Suggestion | null
  ignoreReason: string | null
  matchedAt?: string | null
  createdAt?: string | null
  link: { kind: 'invoice' | 'expense', id: number, label: string, detail: string | null } | null
}
interface Account { id: number, name: string, bankName: string | null, iban: string | null, balance: number, balanceAt: string | null, lastImportAt: string | null, pending: number, matched: number, total: number }
interface BankData {
  accounts: Account[]
  stats: { pending: number, matched: number, ignored: number, ready: number }
  total: number
  page: number
  pageSize: number
  items: Tx[]
  ai: boolean
}

const toast = useToast()
const { confirm } = useConfirm()
const { me } = useMe()
const readOnly = computed(() => me.value?.company?.role === 'advisor')

// Filtros, búsqueda y página en la URL: al volver atrás desde un documento conciliado, todo sigue igual
const status = useQueryState<'pending' | 'matched' | 'ignored' | 'all'>('estado', 'all', { allowed: ['pending', 'matched', 'ignored', 'all'] })
const account = useQueryState<number | null>('cuenta', null, { parse: r => Number(r) || undefined })
const q = useQueryState('q', '', { debounce: 250 })
const qDebounced = ref(q.value.trim())
const page = useQueryState('pagina', 1, { parse: r => (Number(r) >= 1 ? Math.floor(Number(r)) : undefined) })
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    qDebounced.value = v.trim()
    page.value = 1
  }, 250)
})
watch([status, account], () => (page.value = 1))
const pageSize = usePageSize()
// Al cambiar el tamaño, sigue a la vista lo primero que se estaba viendo
watch(pageSize, (n, old) => (page.value = Math.floor(((page.value - 1) * old) / n) + 1))

const query = computed(() => ({ status: status.value, account: account.value ?? undefined, q: qDebounced.value || undefined, page: page.value, size: pageSize.value }))
const { data, refresh, status: loadStatus } = await useFetch<BankData>('/api/bank', { query, lazy: true })
const firstLoad = computed(() => loadStatus.value === 'pending' && !data.value)
const accounts = computed(() => data.value?.accounts ?? [])
const totalBalance = computed(() => accounts.value.reduce((s, a) => s + a.balance, 0))

const totalCount = computed(() => (data.value?.stats ? data.value.stats.pending + data.value.stats.matched + data.value.stats.ignored : null))

const statusOptions = computed(() => [
  { value: 'all', label: 'Todo', count: totalCount.value },
  { value: 'pending', label: 'Por revisar', count: data.value?.stats.pending ?? null },
  { value: 'matched', label: 'Conciliados', count: data.value?.stats.matched ?? null },
  { value: 'ignored', label: 'Ignorados', count: data.value?.stats.ignored ?? null },
])

// ─── Importar ───
const importOpen = ref(false)
function onImported(r: ImportResult) {
  const range = r.from === r.to ? fdate(r.from) : `${fdateShort(r.from)} – ${fdateShort(r.to)}`
  if (!r.imported) toast.info('Nada nuevo en este extracto', `Los ${r.duplicates} movimientos ya estaban importados.`)
  else toast.success(`${r.imported} ${r.imported === 1 ? 'movimiento importado' : 'movimientos importados'}`, `${r.accountName} · ${range}${r.suggested ? ` · ${r.suggested} con propuesta` : ''}${r.duplicates ? ` · ${r.duplicates} repetidos omitidos` : ''}`)
  status.value = 'pending'
  account.value = null
  refresh()
}

// ─── Acciones ───
const busy = ref<number | 'auto' | 'suggest' | null>(null)
async function run(id: number | 'auto' | 'suggest', fn: () => Promise<unknown>, ok?: string, detail?: string) {
  busy.value = id
  try {
    await fn()
    if (ok) toast.success(ok, detail)
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo completar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

// Acciones sobre rutas con id: la URL como texto evita que TypeScript recorra todas las rutas de la API
const call = (url: string, opts: { method: 'POST' | 'DELETE', body?: Record<string, unknown> }) => $fetch<unknown>(url, opts)

function accept(tx: Tx) {
  const s = tx.suggestion
  if (!s) return
  if (s.kind === 'invoice' || s.kind === 'expense' || s.kind === 'payment') {
    return run(tx.id, () => call(`/api/bank/transactions/${tx.id}/match`, { method: 'POST', body: { kind: s.kind, id: s.id, ids: s.ids ?? null } }), s.ids?.length ? 'Facturas cobradas' : 'Conciliado', s.label)
  }
  if (s.kind === 'new_expense') return createExpense(tx)
  return ignore(tx, s.label)
}

/** Gasto con la propuesta del cargo; sin indicar la deducibilidad, el servidor aplica la aprendida */
function createExpense(tx: Tx, deductible?: number) {
  const s = tx.suggestion?.kind === 'new_expense' ? tx.suggestion : null
  return run(tx.id, async () => {
    const r = await call(`/api/bank/transactions/${tx.id}/expense`, {
      method: 'POST',
      body: {
        kind: s?.expenseKind ?? 'ticket',
        categoryId: s?.categoryId ?? null,
        supplier: s?.supplier ?? null,
        vatRate: s?.vatRate ?? (s ? 0 : 21),
        description: null,
        deductiblePct: deductible ?? s?.deductiblePct ?? null,
        vatDeductiblePct: deductible ?? s?.vatDeductiblePct ?? null,
      },
    }) as { linked?: boolean }
    // Ya estaba anotado (escaneado, importado o a mano): se concilia con él en vez de duplicarlo
    if (r.linked) toast.success('Ya estaba anotado', 'Conciliado con el gasto que tenías, sin duplicarlo')
    else toast.success(deductible === 0 ? 'Gasto no deducible creado' : 'Gasto creado y conciliado', s?.label ?? tx.description)
  })
}

/** «No deducible» o «50 %» si la propuesta de gasto no es deducible del todo */
function dedTag(s: Suggestion) {
  if (s.kind !== 'new_expense' || s.deductiblePct == null) return null
  const level = deductibleLevel(s.deductiblePct, s.vatDeductiblePct, !!s.vatRate)
  return level === 'full' ? null : { level, label: deductibleLabel(s.deductiblePct, s.vatDeductiblePct, !!s.vatRate) }
}

const ignore = (tx: Tx, reason: string | null = null) => run(tx.id, () => call(`/api/bank/transactions/${tx.id}/ignore`, { method: 'POST', body: { reason } }), 'Marcado como revisado')
const unmatch = (tx: Tx) => run(tx.id, () => call(`/api/bank/transactions/${tx.id}/unmatch`, { method: 'POST' }), tx.status === 'matched' ? 'Conciliación deshecha' : 'Vuelve a estar pendiente')

async function autoMatch() {
  const n = data.value?.stats.ready ?? 0
  const ok = await confirm({
    title: `¿Conciliar ${n} ${n === 1 ? 'movimiento' : 'movimientos'}?`,
    body: 'Se registran los cobros y pagos que casan sin dudas, se enlazan los ya anotados y se crean los gastos típicos (cuota de autónomos, comisiones). Puedes deshacer cualquiera después.',
    confirmLabel: 'Conciliar',
  })
  if (!ok) return
  busy.value = 'auto'
  try {
    const r = await $fetch<{ done: number, failed: number }>('/api/bank/auto', { method: 'POST', body: { account: account.value } })
    toast.success(`${r.done} ${r.done === 1 ? 'movimiento conciliado' : 'movimientos conciliados'}`, r.failed ? `${r.failed} no se pudieron conciliar: revísalos a mano.` : 'Tus cobros, pagos y gastos están al día.')
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo conciliar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

const reanalyze = () => run('suggest', () => call('/api/bank/suggest', { method: 'POST' }), 'Propuestas actualizadas')

const matchTx = ref<Tx | null>(null)
const matchOpen = ref(false)
const expenseTx = ref<Tx | null>(null)
const expenseOpen = ref(false)
const detailTx = ref<Tx | null>(null)
const detailOpen = ref(false)

function openMatch(tx: Tx) {
  matchTx.value = tx
  matchOpen.value = true
}
function openExpense(tx: Tx) {
  expenseTx.value = tx
  expenseOpen.value = true
}
function openDetail(tx: Tx) {
  detailTx.value = tx
  detailOpen.value = true
}

const expandedIds = ref<Set<number>>(new Set())
const truncatedIds = ref<Set<number>>(new Set())

let descObserver: ResizeObserver | null = null
const descElements = new Map<number, HTMLElement>()

function checkDesc(el: HTMLElement, id: number) {
  if (!el) return
  if (expandedIds.value.has(id)) return
  const isOverflow = el.scrollHeight > el.clientHeight + 1
  if (isOverflow && !truncatedIds.value.has(id)) {
    const next = new Set(truncatedIds.value)
    next.add(id)
    truncatedIds.value = next
  } else if (!isOverflow && truncatedIds.value.has(id)) {
    const next = new Set(truncatedIds.value)
    next.delete(id)
    truncatedIds.value = next
  }
}

function observeDesc(el: HTMLElement, id: number) {
  descElements.set(id, el)
  if (typeof ResizeObserver !== 'undefined') {
    if (!descObserver) {
      descObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement
          const targetId = Number(target.dataset.txId)
          if (targetId) checkDesc(target, targetId)
        }
      })
    }
    descObserver.observe(el)
  }
  checkDesc(el, id)
  nextTick(() => checkDesc(el, id))
}

function unobserveDesc(el: HTMLElement, id: number) {
  descElements.delete(id)
  descObserver?.unobserve(el)
  if (truncatedIds.value.has(id)) {
    const next = new Set(truncatedIds.value)
    next.delete(id)
    truncatedIds.value = next
  }
}

const vDetectOverflow = {
  mounted(el: HTMLElement, binding: { value: number }) {
    observeDesc(el, binding.value)
  },
  updated(el: HTMLElement, binding: { value: number }) {
    checkDesc(el, binding.value)
  },
  unmounted(el: HTMLElement, binding: { value: number }) {
    unobserveDesc(el, binding.value)
  },
}

onBeforeUnmount(() => {
  descObserver?.disconnect()
  descObserver = null
  descElements.clear()
})

function toggleExpand(id: number) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next

  if (!next.has(id)) {
    nextTick(() => {
      const el = descElements.get(id)
      if (el) checkDesc(el, id)
    })
  }
}

// ─── Selección: aceptar, ignorar, deshacer o eliminar muchos de una vez (los de la página a la vista) ───

const pageItems = computed(() => data.value?.items ?? [])
const sel = useSelection(pageItems)
const bulkBusy = ref(false)
const plural = (n: number) => `${n} ${n === 1 ? 'movimiento' : 'movimientos'}`

async function bulk(action: 'accept' | 'ignore' | 'unmatch' | 'delete', reason?: string, ids = sel.selected.value) {
  if (!ids.length) return
  if (action === 'delete') {
    const ok = await confirm({
      title: `¿Eliminar ${plural(ids.length)} del banco?`,
      body: 'Solo se borran los movimientos. Los cobros, pagos y gastos con los que estaban conciliados se conservan tal cual.\n\nSi vuelves a importar el mismo extracto, volverán a aparecer.',
      confirmLabel: `Eliminar ${ids.length}`,
      danger: true,
    })
    if (!ok) return
  }
  bulkBusy.value = true
  try {
    const r = await $fetch<{ done: number, skipped: number, failed: number }>('/api/bank/transactions/bulk', { method: 'POST', body: { ids, action, reason } })
    const title = { accept: 'Propuestas aceptadas', ignore: 'Marcados como revisados', unmatch: 'Vuelven a estar por revisar', delete: 'Movimientos eliminados' }[action]
    const extra = [r.skipped ? `${r.skipped} no aplicaban` : '', r.failed ? `${r.failed} no se pudieron` : ''].filter(Boolean).join(' · ')
    if (r.done) toast.success(title, [plural(r.done), extra].filter(Boolean).join(' · '))
    else toast.error('Ningún movimiento cambió', extra || undefined)
    sel.clear()
  }
  catch (err) {
    toast.error('No se pudo completar', errorMessage(err))
  }
  finally {
    bulkBusy.value = false
    await refresh()
  }
}

const bulkActions = computed<BulkAction[]>(() => {
  const picked = sel.selectedRows.value
  const withSuggestion = picked.filter(t => t.status === 'pending' && t.suggestion).length
  const pending = picked.filter(t => t.status === 'pending').length
  const done = picked.length - pending
  const actions: BulkAction[] = []
  if (withSuggestion) actions.push({ label: withSuggestion === picked.length ? 'Aceptar' : `Aceptar ${withSuggestion}`, icon: 'ph:check-bold', tone: 'success', onClick: () => bulk('accept') })
  if (pending) {
    actions.push({
      label: 'Ignorar',
      icon: 'ph:eye-slash',
      menuWidth: 240,
      menu: [
        { heading: 'Marcar como revisados' },
        { label: 'Traspaso entre cuentas', icon: 'ph:arrows-left-right', onClick: () => bulk('ignore', 'Traspaso entre tus cuentas') },
        { label: 'Pago de impuestos', icon: 'ph:bank', onClick: () => bulk('ignore', 'Pago de impuestos') },
        { label: 'Personal', icon: 'ph:user', onClick: () => bulk('ignore', 'Movimiento personal') },
        { label: 'Sin motivo', icon: 'ph:eye-slash', onClick: () => bulk('ignore') },
      ],
    })
  }
  if (done) actions.push({ label: 'Deshacer', icon: 'ph:arrow-counter-clockwise', onClick: () => bulk('unmatch') })
  actions.push({ label: 'Eliminar', icon: 'ph:trash', tone: 'danger', onClick: () => bulk('delete') })
  return actions
})

const bulkSub = computed(() => {
  const picked = sel.selectedRows.value
  const sum = picked.reduce((s, t) => s + t.amount, 0)
  return `${sum > 0 ? '+' : ''}${eur(sum)}`
})

async function removeAccount(a: Account) {
  const ok = await confirm({
    title: `¿Quitar la cuenta ${a.name}?`,
    body: `Se borran sus ${a.total} movimientos importados. Los cobros, pagos y gastos registrados se conservan.`,
    confirmLabel: 'Quitar cuenta',
    danger: true,
  })
  if (!ok) return
  if (account.value === a.id) account.value = null
  await run(a.id, () => call(`/api/bank/accounts/${a.id}`, { method: 'DELETE' }), 'Cuenta quitada')
}

// ─── Clic derecho (o pulsación larga): acciones del movimiento, del lote seleccionado o de la cuenta ───

const ignoreReasons = (tx: Tx | null, apply: (reason?: string) => unknown): CtxItem[] => [
  { label: 'Traspaso entre cuentas', icon: 'ph:arrows-left-right', onClick: () => apply('Traspaso entre tus cuentas') },
  { label: 'Pago de impuestos', icon: 'ph:bank', onClick: () => apply('Pago de impuestos') },
  { label: tx ? (tx.amount > 0 ? 'Ingreso personal' : 'Gasto personal') : 'Personal', icon: 'ph:user', onClick: () => apply(tx ? (tx.amount > 0 ? 'Ingreso personal' : 'Gasto personal') : 'Movimiento personal') },
  { divider: true },
  { label: 'Sin motivo', icon: 'ph:eye-slash', onClick: () => apply() },
]

function txCtx(tx: Tx): CtxSpec {
  const picked = sel.selectedRows.value
  if (!readOnly.value && picked.length > 1 && sel.selectedSet.value.has(tx.id)) {
    const withSuggestion = picked.filter(t => t.status === 'pending' && t.suggestion).length
    const pending = picked.filter(t => t.status === 'pending').length
    return {
      title: `${plural(picked.length)} seleccionados`,
      subtitle: bulkSub.value,
      icon: 'ph:stack',
      items: [
        ...(withSuggestion ? [{ label: withSuggestion === picked.length ? 'Aceptar propuestas' : `Aceptar ${withSuggestion} propuestas`, icon: 'ph:check-bold', onClick: () => bulk('accept') }] : []),
        ...(pending ? [{ label: 'Marcar como revisados', icon: 'ph:eye-slash', children: ignoreReasons(null, r => bulk('ignore', r)) }] : []),
        ...(picked.length > pending ? [{ label: 'Deshacer conciliación', icon: 'ph:arrow-counter-clockwise', onClick: () => bulk('unmatch') }] : []),
        {
          label: 'Copiar suma',
          sub: bulkSub.value,
          icon: 'ph:copy',
          onClick: () => copyText(plainAmount(picked.reduce((a, t) => a + t.amount, 0)), 'Suma'),
        },
        { divider: true },
        { label: 'Quitar este de la selección', icon: 'ph:minus-circle', onClick: () => sel.toggle(tx.id) },
        { label: 'Seleccionar toda la página', icon: 'ph:checks', disabled: sel.allSelected.value, onClick: sel.selectAll },
        { label: 'Quitar la selección', icon: 'ph:x-circle', onClick: sel.clear },
        { divider: true },
        { label: `Eliminar ${plural(picked.length)}`, icon: 'ph:trash', danger: true, onClick: () => bulk('delete') },
      ],
    }
  }
  const amount = `${tx.amount > 0 ? '+' : ''}${eur(tx.amount)}`
  const copy: CtxItem[] = [
    { label: 'Importe', sub: amount, icon: 'ph:currency-eur', onClick: () => copyText(plainAmount(tx.amount), 'Importe') },
    { label: 'Concepto', sub: tx.description, icon: 'ph:text-align-left', onClick: () => copyText(tx.description, 'Concepto') },
    ...(tx.counterparty ? [{ label: tx.amount > 0 ? 'Ordenante' : 'Beneficiario', sub: tx.counterparty, icon: 'ph:user', onClick: () => copyText(tx.counterparty, tx.amount > 0 ? 'Ordenante' : 'Beneficiario') }] : []),
    ...(tx.reference ? [{ label: 'Referencia', sub: tx.reference, icon: 'ph:hash', onClick: () => copyText(tx.reference, 'Referencia') }] : []),
    { label: 'Fecha', sub: fdate(tx.date), icon: 'ph:calendar-blank', onClick: () => copyText(fdate(tx.date), 'Fecha') },
  ]
  const items: CtxItem[] = [{ label: 'Ver detalle', icon: 'ph:info', onClick: () => openDetail(tx) }]
  if (tx.status === 'matched' && tx.link) items.push({ label: tx.link.kind === 'invoice' ? 'Abrir la factura' : 'Abrir el gasto', sub: tx.link.label, icon: tx.link.kind === 'invoice' ? 'ph:receipt' : 'ph:wallet', to: linkTo(tx.link) })
  if (!readOnly.value) {
    items.push({ divider: true })
    if (tx.status === 'pending') {
      if (tx.suggestion) items.push({ label: ACCEPT_LABEL[tx.suggestion.kind], sub: tx.suggestion.label, icon: 'ph:check-bold', onClick: () => accept(tx) })
      items.push({ label: tx.amount > 0 ? 'Buscar factura…' : 'Buscar gasto…', icon: 'ph:magnifying-glass', onClick: () => openMatch(tx) })
      if (tx.amount < 0) {
        items.push(
          { label: 'Crear gasto…', icon: 'ph:plus-circle', onClick: () => openExpense(tx) },
          { label: 'Crear gasto no deducible', icon: 'ph:prohibit', onClick: () => createExpense(tx, 0) },
        )
      }
      items.push({ label: 'Marcar como revisado', icon: 'ph:eye-slash', children: ignoreReasons(tx, r => ignore(tx, r ?? null)) })
    }
    else {
      items.push(
        { label: tx.status === 'matched' ? (tx.amount > 0 ? 'Reasignar a otra factura…' : 'Reasignar a otro gasto…') : (tx.amount > 0 ? 'Asignar a una factura…' : 'Asignar a un gasto…'), icon: tx.status === 'matched' ? 'ph:arrows-left-right' : 'ph:link', onClick: () => openMatch(tx) },
        { label: tx.status === 'matched' ? 'Deshacer conciliación' : 'Volver a pendiente', icon: 'ph:arrow-counter-clockwise', onClick: () => unmatch(tx) },
      )
    }
  }
  items.push({ label: 'Copiar', icon: 'ph:copy', children: copy }, { divider: true })
  if (tx.counterparty && tx.counterparty !== tx.description) items.push({ label: `Solo de ${tx.counterparty}`, icon: 'ph:funnel', onClick: () => (q.value = tx.counterparty!) })
  if (accounts.value.length > 1 && account.value !== tx.accountId) {
    const acc = accounts.value.find(a => a.id === tx.accountId)
    if (acc) items.push({ label: `Solo la cuenta ${acc.name}`, icon: 'ph:bank', onClick: () => (account.value = acc.id) })
  }
  if (!readOnly.value) {
    items.push(
      { divider: true },
      { label: sel.selectedSet.value.has(tx.id) ? 'Quitar de la selección' : 'Seleccionar', icon: sel.selectedSet.value.has(tx.id) ? 'ph:minus-circle' : 'ph:check-square', onClick: () => sel.toggle(tx.id) },
      { divider: true },
      { label: 'Eliminar movimiento', icon: 'ph:trash', danger: true, onClick: () => bulk('delete', undefined, [tx.id]) },
    )
  }
  return { title: tx.counterparty || tx.description, subtitle: `${fdate(tx.date)} · ${amount}`, icon: tx.amount > 0 ? 'ph:arrow-down-left' : 'ph:arrow-up-right', items }
}

function accountCtx(a: Account): CtxSpec {
  const only = accounts.value.length > 1
  return {
    title: a.name,
    subtitle: `${a.bankName && a.bankName !== a.name ? `${a.bankName} · ` : ''}${eur(a.balance)}`,
    icon: 'ph:bank',
    items: [
      ...(only ? [account.value === a.id ? { label: 'Ver todas las cuentas', icon: 'ph:stack', onClick: () => (account.value = null) } : { label: 'Ver solo esta cuenta', icon: 'ph:funnel', onClick: () => (account.value = a.id) }] : []),
      ...(a.pending ? [{ label: 'Movimientos por revisar', sub: plural(a.pending), icon: 'ph:list-checks', onClick: () => { account.value = only ? a.id : null; status.value = 'pending' } }] : []),
      ...(readOnly.value ? [] : [{ label: 'Importar extracto…', icon: 'ph:upload-simple', onClick: () => (importOpen.value = true) }]),
      { divider: true },
      ...(a.iban ? [{ label: 'Copiar IBAN', sub: a.iban.replace(/(.{4})/g, '$1 ').trim(), icon: 'ph:copy', onClick: () => copyText(a.iban!.replace(/\s+/g, ''), 'IBAN') }] : []),
      { label: 'Copiar saldo', sub: eur(a.balance), icon: 'ph:currency-eur', onClick: () => copyText(plainAmount(a.balance), 'Saldo') },
      ...(readOnly.value ? [] : [{ divider: true }, { label: 'Quitar cuenta', icon: 'ph:trash', danger: true, onClick: () => removeAccount(a) }]),
    ],
  }
}

const SUGGEST_ICON: Record<Suggestion['kind'], string> = {
  invoice: 'ph:receipt',
  expense: 'ph:wallet',
  payment: 'ph:link-simple',
  new_expense: 'ph:plus-circle',
  ignore: 'ph:eye-slash',
}
const ACCEPT_LABEL: Record<Suggestion['kind'], string> = {
  invoice: 'Cobrar',
  expense: 'Conciliar',
  payment: 'Enlazar',
  new_expense: 'Crear gasto',
  ignore: 'Aceptar',
}
const confidenceTone = (c: number) => (c >= 85 ? 'high' : c >= 65 ? 'mid' : 'low')
const ibanTail = (iban: string | null) => (iban ? `${iban.slice(0, 4)} ···· ${iban.slice(-4)}` : 'Sin IBAN')
const linkTo = (l: NonNullable<Tx['link']>) => (l.kind === 'invoice' ? `/facturas/${l.id}` : `/gastos?ver=${l.id}`)
const pages = computed(() => pageCount(data.value?.total ?? 0, data.value?.pageSize))
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Banco</h1>
        <p class="sub">Importa tus extractos y NUMIQ casa cada cobro con su factura y cada cargo con su gasto.</p>
      </div>
      <div v-if="!readOnly" class="page-actions">
        <UiButton v-if="accounts.length" icon="ph:arrows-clockwise" :loading="busy === 'suggest'" class="hide-sm" @click="reanalyze">Volver a analizar</UiButton>
        <UiButton variant="primary" icon="ph:upload-simple" @click="importOpen = true">Importar extracto</UiButton>
      </div>
    </header>

    <div v-if="firstLoad" class="stack gap-4">
      <div class="accs">
        <div v-for="i in 2" :key="i" class="skeleton" style="height: 128px; border-radius: var(--r-xl)" />
      </div>
      <div class="skeleton" style="height: 420px; border-radius: var(--r-xl)" />
    </div>

    <!-- Sin cuentas: cómo empezar -->
    <UiCard v-else-if="!accounts.length" class="rise">
      <div class="intro">
        <span class="intro-ic" aria-hidden="true"><Icon name="ph:bank" /></span>
        <h2>Concilia tu banco en un minuto</h2>
        <p>Descarga el extracto desde tu banca online y súbelo. NUMIQ registra los cobros de tus facturas, enlaza los pagos de tus gastos y te propone el resto: cuota de autónomos, comisiones, suministros…</p>
        <ul class="intro-steps">
          <li><span class="num">1</span> Banca online → Movimientos → <strong>Exportar</strong></li>
          <li><span class="num">2</span> Formato <strong>Norma 43</strong>, Excel o CSV</li>
          <li><span class="num">3</span> Súbelo aquí y revisa las propuestas</li>
        </ul>
        <UiButton v-if="!readOnly" variant="primary" size="lg" icon="ph:upload-simple" @click="importOpen = true">Importar mi primer extracto</UiButton>
      </div>
    </UiCard>

    <template v-else>
      <section class="accs rise" aria-label="Cuentas">
        <button v-if="accounts.length > 1" type="button" class="acc all" :class="{ on: account === null }" @click="account = null">
          <span class="acc-top">
            <span class="acc-mark all-mark" aria-hidden="true"><Icon name="ph:stack" /></span>
            <span class="min0">
              <span class="acc-name">Todas las cuentas</span>
              <span class="acc-sub">{{ accounts.length }} cuentas</span>
            </span>
          </span>
          <span class="acc-bal num">{{ eur(totalBalance) }}</span>
          <span class="acc-foot">Saldo total</span>
        </button>
        <div v-for="a in accounts" :key="a.id" v-ctx="() => accountCtx(a)" class="acc" :class="{ on: account === a.id || accounts.length === 1 }" role="button" tabindex="0" @click="account = accounts.length > 1 ? a.id : null" @keydown.enter="account = accounts.length > 1 ? a.id : null">
          <span class="acc-top">
            <span class="acc-mark" :style="{ '--h': hueOf(a.bankName ?? a.name) }" aria-hidden="true">{{ initials(a.bankName ?? a.name) }}</span>
            <span class="min0 grow">
              <span class="acc-name truncate">{{ a.name }}</span>
              <span class="acc-sub mono">{{ ibanTail(a.iban) }}</span>
            </span>
            <UiMenu v-if="!readOnly" :items="[{ label: 'Quitar cuenta', icon: 'ph:trash', danger: true, onClick: () => removeAccount(a) }]" :width="200">
              <template #default="{ toggle }">
                <UiButton size="sm" variant="ghost" square icon="ph:dots-three-bold" :aria-label="`Opciones de ${a.name}`" @click.stop="toggle" />
              </template>
            </UiMenu>
          </span>
          <span class="acc-bal num">{{ eur(a.balance) }}</span>
          <span class="acc-foot">
            {{ a.balanceAt ? `Saldo a ${fdate(a.balanceAt)}` : 'Sin saldo' }}
            <span v-if="a.pending" class="acc-pend">{{ a.pending }} por revisar</span>
            <span v-else-if="a.total" class="acc-ok"><Icon name="ph:check-circle-fill" aria-hidden="true" /> Al día</span>
          </span>
        </div>
      </section>

      <div v-if="data && data.stats.ready && (status === 'pending' || status === 'all') && !readOnly" class="ready rise" style="--i: 1">
        <span class="ready-ic" aria-hidden="true"><Icon name="ph:lightning-fill" /></span>
        <div class="grow min0">
          <p class="ready-t">{{ data.stats.ready }} {{ data.stats.ready === 1 ? 'movimiento listo' : 'movimientos listos' }} para conciliar</p>
          <p class="ready-s">Casan sin dudas con tus facturas, gastos o cobros ya anotados, o son cargos típicos como la cuota de autónomos o las comisiones.</p>
        </div>
        <UiButton variant="primary" icon="ph:checks-bold" :loading="busy === 'auto'" @click="autoMatch">Conciliar {{ data.stats.ready }}</UiButton>
      </div>

      <UiCard padding="none" class="rise" style="--i: 2">
        <div class="toolbar">
          <UiSegmented v-model="status" :options="statusOptions" label="Estado" />
          <UiInput v-model="q" icon="ph:magnifying-glass" placeholder="Concepto o importe" aria-label="Buscar movimientos" type="search" class="search" />
        </div>

        <UiEmpty v-if="data && !data.items.length && status === 'pending' && !qDebounced" compact icon="ph:check-circle" title="Todo conciliado" text="No tienes movimientos por revisar. Importa el siguiente extracto cuando quieras.">
          <UiButton v-if="!readOnly" icon="ph:upload-simple" @click="importOpen = true">Importar extracto</UiButton>
        </UiEmpty>
        <UiEmpty v-else-if="data && !data.items.length" compact icon="ph:funnel" title="Ningún movimiento" text="Prueba con otro filtro o búsqueda." />

        <ul v-else-if="data" class="txs" :class="{ dim: loadStatus === 'pending', picking: !readOnly }">
          <li v-for="tx in data.items" :key="tx.id" v-ctx="() => txCtx(tx)" class="tx" :class="[tx.status, { busy: busy === tx.id, sel: sel.selectedSet.value.has(tx.id) }]">
            <span v-if="!readOnly" class="pick" @click="sel.toggle(tx.id, $event)">
              <input
                type="checkbox"
                :checked="sel.selectedSet.value.has(tx.id)"
                :aria-label="`Seleccionar ${tx.description} de ${eur(tx.amount)}`"
                @click.stop="sel.toggle(tx.id, $event)"
              >
            </span>
            <div class="t-date">
              <span class="d-day num">{{ tx.date.slice(8, 10) }}</span>
              <span class="d-mon">{{ fmonth(tx.date.slice(0, 7)) }}</span>
            </div>
            <div class="t-main min0">
              <div class="t-desc-row">
                <p
                  v-detect-overflow="tx.id"
                  :data-tx-id="tx.id"
                  class="t-desc"
                  :class="{ expanded: expandedIds.has(tx.id) }"
                  :title="tx.description"
                  @click="(truncatedIds.has(tx.id) || expandedIds.has(tx.id)) ? toggleExpand(tx.id) : openDetail(tx)"
                >
                  {{ tx.description }}
                </p>
                <button
                  v-if="truncatedIds.has(tx.id) || expandedIds.has(tx.id)"
                  type="button"
                  class="t-expand-btn"
                  :title="expandedIds.has(tx.id) ? 'Contraer texto' : 'Ver descripción completa'"
                  :aria-label="expandedIds.has(tx.id) ? 'Contraer' : 'Expandir'"
                  @click.stop="toggleExpand(tx.id)"
                >
                  <Icon :name="expandedIds.has(tx.id) ? 'ph:caret-up-bold' : 'ph:caret-down-bold'" />
                </button>
              </div>
              <p class="t-sub">
                <span v-if="accounts.length > 1 && !account">{{ accounts.find(a => a.id === tx.accountId)?.name }}</span>
                <span v-if="tx.bankCode && BANK_CODES[tx.bankCode]">{{ BANK_CODES[tx.bankCode] }}</span>
                <span v-if="tx.counterparty" class="t-counterparty">{{ tx.counterparty }}</span>
                <span class="d-full">{{ fdate(tx.date) }}</span>
                <button type="button" class="t-info-link" title="Ver toda la información guardada de este movimiento" @click.stop="openDetail(tx)">
                  <Icon name="ph:info" /> Ver detalle
                </button>
              </p>
            </div>

            <div class="t-match">
              <!-- Conciliado -->
              <NuxtLink v-if="tx.status === 'matched' && tx.link" :to="linkTo(tx.link)" class="chip ok">
                <Icon name="ph:check-circle-fill" aria-hidden="true" />
                <span class="min0"><span class="c-l truncate">{{ tx.link.label }}</span><span v-if="tx.link.detail" class="c-d truncate">{{ tx.link.detail }}</span></span>
              </NuxtLink>
              <span v-else-if="tx.status === 'matched'" class="chip ok"><Icon name="ph:check-circle-fill" aria-hidden="true" /><span class="c-l">Conciliado</span></span>
              <!-- Ignorado -->
              <span v-else-if="tx.status === 'ignored'" class="chip muted-chip"><Icon name="ph:eye-slash" aria-hidden="true" /><span class="c-l truncate">{{ tx.ignoreReason || 'Revisado sin documento' }}</span></span>
              <!-- Propuesta -->
              <div v-else-if="tx.suggestion" class="sug" :class="[tx.suggestion.kind, confidenceTone(tx.suggestion.confidence)]">
                <span class="sug-ic" aria-hidden="true"><Icon :name="tx.suggestion.source === 'ai' ? 'ph:sparkle-fill' : SUGGEST_ICON[tx.suggestion.kind]" /></span>
                <span class="min0 grow">
                  <span class="c-l truncate">{{ tx.suggestion.label }}</span>
                  <span class="c-d truncate">{{ tx.suggestion.detail || (tx.suggestion.source === 'ai' ? 'Propuesta de la IA' : '') }}</span>
                </span>
                <span v-if="dedTag(tx.suggestion)" class="ded-tag" :class="dedTag(tx.suggestion)!.level">{{ dedTag(tx.suggestion)!.label }}</span>
                <span class="conf" :title="`Confianza ${tx.suggestion.confidence} %`" :aria-label="`Confianza ${tx.suggestion.confidence} %`">
                  <span v-for="i in 3" :key="i" :class="{ on: tx.suggestion.confidence >= [0, 65, 85][i - 1]! }" />
                </span>
              </div>
              <span v-else class="none">Sin coincidencias</span>
            </div>

            <p class="t-amt num" :class="{ pos: tx.amount > 0 }">{{ tx.amount > 0 ? '+' : '' }}{{ eur(tx.amount) }}</p>

            <div v-if="!readOnly" class="t-act">
              <template v-if="tx.status === 'pending'">
                <UiButton v-if="tx.suggestion" size="sm" :variant="tx.suggestion.confidence >= 85 ? 'primary' : 'secondary'" icon="ph:check-bold" :loading="busy === tx.id" @click="accept(tx)">
                  {{ ACCEPT_LABEL[tx.suggestion.kind] }}
                </UiButton>
                <UiButton v-else size="sm" icon="ph:magnifying-glass" @click="openMatch(tx)">Buscar</UiButton>
              </template>
              <template v-else-if="tx.status === 'matched'">
                <UiButton size="sm" variant="ghost" icon="ph:arrows-left-right" title="Reasignar a otra factura o gasto" @click="openMatch(tx)">
                  Reasignar
                </UiButton>
              </template>
              <UiRowMenuButton :menu="() => txCtx(tx)" label="Más acciones" />
            </div>
          </li>
        </ul>

        <UiPager v-model="page" v-model:size="pageSize" :pages="pages" :total="data?.total" />
      </UiCard>

      <UiBulkBar
        :count="sel.selected.value.length"
        :total="pageItems.length"
        :title="sel.selected.value.length === 1 ? 'movimiento seleccionado' : 'movimientos seleccionados'"
        :sub="bulkSub"
        :actions="bulkActions"
        :busy="bulkBusy"
        label="Acciones con los movimientos seleccionados"
        @all="sel.toggleAll"
        @clear="sel.clear"
      />
    </template>

    <BankImportModal v-model="importOpen" :accounts="accounts" @imported="onImported" />
    <BankMatchModal v-model="matchOpen" :tx="matchTx" @matched="refresh" />
    <BankExpenseModal v-model="expenseOpen" :tx="expenseTx" @created="refresh" />
    <BankDetailModal
      v-model="detailOpen"
      :tx="detailTx"
      :account="accounts.find(a => a.id === detailTx?.accountId)"
      :bank-codes="BANK_CODES"
      @accept="detailTx && accept(detailTx)"
      @open-match="detailTx && openMatch(detailTx)"
      @open-expense="detailTx && openExpense(detailTx)"
      @ignore="detailTx && ignore(detailTx)"
      @unmatch="detailTx && unmatch(detailTx)"
    />
  </div>
</template>

<script lang="ts">
/** Conceptos comunes AEB (Norma 43) para la línea secundaria */
const BANK_CODES: Record<string, string> = {
  '01': 'Reintegro',
  '02': 'Ingreso',
  '03': 'Recibo',
  '04': 'Transferencia',
  '05': 'Préstamo',
  '11': 'Cajero',
  '12': 'Tarjeta',
  '14': 'Devolución',
  '15': 'Seguros sociales',
  '17': 'Comisiones',
}
</script>

<style scoped>
.accs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: var(--s-4);
  margin-bottom: var(--s-5);
}

.acc {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--s-4) var(--s-5);
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition: border-color var(--t-fast), box-shadow var(--t-base);
}

.acc:hover {
  box-shadow: var(--shadow-md);
}

.acc.on {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px var(--brand), var(--shadow-sm);
}

.acc:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.acc-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--s-2);
}

.acc-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  font-size: 13px;
  font-weight: 700;
  color: hsl(var(--h, 230) 60% 38%);
  background: hsl(var(--h, 230) 70% 94%);
  border-radius: 10px;
}

:root[data-theme='dark'] .acc-mark {
  color: hsl(var(--h, 230) 70% 78%);
  background: hsl(var(--h, 230) 30% 20%);
}

.all-mark {
  font-size: 18px;
  color: var(--brand);
  background: var(--brand-soft);
}

.acc-name {
  display: block;
  font-weight: 620;
  line-height: 1.3;
}

.acc-sub {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.acc-bal {
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.acc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  font-size: var(--text-xs);
  color: var(--text-3);
}

.acc-pend {
  padding: 2px 8px;
  font-weight: 600;
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: var(--r-full);
}

.acc-ok {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  color: var(--success);
}

.ready {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  margin-bottom: var(--s-5);
  padding: var(--s-4) var(--s-5);
  background: linear-gradient(120deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 40%, var(--surface)));
  border: 1px solid var(--brand-soft-2);
  border-radius: var(--r-xl);
}

.ready-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  font-size: 20px;
  color: var(--on-brand);
  background: var(--brand);
  border-radius: 12px;
  box-shadow: 0 6px 16px -6px var(--brand);
}

.ready-t {
  font-weight: 650;
}

.ready-s {
  font-size: var(--text-sm);
  color: var(--text-2);
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

.search {
  width: 260px;
}

.txs {
  margin: 0;
  padding: 0;
  list-style: none;
  transition: opacity var(--t-base);
}

.txs.dim {
  opacity: 0.6;
}

.tx {
  display: grid;
  grid-template-columns: 44px minmax(0, 1.35fr) minmax(0, 1fr) 118px auto;
  align-items: center;
  gap: var(--s-4);
  padding: 12px var(--s-5);
  transition: background var(--t-fast), opacity var(--t-base);
}

.tx + .tx {
  border-top: 1px solid var(--border-subtle);
}

/* ─── Selección: una columna de casillas delante ─── */

.picking .tx {
  grid-template-columns: 18px 44px minmax(0, 1.35fr) minmax(0, 1fr) 118px auto;
  padding-left: var(--s-4);
}

.pick {
  display: grid;
  place-items: center;
  align-self: stretch;
  cursor: pointer;
}

.pick input {
  display: block;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--brand);
  cursor: pointer;
}

.tx.sel,
.tx.sel:hover {
  background: color-mix(in srgb, var(--brand) 6%, transparent);
}

.tx:hover {
  background: var(--surface-hover);
}

.tx.busy {
  opacity: 0.6;
}

.t-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.1;
}

.d-day {
  font-size: var(--text-lg);
  font-weight: 700;
}

.d-mon {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-3);
}

.t-desc-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.t-desc {
  font-size: var(--text-sm);
  font-weight: 560;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition: color var(--t-fast);
}

.t-desc:hover {
  color: var(--brand-text);
}

.t-desc.expanded {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
  white-space: pre-wrap;
}

.t-expand-btn {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  font-size: 11px;
  color: var(--text-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-xs);
  cursor: pointer;
  transition: all var(--t-fast);
}

.t-expand-btn:hover {
  color: var(--brand-text);
  border-color: var(--brand-subtle);
  background: var(--surface-hover);
}

.t-counterparty {
  font-weight: 540;
  color: var(--text-2);
}

.t-info-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: none;
  border: 0;
  padding: 0;
  font-size: 11px;
  color: var(--text-3);
  cursor: pointer;
  transition: color var(--t-fast);
}

.t-info-link:hover {
  color: var(--brand-text);
  text-decoration: underline;
}

/* En línea (no flex): el «·» va pegado al dato que separa y nunca abre una línea */
.t-sub {
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--text-3);
  overflow-wrap: anywhere;
}

.t-sub span + span::before {
  content: '·';
  margin: 0 6px;
}

.t-sub .t-info-link {
  margin-left: 8px;
  vertical-align: baseline;
}

.d-full {
  display: none;
}

.t-amt {
  font-weight: 650;
  text-align: right;
  white-space: nowrap;
}

.t-amt.pos {
  color: var(--success);
}

.t-act {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 150px;
}

.chip,
.sug {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 10px;
  border-radius: var(--r-md);
}

.chip :deep(svg),
.sug-ic {
  flex: none;
}

.chip.ok {
  color: var(--success);
  background: var(--success-soft);
  transition: filter var(--t-fast);
}

a.chip.ok:hover {
  filter: brightness(0.97);
}

.chip.ok .c-l {
  color: var(--text);
}

.muted-chip {
  color: var(--text-3);
  background: var(--surface-sunken);
}

.c-l {
  display: block;
  font-size: var(--text-sm);
  font-weight: 580;
}

.c-d {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.sug {
  background: var(--surface-sunken);
  border: 1px dashed var(--border-strong);
}

.sug.high {
  background: var(--brand-soft);
  border: 1px solid var(--brand-soft-2);
}

.sug-ic {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  color: var(--brand);
  background: var(--surface);
  border-radius: 8px;
}

.sug.ignore .sug-ic {
  color: var(--text-3);
}

.sug.new_expense .sug-ic {
  color: var(--warning);
}

.ded-tag {
  flex: none;
  padding: 2px 7px;
  font-size: var(--text-2xs);
  font-weight: 600;
  white-space: nowrap;
  border-radius: var(--r-full);
}

.ded-tag.none {
  color: var(--text-2);
  background: var(--surface-active);
}

.ded-tag.partial {
  color: var(--warning);
  background: var(--warning-soft);
}

.conf {
  display: flex;
  gap: 3px;
  flex: none;
}

.conf span {
  width: 5px;
  height: 12px;
  background: var(--border-strong);
  border-radius: 2px;
}

.conf span.on {
  background: var(--brand);
}

.sug.low .conf span.on {
  background: var(--warning-solid);
}

.none {
  font-size: var(--text-sm);
  color: var(--text-4);
}

.intro {
  max-width: 560px;
  margin: 0 auto;
  padding: var(--s-7) 0;
  text-align: center;
}

.intro-ic {
  display: inline-grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--s-4);
  font-size: 30px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: 20px;
}

.intro h2 {
  font-size: var(--text-xl);
  letter-spacing: -0.02em;
}

.intro p {
  margin-top: var(--s-2);
  color: var(--text-2);
}

.intro-steps {
  display: grid;
  gap: 8px;
  margin: var(--s-5) auto var(--s-6);
  padding: 0;
  max-width: 400px;
  list-style: none;
  text-align: left;
}

.intro-steps li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.intro-steps .num {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  font-size: 12px;
  font-weight: 700;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 50%;
}

.min0 {
  min-width: 0;
}

/* Por el ancho real del contenido (con la barra lateral, una tableta deja ~870 px): la propuesta
   y las acciones bajan debajo de la descripción antes de que se aprieten */
.page {
  container: bank / inline-size;
}

@container bank (max-width: 1000px) {
  .tx {
    grid-template-columns: 44px minmax(0, 1fr) 110px;
    grid-template-areas:
      'date main amt'
      'date match match'
      'date act act';
    row-gap: 8px;
  }

  .picking .tx {
    grid-template-columns: 18px 44px minmax(0, 1fr) 110px;
    grid-template-areas:
      'pick date main amt'
      'pick date match match'
      'pick date act act';
  }

  .pick { grid-area: pick; align-self: start; margin-top: 5px; }
  .t-date { grid-area: date; align-self: start; }
  .t-main { grid-area: main; }
  .t-amt { grid-area: amt; align-self: start; }
  .t-match { grid-area: match; }
  .t-act { grid-area: act; justify-content: flex-start; min-width: 0; }
}

@media (max-width: 640px) {
  .ready {
    flex-wrap: wrap;
  }

  .ready > :last-child {
    width: 100%;
  }

  .search {
    width: 100%;
  }

  .toolbar {
    padding-inline: var(--s-4);
  }

  /* Arriba la descripción a todo el ancho; debajo la propuesta; abajo acciones e importe */
  .tx {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'main main'
      'match match'
      'act amt';
    row-gap: 10px;
    padding: 14px var(--s-4);
  }

  .picking .tx {
    grid-template-columns: 18px minmax(0, 1fr) auto;
    grid-template-areas:
      'pick main main'
      'pick match match'
      'pick act amt';
    column-gap: var(--s-3);
  }

  .t-desc {
    font-size: var(--text-md);
    font-weight: 600;
    -webkit-line-clamp: 4;
  }

  .t-amt {
    align-self: center;
    font-size: 1rem;
  }

  .t-date {
    display: none;
  }

  .d-full {
    display: inline;
  }

  .t-act {
    justify-content: flex-start;
  }

  .hide-sm {
    display: none;
  }
}
</style>
