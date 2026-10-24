<script setup lang="ts">
import type { ImportItemStatus, ImportItemType, ImportUndoSummary } from '#shared/types/import'

interface Row {
  id: number
  fileId: number | null
  file: string | null
  type: ImportItemType
  status: ImportItemStatus
  confidence: number | null
  warnings: string[]
  duplicate: string | null
  duplicateRef: { type: string, id: number } | null
  resultId: number | null
  contactId: number | null
  title: string
  subtitle: string | null
  date: string | null
  amount: number | null
  /** Presupuestos y proformas: el importe es la base imponible */
  amountBase?: boolean
  docType?: string
  newContact?: boolean
  role?: string
  folder?: string
  /** Factura emitida: documentos del lote que se le adjuntarán */
  linked?: number
  /** Pedido, albarán…: registro de la factura a la que acompaña */
  linkedTo?: number | null
}

interface Detail {
  batch: {
    id: number
    name: string | null
    source: 'upload' | 'scan' | 'email'
    status: 'uploading' | 'processing' | 'review' | 'done' | 'failed'
    totalFiles: number
    processedFiles: number
    createdAt: string
    running: boolean
    summary: Record<string, number> | null
    options: { createItems: boolean, markPaid: boolean } | null
  }
  files: Array<{ id: number, name: string, path: string, size: number, mime: string, aiStatus: string, aiError: string | null }>
  counts: Record<ImportItemStatus, number>
  items: Row[]
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const id = Number(route.params.id)

const { data, refresh, error } = await useFetch<Detail>(`/api/imports/${id}`)
useHead({ title: computed(() => `${data.value?.batch.name ?? 'Importación'} · NUMIQ`) })

const running = computed(() => !!data.value && (data.value.batch.running || data.value.batch.status === 'processing'))
const { pause, resume } = useIntervalFn(() => refresh(), 1500, { immediate: false })
watch(running, v => (v ? resume() : pause()), { immediate: true })

const progress = computed(() => {
  const b = data.value?.batch
  return b?.totalFiles ? Math.round(b.processedFiles / b.totalFiles * 100) : 0
})
const reading = computed(() => data.value?.files.filter(f => f.aiStatus === 'processing') ?? [])
const failed = computed(() => data.value?.files.filter(f => f.aiStatus === 'failed') ?? [])

// ─── Filtros ───

// Filtros en la URL: al volver atrás desde un documento importado, la revisión sigue igual
const status = useQueryState<'all' | ImportItemStatus>('estado', 'all')
// Filtro por clase: los presupuestos aparte de las facturas emitidas
const types = useQueryState<string[]>('clases', [], { parse: r => r.split(',').filter(Boolean), format: v => v.join(',') })
const q = useQueryState('q', '', { debounce: 250 })

const statusOptions = computed(() => {
  const c = data.value?.counts
  const opt = (value: string, label: string, count?: number) => ({ value, label, count: count ?? null })
  return [
    opt('all', 'Todo', data.value?.items.length),
    opt('ready', 'Listos', c?.ready),
    opt('warning', 'Revisar', c?.warning),
    ...(c?.error ? [opt('error', 'Incompletos', c.error)] : []),
    ...(c?.duplicate ? [opt('duplicate', 'Duplicados', c.duplicate)] : []),
    ...(c?.imported ? [opt('imported', 'Importados', c.imported)] : []),
    ...(c?.excluded ? [opt('excluded', 'Excluidos', c.excluded)] : []),
  ]
})
const statusModel = computed({ get: () => status.value as string, set: (v: string) => { status.value = v as typeof status.value } })

const typeCounts = computed(() => {
  const m = new Map<string, number>()
  for (const it of data.value?.items ?? []) m.set(kindOf(it), (m.get(kindOf(it)) ?? 0) + 1)
  return [...m.entries()]
})

function toggleType(t: string) {
  types.value = types.value.includes(t) ? types.value.filter(x => x !== t) : [...types.value, t]
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const filtered = computed(() => {
  const query = norm(q.value.trim())
  return (data.value?.items ?? []).filter(it =>
    (status.value === 'all' || it.status === status.value)
    && (!types.value.length || types.value.includes(kindOf(it)))
    && (!query || norm(`${it.title} ${it.subtitle ?? ''} ${it.file ?? ''}`).includes(query)))
})
// Cada pedido o albarán vinculado, justo debajo de su factura (si la factura se ve con estos filtros)
const nested = computed(() => {
  const shown = new Set(filtered.value.map(r => r.id))
  return new Set(filtered.value.filter(r => r.linkedTo && shown.has(r.linkedTo)).map(r => r.id))
})
const rows = computed(() => {
  const children = new Map<number, Row[]>()
  for (const r of filtered.value) if (nested.value.has(r.id)) children.set(r.linkedTo!, [...(children.get(r.linkedTo!) ?? []), r])
  return filtered.value.flatMap(r => (nested.value.has(r.id) ? [] : [r, ...(children.get(r.id) ?? [])]))
})
const { page, pages, items: shown, size: pageSize, total: pageTotal } = usePaged(rows, [status, types, q], 'pagina')
const isQuoteRow = (r: Row) => r.type === 'sales' && (r.docType === 'quote' || r.docType === 'proforma')
const kindOf = (r: Row) => (isQuoteRow(r) ? 'quote' : r.type)
const rowType = (r: Row) => (isQuoteRow(r)
  ? { label: r.docType === 'proforma' ? 'Proforma' : 'Presupuesto', icon: 'ph:file-text', tone: 'quote' }
  : r.linkedTo ? { label: 'Adjunto', icon: 'ph:paperclip', tone: 'att' } : { ...IMPORT_TYPE[r.type]!, tone: r.type })

const pendingCount = computed(() => (data.value?.counts.ready ?? 0) + (data.value?.counts.warning ?? 0))

const totals = computed(() => {
  // Los presupuestos no son ingresos: no suman a las emitidas
  const pick = (t: ImportItemType) => (data.value?.items ?? []).filter(i => i.type === t && !isQuoteRow(i) && i.status !== 'excluded' && i.status !== 'duplicate')
  const sum = (list: Row[]) => list.reduce((s, i) => s + (i.amount ?? 0), 0)
  return { sales: { n: pick('sales').length, total: sum(pick('sales')) }, expense: { n: pick('expense').length, total: sum(pick('expense')) } }
})

// ─── Acciones ───

const panelOpen = ref(false)
const panelItem = ref<number | null>(null)
function openItem(r: Row) {
  panelItem.value = r.id
  panelOpen.value = true
}

const committing = ref(false)
async function commitAll() {
  committing.value = true
  try {
    const r = await $fetch<{ imported: number, failed: Array<{ id: number, message: string }>, summary: Record<string, number> }>(`/api/imports/${id}/commit`, { method: 'POST', body: {} })
    if (r.imported) toast.success(`${r.imported} registro${r.imported > 1 ? 's' : ''} importado${r.imported > 1 ? 's' : ''}`, [r.failed.length ? `${r.failed.length} con errores: revísalos` : '', r.summary.duplicates ? `${r.summary.duplicates} duplicados omitidos` : ''].filter(Boolean).join(' · ') || undefined)
    else if (r.failed.length) toast.error('No se pudo importar', r.failed[0]!.message)
    else if (r.summary.duplicates) toast.info('No hay registros nuevos', `${r.summary.duplicates} duplicados omitidos`)
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo importar', errorMessage(err))
  }
  finally {
    committing.value = false
  }
}

const retrying = ref(false)
async function retry() {
  retrying.value = true
  try {
    await $fetch(`/api/imports/${id}/retry`, { method: 'POST' })
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo reintentar', errorMessage(err))
  }
  finally {
    retrying.value = false
  }
}

async function discard() {
  const ok = await confirm({
    title: imported.value ? '¿Descartar lo que falta?' : '¿Descartar esta importación?',
    body: imported.value ?'Lo ya importado se conserva. Se borran los registros sin importar y sus archivos.' : 'Se borran los archivos subidos y lo leído. No se ha creado nada en tus facturas ni gastos.',
    confirmLabel: 'Descartar',
    danger: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/imports/${id}`, { method: 'DELETE' })
    toast.success('Importación descartada')
    await router.push('/documentos')
  }
  catch (err) {
    toast.error('No se pudo descartar', errorMessage(err))
  }
}

// Con algo ya importado: descartar solo lo pendiente, o eliminar la importación con todo lo que creó
const imported = computed(() => data.value?.counts.imported ?? 0)
const undoOpen = ref(false)
const removeItems = computed(() => [
  { label: 'Descartar solo lo pendiente', icon: 'ph:broom', onClick: discard },
  { label: 'Eliminar también lo importado', icon: 'ph:trash', danger: true, onClick: () => (undoOpen.value = true) },
])

async function undone(r: ImportUndoSummary) {
  // Si quedan emitidas que no se pueden borrar, la importación sigue con ellas
  if (r.kept.invoices) await refresh()
  else await router.push('/documentos')
}

function resultLink(r: Row) {
  if (!r.resultId) return null
  if (isQuoteRow(r)) return `/presupuestos/${r.resultId}`
  if (r.linkedTo) {
    // Adjunto: se ve en su factura (la importada ahora o la que ya existía)
    const inv = data.value?.items.find(i => i.id === r.linkedTo)
    const invoiceId = inv?.resultId ?? (inv?.duplicateRef?.type === 'sales' ? inv.duplicateRef.id : null)
    if (invoiceId && r.status === 'imported' && inv?.status !== 'excluded') return `/facturas/${invoiceId}`
  }
  if (r.type === 'sales') return `/facturas/${r.resultId}`
  if (r.type === 'expense') return `/gastos?ver=${r.resultId}`
  if (r.type === 'contact') return `/clientes/${r.resultId}`
  if (r.type === 'item') return '/productos'
  return '/documentos/archivo'
}

const SOURCE: Record<string, string> = { upload: 'Subida de archivos', scan: 'Escaneo', email: 'Correo' }
const done = computed(() => data.value?.batch.status === 'done')
const summary = computed(() => {
  const s = data.value?.batch.summary ?? {}
  return [
    { n: s.invoices ?? 0, label: 'facturas emitidas', icon: 'ph:receipt', to: '/facturas' },
    { n: s.quotes ?? 0, label: 'presupuestos', icon: 'ph:file-text', to: '/presupuestos' },
    { n: s.expenses ?? 0, label: 'gastos', icon: 'ph:wallet', to: '/gastos' },
    { n: s.contactsCreated ?? 0, label: 'contactos nuevos', icon: 'ph:address-book', to: '/clientes' },
    { n: s.itemsCreated ?? 0, label: 'productos nuevos', icon: 'ph:package', to: '/productos' },
    { n: s.attachments ?? 0, label: 'adjuntos a facturas', icon: 'ph:paperclip', to: '/facturas' },
    { n: s.vault ?? 0, label: 'al archivo', icon: 'ph:archive', to: '/documentos/archivo' },
  ].filter(x => x.n)
})
</script>

<template>
  <div class="page">
    <NuxtLink to="/documentos" class="back"><Icon name="ph:arrow-left" aria-hidden="true" /> Documentos</NuxtLink>

    <UiEmpty v-if="error" icon="ph:warning-circle" title="No se encontró esta importación" text="Puede que se haya descartado.">
      <UiButton to="/documentos" variant="secondary">Volver</UiButton>
    </UiEmpty>

    <template v-else-if="data">
      <header class="page-head">
        <div class="min0">
          <h1 class="truncate">{{ data.batch.name || `Importación ${id}` }}</h1>
          <p class="sub">{{ SOURCE[data.batch.source] }} · {{ fdate(data.batch.createdAt) }} · {{ data.batch.totalFiles }} archivo{{ data.batch.totalFiles === 1 ? '' : 's' }}</p>
        </div>
        <div class="page-actions">
          <UiButton v-if="!done && !imported" variant="ghost" icon="ph:trash" :disabled="running" @click="discard">Descartar</UiButton>
          <UiMenu v-else-if="!done" :items="removeItems" :width="280">
            <template #default="{ toggle }">
              <UiButton square variant="ghost" icon="ph:dots-three-bold" aria-label="Descartar o eliminar" :disabled="running" @click="toggle" />
            </template>
          </UiMenu>
          <UiButton v-else variant="ghost" icon="ph:trash" @click="undoOpen = true">Eliminar</UiButton>
          <UiButton v-if="pendingCount" variant="primary" icon="ph:check" :loading="committing" :disabled="running" @click="commitAll">Importar {{ pendingCount }}</UiButton>
        </div>
      </header>

      <!-- Leyendo -->
      <section v-if="running" class="card reading rise" aria-live="polite">
        <div class="r-art" aria-hidden="true"><Icon name="ph:sparkle-fill" /></div>
        <div class="grow min0">
          <p class="r-t">Leyendo con IA · <span class="num">{{ data.batch.processedFiles }} de {{ data.batch.totalFiles }}</span></p>
          <div class="bar"><span :style="{ width: `${Math.max(progress, 4)}%` }" /></div>
          <p class="r-s truncate">{{ reading.length ? reading.map(f => f.name).join(' · ') : 'Preparando…' }}</p>
        </div>
        <span class="r-pct num">{{ progress }} %</span>
      </section>

      <!-- Terminada -->
      <section v-if="done && summary.length" class="card finished rise">
        <div class="f-head">
          <span class="f-ic" aria-hidden="true"><Icon name="ph:check-fat-fill" /></span>
          <div>
            <p class="f-t">Importación terminada</p>
            <p class="f-s">Lo que tenía avisos quedó marcado para revisar en cada sección.</p>
          </div>
        </div>
        <div class="f-stats">
          <NuxtLink v-for="s in summary" :key="s.label" :to="s.to" class="f-stat">
            <Icon :name="s.icon" aria-hidden="true" />
            <span class="num f-n">{{ s.n }}</span>
            <span class="f-l">{{ s.label }}</span>
          </NuxtLink>
        </div>
      </section>

      <!-- Archivos que fallaron -->
      <section v-if="failed.length && !running" class="card failed">
        <div class="row between gap-3 wrap">
          <p class="fl-t"><Icon name="ph:warning-circle-fill" aria-hidden="true" /> {{ failed.length }} archivo{{ failed.length > 1 ? 's' : '' }} sin leer</p>
          <UiButton size="sm" variant="secondary" icon="ph:arrow-clockwise" :loading="retrying" @click="retry">Reintentar</UiButton>
        </div>
        <ul class="fl-list">
          <li v-for="f in failed" :key="f.id"><span class="truncate">{{ f.path }}</span><span class="fl-e">{{ f.aiError }}</span></li>
        </ul>
      </section>

      <!-- Filtros -->
      <div v-if="data.items.length" class="filters">
        <UiSegmented v-model="statusModel" :options="statusOptions" label="Filtrar por estado" />
        <div class="chips">
          <button v-for="[t, n] in typeCounts" :key="t" type="button" class="chip" :class="{ on: types.includes(t) }" :aria-pressed="types.includes(t)" @click="toggleType(t)">
            <Icon :name="IMPORT_TYPE[t]!.icon" aria-hidden="true" /> {{ IMPORT_TYPE[t]!.label }} <span class="num">{{ n }}</span>
          </button>
        </div>
        <UiInput v-model="q" class="search" icon="ph:magnifying-glass" placeholder="Buscar" aria-label="Buscar en la importación" />
      </div>

      <!-- Registros -->
      <section v-if="data.items.length" class="card list">
        <div class="lrow lhead" aria-hidden="true">
          <span>Documento</span><span>Fecha</span><span class="r">Importe</span><span>Estado</span><span />
        </div>
        <div v-for="r in shown" :key="r.id" class="lrow item" :class="[r.status, { child: nested.has(r.id) }]" role="button" tabindex="0" :aria-label="`Revisar ${r.title}`" @click="openItem(r)" @keydown.enter.prevent="openItem(r)" @keydown.space.prevent="openItem(r)">
          <span class="doc">
            <span class="t-ic" :class="rowType(r).tone" aria-hidden="true"><Icon :name="rowType(r).icon" /></span>
            <span class="min0">
              <span class="d-title truncate">
                {{ r.title }}
                <UiBadge v-if="r.newContact && r.status !== 'imported'" tone="brand" size="sm">Nuevo</UiBadge>
                <span v-if="r.linked" class="clip" :title="`${r.linked} documento${r.linked > 1 ? 's' : ''} de esta importación se adjuntará${r.linked > 1 ? 'n' : ''} a la factura`">
                  <Icon name="ph:paperclip" aria-hidden="true" /><span class="num">{{ r.linked }}</span>
                  <span class="sr-only">documentos vinculados</span>
                </span>
              </span>
              <span class="d-sub truncate">{{ rowType(r).label }}{{ r.subtitle ? ` · ${r.subtitle}` : '' }}</span>
              <span v-if="r.file" class="d-file truncate"><Icon :name="fileIcon(r.file)" aria-hidden="true" /> {{ r.file }}</span>
            </span>
          </span>
          <span class="date">{{ r.date ? fdateShort(r.date) : '—' }}</span>
          <span class="amount num r">{{ r.amount != null ? eur(r.amount) : '' }}<small v-if="r.amount != null && r.amountBase" class="amount-base">base imponible</small></span>
          <span class="st">
            <UiBadge :tone="IMPORT_STATUS[r.status]!.tone" :icon="IMPORT_STATUS[r.status]!.icon" size="sm">{{ r.status === 'warning' && r.warnings.length ? `${r.warnings.length} aviso${r.warnings.length > 1 ? 's' : ''}` : IMPORT_STATUS[r.status]!.label }}</UiBadge>
            <span v-if="r.status !== 'imported' && (r.duplicate || r.warnings[0])" class="why truncate" :title="r.duplicate ?? r.warnings.join('\n')">{{ r.duplicate ?? r.warnings[0] }}</span>
          </span>
          <span class="go">
            <NuxtLink v-if="r.status === 'imported' && resultLink(r)" :to="resultLink(r)!" class="link small" @click.stop>Ver</NuxtLink>
            <Icon v-else name="ph:caret-right" aria-hidden="true" />
          </span>
        </div>
        <UiEmpty v-if="!rows.length" compact icon="ph:funnel" title="Nada con estos filtros" />
        <UiPager v-model="page" v-model:size="pageSize" :pages="pages" :total="pageTotal" />
      </section>

      <UiEmpty v-else-if="!running" icon="ph:file-dashed" title="No se encontró nada que importar" text="Prueba con otros archivos o revisa los que no se pudieron leer." />

      <div v-if="totals.sales.n || totals.expense.n" class="foot-totals">
        <span v-if="totals.sales.n"><Icon name="ph:receipt" aria-hidden="true" /> {{ totals.sales.n }} emitidas · <b class="num">{{ eur(totals.sales.total) }}</b></span>
        <span v-if="totals.expense.n"><Icon name="ph:wallet" aria-hidden="true" /> {{ totals.expense.n }} recibidas · <b class="num">{{ eur(totals.expense.total) }}</b></span>
      </div>

      <!-- Barra de acción -->
      <Transition name="slide-up">
        <div v-if="pendingCount && !running" class="actionbar">
          <p class="ab-t">
            <b class="num">{{ data.counts.ready }}</b> listos<template v-if="data.counts.warning"> · <b class="num">{{ data.counts.warning }}</b> con avisos <span class="muted">(se importan marcados para revisar)</span></template>
          </p>
          <UiButton variant="primary" icon="ph:check" :loading="committing" @click="commitAll">Importar {{ pendingCount }}</UiButton>
        </div>
      </Transition>

      <ImportItemPanel v-model="panelOpen" :batch-id="id" :item-id="panelItem" @saved="refresh()" @imported="refresh()" @open="panelItem = $event" />
      <ImportUndoModal v-model="undoOpen" :batch-id="id" :name="data.batch.name || `Importación ${id}`" @done="undone" />
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--s-3);
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-3);
}

.back:hover {
  color: var(--text);
}

.min0 {
  min-width: 0;
}

.reading {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  padding: var(--s-5);
  margin-bottom: var(--s-5);
  background: var(--ai-soft), var(--surface);
  border-color: color-mix(in srgb, var(--ai-2) 25%, var(--border));
}

.r-art {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  font-size: 22px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-lg);
  animation: pulse 1.6s var(--ease-out) infinite;
}

@keyframes pulse {
  50% {
    transform: scale(1.06);
    box-shadow: 0 0 0 8px rgb(124 58 237 / 0.08);
  }
}

.r-t {
  font-weight: 620;
}

.r-s {
  margin-top: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.r-pct {
  font-size: var(--text-xl);
  font-weight: 680;
}

.bar {
  height: 8px;
  margin-top: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--surface-sunken) 80%, transparent);
  border-radius: var(--r-full);
}

.bar span {
  display: block;
  height: 100%;
  background: var(--ai-grad);
  background-size: 200% 100%;
  border-radius: inherit;
  transition: width var(--t-slow) var(--ease-out);
  animation: flow 2s linear infinite;
}

@keyframes flow {
  to {
    background-position: -200% 0;
  }
}

.finished {
  padding: var(--s-5);
  margin-bottom: var(--s-5);
}

.f-head {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.f-ic {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  font-size: 20px;
  color: var(--success);
  background: var(--success-soft);
  border-radius: var(--r-full);
}

.f-t {
  font-weight: 650;
  font-size: var(--text-md);
}

.f-s {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.f-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-top: var(--s-4);
}

.f-stat {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: var(--text-sm);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.f-stat:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

.f-n {
  font-weight: 680;
}

.f-l {
  color: var(--text-2);
}

.failed {
  padding: var(--s-4) var(--s-5);
  margin-bottom: var(--s-5);
  border-color: color-mix(in srgb, var(--danger-solid) 30%, var(--border));
}

.fl-t {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--danger);
}

.fl-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: var(--s-3);
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
}

.fl-list li {
  display: flex;
  gap: var(--s-3);
  justify-content: space-between;
}

.fl-e {
  color: var(--text-3);
  text-align: right;
}

.filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-3);
  margin-bottom: var(--s-3);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 11px;
  font-size: var(--text-sm);
  font-weight: 540;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
}

.chip:hover {
  border-color: var(--border-strong);
}

.chip.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: color-mix(in srgb, var(--brand) 35%, transparent);
}

.chip .num {
  color: var(--text-3);
  font-size: var(--text-xs);
}

.search {
  margin-left: auto;
  width: 220px;
}

.list {
  overflow: hidden;
}

.lrow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 104px 120px 230px 40px;
  align-items: center;
  gap: var(--s-4);
  width: 100%;
  padding: 12px 18px;
  text-align: left;
}

.lhead {
  padding-top: 10px;
  padding-bottom: 10px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}

.item {
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--t-fast);
}

.item:last-of-type {
  border-bottom: 0;
}

.item:hover {
  background: var(--surface-hover);
}

.item.excluded,
.item.duplicate {
  opacity: 0.62;
}

.item.excluded .d-title {
  text-decoration: line-through;
}

.r {
  text-align: right;
}

.doc {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-width: 0;
}

.t-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  font-size: 17px;
  border-radius: var(--r-md);
  color: var(--text-2);
  background: var(--surface-sunken);
}

.t-ic.sales {
  color: var(--brand);
  background: var(--brand-soft);
}

.t-ic.expense {
  color: var(--warning);
  background: var(--warning-soft);
}

.t-ic.vault {
  color: var(--info);
  background: var(--info-soft);
}

.t-ic.quote {
  color: var(--success);
  background: var(--success-soft);
}

.t-ic.att {
  color: var(--brand);
  background: color-mix(in srgb, var(--brand-soft) 60%, var(--surface));
  border: 1px dashed color-mix(in srgb, var(--brand) 35%, transparent);
}

/* Documento vinculado: colgando de su factura */
.item.child {
  background: color-mix(in srgb, var(--surface-2) 55%, transparent);
}

.item.child .doc {
  position: relative;
  padding-left: 30px;
}

.item.child .doc::before {
  content: '';
  position: absolute;
  top: -12px;
  left: 16px;
  width: 10px;
  height: calc(50% + 12px);
  border-bottom: 1.5px solid var(--border-strong);
  border-left: 1.5px solid var(--border-strong);
  border-bottom-left-radius: 6px;
}

.item.child:hover {
  background: var(--surface-hover);
}

.clip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
  height: 20px;
  padding: 0 7px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.doc .min0 {
  display: flex;
  flex-direction: column;
}

.d-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 580;
}

.d-sub {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.d-file {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--text-4);
}

.date {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.amount-base {
  display: block;
  font-size: var(--text-2xs);
  font-weight: 500;
  color: var(--text-3);
}

.amount {
  font-weight: 600;
}

.st {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
}

.why {
  max-width: 100%;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.go {
  display: flex;
  justify-content: flex-end;
  color: var(--text-4);
}

.small {
  font-size: var(--text-sm);
}

.foot-totals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-5);
  margin-top: var(--s-3);
  padding: 0 var(--s-2);
  font-size: var(--text-sm);
  color: var(--text-3);
}

.foot-totals span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.foot-totals b {
  color: var(--text);
}

.actionbar {
  position: sticky;
  bottom: var(--s-4);
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  margin-top: var(--s-5);
  padding: 12px 12px 12px 20px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: saturate(1.6) blur(14px);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lg);
}

.ab-t {
  font-size: var(--text-sm);
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform var(--t-slow) var(--ease-out), opacity var(--t-base);
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(16px);
  opacity: 0;
}

@media (max-width: 900px) {
  .lhead {
    display: none;
  }

  .lrow {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'doc amount'
      'st date';
    gap: 6px var(--s-3);
    padding: 12px 14px;
  }

  .doc { grid-area: doc; }
  .amount-base {
  display: block;
  font-size: var(--text-2xs, 11px);
  font-weight: 500;
  color: var(--text-3);
}

.amount { grid-area: amount; align-self: start; }
  .st { grid-area: st; padding-left: 46px; }
  .item.child .st { padding-left: 76px; }
  .date { grid-area: date; text-align: right; align-self: start; }
  .go { display: none; }

  .search {
    width: 100%;
    margin-left: 0;
  }
}

@media (max-width: 520px) {
  .actionbar {
    flex-direction: column;
    align-items: stretch;
    padding: 12px;
  }

  .reading {
    padding: var(--s-4);
  }

  .r-pct {
    display: none;
  }
}
</style>
