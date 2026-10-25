<script setup lang="ts">
import type { CalendarItem, CalendarLayer } from '#shared/utils/calendar'
import type { FeedRow } from '~/components/calendar/ConnectModal.vue'

/**
 * Calendario: cobros y pagos previstos, plazos de Hacienda, recurrentes, festivos y los eventos y
 * tareas propios en un solo sitio. Vistas Mes, Agenda y Año; se conecta con Google, Apple y Outlook
 * en los dos sentidos. Atajos: ← → (mes), H (hoy), N (nuevo), M / A / Y (vista).
 */
useHead({ title: 'Calendario · NUMIQ' })

interface CalendarResponse { from: string, to: string, today: string, items: CalendarItem[], feeds: FeedRow[] }

const route = useRoute()
const toast = useToast()
const { me } = useMe()
const canEdit = computed(() => me.value?.company?.role !== 'advisor')
const today = ref(todayISO())

const ISO = /^\d{4}-\d{2}-\d{2}$/
const view = useQueryState('vista', 'mes', { allowed: ['mes', 'agenda', 'ano'] as const })
const selected = useQueryState('fecha', today.value, { parse: raw => (ISO.test(raw) ? raw : undefined) })
const ym = computed(() => selected.value.slice(0, 7))
const year = computed(() => Number(selected.value.slice(0, 4)))

const range = computed(() => {
  if (view.value === 'ano') return { from: `${year.value}-01-01`, to: `${year.value}-12-31` }
  const g = monthGrid(ym.value)
  return { from: g.from, to: g.to }
})

const { data, status, refresh } = useFetch<CalendarResponse>('/api/calendar', { query: range, key: 'calendar', lazy: true, server: false })
// Lo que viene (para el resumen y «Próximos»), independiente del mes que se mire
const upcomingRange = computed(() => ({ from: today.value, to: shiftDays(today.value, 45) }))
const { data: soon, refresh: refreshSoon } = useFetch<CalendarResponse>('/api/calendar', { query: upcomingRange, key: 'calendar-soon', lazy: true, server: false })

const loading = computed(() => status.value === 'pending')
const firstLoad = computed(() => loading.value && !data.value)

function reloadAll() {
  return Promise.all([refresh(), refreshSoon()])
}

// ─── Capas visibles (se recuerdan en este dispositivo) ───

const HIDDEN_KEY = 'numiq-cal-hidden'
const hidden = ref<Set<string>>(new Set())
onMounted(() => {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (raw) hidden.value = new Set(JSON.parse(raw) as string[])
  }
  catch {}
})
function toggleLayer(key: string) {
  const next = new Set(hidden.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hidden.value = next
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]))
  }
  catch {}
}

const feeds = computed(() => data.value?.feeds ?? [])
const visible = (it: CalendarItem) => (it.layer === 'feed' ? !hidden.value.has(`feed:${it.feedId}`) : !hidden.value.has(it.layer))
const items = computed(() => (data.value?.items ?? []).filter(visible))
const soonItems = computed(() => (soon.value?.items ?? []).filter(visible))

const layerChips = computed(() => [
  ...CALENDAR_LAYERS.map(l => ({ key: l.key as string, label: l.label, color: l.color as string, icon: l.icon, count: (data.value?.items ?? []).filter(i => i.layer === l.key && i.type !== 'window').length })),
  ...feeds.value.filter(f => f.active).map(f => ({ key: `feed:${f.id}`, label: f.name, color: f.color, icon: 'ph:calendar-blank', count: (data.value?.items ?? []).filter(i => i.feedId === f.id).length })),
])

// ─── Navegación ───

const dir = ref(1)
function go(step: number) {
  dir.value = step
  if (view.value === 'ano') {
    const y = year.value + step
    selected.value = `${y}-${selected.value.slice(5, 7)}-01`
    return
  }
  const next = addMonthsYm(ym.value, step)
  // El mes de hoy se abre en hoy; los demás, en el día 1
  selected.value = today.value.startsWith(next) ? today.value : `${next}-01`
}
function goToday() {
  dir.value = selected.value > today.value ? -1 : 1
  selected.value = today.value
}
function pickFromYear(d: string) {
  selected.value = d
  view.value = 'mes'
}

const title = computed(() => (view.value === 'ano' ? String(year.value) : monthTitle(ym.value)))
const isCurrent = computed(() => (view.value === 'ano' ? today.value.startsWith(String(year.value)) : today.value.startsWith(ym.value)) && selected.value === today.value)

const views = [
  { value: 'mes', label: 'Mes' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'ano', label: 'Año' },
]

// Deslizar en el móvil para cambiar de mes
let touch: { x: number, y: number } | null = null
function onTouchStart(e: TouchEvent) {
  const t = e.touches[0]
  touch = t ? { x: t.clientX, y: t.clientY } : null
}
function onTouchEnd(e: TouchEvent) {
  const t = e.changedTouches[0]
  if (!touch || !t || view.value === 'agenda') return
  const dx = t.clientX - touch.x
  const dy = t.clientY - touch.y
  touch = null
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1)
}

// ─── Día elegido ───

const dayItems = computed(() => items.value.filter(i => onDay(i, selected.value)).filter(i => i.type !== 'window'))
const dayWindows = computed(() => items.value.filter(i => i.type === 'window' && onDay(i, selected.value)))
const dayHoliday = computed(() => dayItems.value.find(i => i.layer === 'holiday'))
const dayList = computed(() => dayItems.value.filter(i => i.layer !== 'holiday'))
const dayTotals = computed(() => {
  const pend = dayList.value.filter(i => i.status !== 'done' && (i.type === 'due' || i.type === 'run'))
  return {
    in: round2(pend.filter(i => i.flow === 'in').reduce((s, i) => s + (i.amount ?? 0), 0)),
    out: round2(pend.filter(i => i.flow === 'out').reduce((s, i) => s + (i.amount ?? 0), 0)),
  }
})
const dayRel = computed(() => {
  const n = daysUntil(selected.value)
  return n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : n === -1 ? 'Ayer' : n > 0 ? `Dentro de ${n} días` : `Hace ${-n} días`
})

// ─── Resumen del mes y lo próximo ───

const monthItems = computed(() => items.value.filter(i => i.date.startsWith(ym.value)))
const sumOf = (list: CalendarItem[], flow: 'in' | 'out') => round2(list.filter(i => i.flow === flow && i.status !== 'done' && (i.type === 'due' || i.type === 'run')).reduce((s, i) => s + (i.amount ?? 0), 0))
const kpi = computed(() => {
  const list = monthItems.value
  const dues = (flow: 'in' | 'out') => list.filter(i => i.flow === flow && i.status !== 'done' && (i.type === 'due' || i.type === 'run'))
  return {
    inflow: sumOf(list, 'in'),
    inCount: dues('in').length,
    outflow: sumOf(list, 'out'),
    outCount: dues('out').length,
    overdue: list.filter(i => i.status === 'overdue' && i.layer !== 'tax').length,
    tasks: list.filter(i => i.type === 'task' && !i.done).length,
    events: list.filter(i => i.layer === 'event' || i.layer === 'feed').length,
  }
})

// Un plazo ya vencido sin presentar (en lo que se mira) manda sobre el siguiente
const lateDeadline = computed(() => (data.value?.items ?? []).filter(i => i.layer === 'tax' && i.type === 'deadline' && i.status === 'overdue').at(-1))
const nextDeadline = computed(() => lateDeadline.value ?? (soon.value?.items ?? []).find(i => i.layer === 'tax' && i.type === 'deadline' && i.status !== 'done'))
const deadlineDays = computed(() => (nextDeadline.value ? daysUntil(nextDeadline.value.date) : null))

const upcoming = computed(() => soonItems.value
  .filter(i => i.date >= today.value && i.status !== 'done' && i.layer !== 'holiday' && i.type !== 'window' && i.type !== 'issue' && i.type !== 'paid')
  .slice(0, 8))

// ─── Abrir, crear, mover ───

const detail = ref<CalendarItem | null>(null)
const detailOpen = ref(false)
const editor = ref({ open: false, id: null as number | null, date: null as string | null, time: null as string | null })
const connect = ref({ open: false, tab: 'out' as 'out' | 'in' })

function openItem(it: CalendarItem) {
  detail.value = it
  detailOpen.value = true
}
function create(date?: string) {
  if (!canEdit.value) return
  editor.value = { open: true, id: null, date: date ?? selected.value, time: null }
}
function edit(id: number) {
  detailOpen.value = false
  editor.value = { open: true, id, date: null, time: null }
}

function onSelect(d: string) {
  dir.value = d > selected.value ? 1 : -1
  selected.value = d
}

async function toggleDone(it: CalendarItem) {
  if (!it.eventId || !it.occurrence) return
  const done = !it.done
  // Al momento en pantalla; si falla, vuelve
  const patch = (list?: CalendarItem[]) => list?.forEach((x) => {
    if (x.id === it.id) Object.assign(x, { done, status: done ? 'done' : x.date < today.value ? 'overdue' : null, icon: done ? 'ph:check-square-fill' : 'ph:square' })
  })
  patch(data.value?.items)
  patch(soon.value?.items)
  if (detail.value?.id === it.id) detail.value = { ...detail.value, done, status: done ? 'done' : null }
  try {
    await $fetch(`/api/calendar/events/${it.eventId}/done`, { method: 'POST', body: { date: it.occurrence, done } })
    if (done) toast.success('Tarea hecha', it.title)
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    void reloadAll()
  }
}

async function move(it: CalendarItem, date: string) {
  if (!it.eventId || !it.occurrence) return
  const days = daysBetween(it.occurrence, date)
  try {
    await $fetch(`/api/calendar/events/${it.eventId}/move`, { method: 'POST', body: { days } })
    await reloadAll()
    toast.push({
      tone: 'success',
      title: it.repeat ? 'Serie movida' : 'Evento movido',
      body: `${it.title} · ${longDate(date)}`,
      action: {
        label: 'Deshacer',
        run: async () => {
          await $fetch(`/api/calendar/events/${it.eventId}/move`, { method: 'POST', body: { days: -days } }).catch(() => {})
          void reloadAll()
        },
      },
    }, 6000)
  }
  catch (err) {
    toast.error('No se pudo mover', errorMessage(err))
  }
}

function onSaved() {
  void reloadAll()
}

// ─── Enlaces: ?nuevo=1, ?evento=ID, ?conectar=1 ───

watch(() => [route.query.nuevo, route.query.evento, route.query.conectar], () => {
  if (route.query.nuevo && canEdit.value) {
    create(typeof route.query.fecha === 'string' && ISO.test(route.query.fecha) ? route.query.fecha : undefined)
    navigateTo({ query: { ...route.query, nuevo: undefined } }, { replace: true })
  }
  if (route.query.evento) {
    const id = Number(route.query.evento)
    if (id) edit(id)
    navigateTo({ query: { ...route.query, evento: undefined } }, { replace: true })
  }
  if (route.query.conectar) {
    connect.value = { open: true, tab: route.query.conectar === 'externo' ? 'in' : 'out' }
    navigateTo({ query: { ...route.query, conectar: undefined } }, { replace: true })
  }
}, { immediate: true })

// ─── Teclado ───

function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
  if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return
  const k = e.key.toLowerCase()
  if (e.key === 'ArrowLeft') go(-1)
  else if (e.key === 'ArrowRight') go(1)
  else if (k === 'h') goToday()
  else if (k === 'n' && canEdit.value) create()
  else if (k === 'm') view.value = 'mes'
  else if (k === 'a') view.value = 'agenda'
  else if (k === 'y') view.value = 'ano'
  else return
  e.preventDefault()
}

// Si la pestaña queda abierta de un día para otro, «hoy» se actualiza
function onVisible() {
  if (document.visibilityState !== 'visible') return
  const t = todayISO()
  if (t !== today.value) {
    today.value = t
    void reloadAll()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisible)
})

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
</script>

<template>
  <div class="page cal-page">
    <header class="page-head">
      <div>
        <h1>Calendario</h1>
        <p class="sub">Cobros, pagos, plazos de Hacienda y tus citas, en un solo sitio.</p>
      </div>
      <div class="page-actions">
        <UiButton icon="ph:link-simple-horizontal" compact @click="connect = { open: true, tab: 'out' }">Conectar</UiButton>
        <UiButton v-if="canEdit" variant="primary" icon="ph:plus-bold" compact @click="create()">Nuevo evento</UiButton>
      </div>
    </header>

    <!-- Resumen del mes -->
    <section class="kpis rise" aria-label="Resumen">
      <div class="kpi">
        <p class="eyebrow"><span class="kdot" style="background: var(--cal-brand)" /> Por cobrar en {{ monthName(ym).toLowerCase() }}</p>
        <p class="v num" :class="{ pos: Math.round(kpi.inflow) > 0 }">{{ Math.round(kpi.inflow) > 0 ? '+' : '' }}{{ eur(kpi.inflow, false) }}</p>
        <p class="s">{{ kpi.inCount ? plural(kpi.inCount, 'vencimiento o cuota', 'vencimientos y cuotas') : 'Nada pendiente con fecha' }}</p>
      </div>
      <div class="kpi">
        <p class="eyebrow"><span class="kdot" style="background: var(--cal-amber)" /> Por pagar</p>
        <p class="v num">{{ Math.round(kpi.outflow) > 0 ? '−' : '' }}{{ eur(kpi.outflow, false) }}</p>
        <p class="s">{{ kpi.outCount ? plural(kpi.outCount, 'pago previsto', 'pagos previstos') : 'Sin pagos previstos' }}</p>
      </div>
      <button type="button" class="kpi kpi-tax" :class="{ hot: deadlineDays !== null && deadlineDays <= 5 }" :disabled="!nextDeadline" @click="nextDeadline && (onSelect(nextDeadline.date), openItem(nextDeadline))">
        <p class="eyebrow"><span class="kdot" style="background: var(--cal-red)" /> Hacienda</p>
        <template v-if="nextDeadline">
          <p class="v num">{{ deadlineDays! < 0 ? 'Fuera de plazo' : deadlineDays === 0 ? 'Hoy' : deadlineDays === 1 ? 'Mañana' : `${deadlineDays} días` }}</p>
          <p class="s">{{ nextDeadline.title.replace('Fin de plazo · ', '') }} · {{ dayMonth(nextDeadline.date) }}</p>
        </template>
        <template v-else>
          <p class="v">Al día</p>
          <p class="s">Ningún plazo pendiente en 45 días</p>
        </template>
      </button>
      <div class="kpi">
        <p class="eyebrow"><span class="kdot" style="background: var(--cal-green)" /> Agenda</p>
        <p class="v num">{{ kpi.events }}<span class="per">{{ kpi.events === 1 ? 'evento' : 'eventos' }}</span></p>
        <p class="s">
          <template v-if="kpi.tasks">{{ plural(kpi.tasks, 'tarea pendiente', 'tareas pendientes') }}</template>
          <template v-else-if="kpi.overdue"><span class="neg">{{ plural(kpi.overdue, 'vencido', 'vencidos') }}</span></template>
          <template v-else>Sin tareas pendientes</template>
        </p>
      </div>
    </section>

    <div class="cal-layout">
      <section class="card cal-card rise" style="--i: 1" :class="{ busy: loading && !!data }">
        <span class="loadbar" aria-hidden="true" />
        <header class="cal-bar">
          <div class="nav">
            <div class="arrows">
              <button type="button" class="arr" :aria-label="view === 'ano' ? 'Año anterior' : 'Mes anterior'" @click="go(-1)"><Icon name="ph:caret-left-bold" aria-hidden="true" /></button>
              <button type="button" class="arr" :aria-label="view === 'ano' ? 'Año siguiente' : 'Mes siguiente'" @click="go(1)"><Icon name="ph:caret-right-bold" aria-hidden="true" /></button>
            </div>
            <h2 class="cal-title" aria-live="polite">{{ title }}</h2>
            <button v-if="!isCurrent" type="button" class="today-btn" @click="goToday">Hoy</button>
          </div>
          <UiSegmented v-model="view" :options="views" label="Vista" class="views" />
        </header>

        <div class="layers" role="group" aria-label="Qué se ve">
          <button
            v-for="l in layerChips"
            :key="l.key"
            type="button"
            class="lchip"
            :class="{ off: hidden.has(l.key) }"
            :aria-pressed="!hidden.has(l.key)"
            :style="{ '--c': calColor(l.color) }"
            @click="toggleLayer(l.key)"
          >
            <span class="lc-dot" aria-hidden="true"><Icon v-if="!hidden.has(l.key)" name="ph:check-bold" /></span>
            {{ l.label }}
            <span v-if="l.count && !hidden.has(l.key)" class="lc-n num">{{ l.count }}</span>
          </button>
          <button type="button" class="lchip add-feed" @click="connect = { open: true, tab: 'in' }">
            <Icon name="ph:plus" aria-hidden="true" /> Google / Apple
          </button>
        </div>

        <div class="cal-view" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
          <div v-if="firstLoad" class="cal-sk">
            <div v-for="i in 35" :key="i" class="skeleton" />
          </div>
          <Transition v-else :name="dir > 0 ? 'cal-next' : 'cal-prev'" mode="out-in">
            <CalendarMonthGrid
              v-if="view === 'mes'"
              :key="`m-${ym}`"
              :ym="ym"
              :items="items"
              :selected="selected"
              :today="today"
              :can-edit="canEdit"
              @select="onSelect"
              @open="openItem"
              @create="create"
              @move="move"
            />
            <CalendarAgenda
              v-else-if="view === 'agenda'"
              :key="`a-${ym}`"
              :items="items"
              :from="`${ym}-01`"
              :to="monthGrid(ym).last"
              :today="today"
              :can-edit="canEdit"
              @open="openItem"
              @toggle="toggleDone"
              @create="create"
            />
            <CalendarYearView v-else :key="`y-${year}`" :year="year" :items="items" :today="today" :selected="selected" @pick="pickFromYear" />
          </Transition>
        </div>
      </section>

      <aside class="cal-side">
        <!-- Día elegido -->
        <section class="card side-card rise" style="--i: 2" aria-live="polite">
          <header class="day-head">
            <div class="day-badge" :class="{ today: selected === today }">
              <span class="db-wd">{{ weekdayShort(selected) }}</span>
              <span class="db-n num">{{ Number(selected.slice(8)) }}</span>
            </div>
            <div class="day-t">
              <h2>{{ longDate(selected) }}</h2>
              <p>{{ dayRel }}<template v-if="dayHoliday"> · <span class="hol">{{ dayHoliday.title }}</span></template></p>
            </div>
            <UiButton v-if="canEdit" square size="sm" variant="soft" icon="ph:plus-bold" aria-label="Añadir evento este día" @click="create(selected)" />
          </header>

          <button v-for="w in dayWindows" :key="w.id" type="button" class="window" :class="w.status" :style="{ '--c': calColor(w.color) }" @click="openItem(w)">
            <Icon name="ph:bank" class="w-ic" aria-hidden="true" />
            <span class="w-t">
              <strong>{{ w.title }}</strong>
              <span>{{ w.status === 'done' ? 'Todo presentado' : w.status === 'overdue' ? 'El plazo ya terminó' : `Quedan ${daysUntil(w.endDate!)} días · hasta el ${dayMonth(w.endDate!)}` }}</span>
            </span>
            <Icon name="ph:caret-right" class="w-go" aria-hidden="true" />
          </button>

          <div v-if="dayTotals.in || dayTotals.out" class="day-sum num">
            <span v-if="dayTotals.in" class="in">+{{ eur(dayTotals.in) }} por cobrar</span>
            <span v-if="dayTotals.out" class="out">−{{ eur(dayTotals.out) }} por pagar</span>
          </div>

          <div v-if="dayList.length" class="day-list">
            <CalendarRow v-for="it in dayList" :key="it.id" :item="it" :day="selected" :can-edit="canEdit" @open="openItem(it)" @toggle="toggleDone(it)" />
          </div>
          <div v-else-if="!firstLoad" class="day-empty">
            <Icon name="ph:sun-horizon" aria-hidden="true" />
            <p>Día libre</p>
            <button v-if="canEdit" type="button" class="link" @click="create(selected)">Añadir un evento o una tarea</button>
          </div>
        </section>

        <!-- Lo próximo -->
        <section v-if="upcoming.length" class="card side-card rise" style="--i: 3">
          <header class="up-head">
            <h2 class="section-title">Próximamente</h2>
            <span class="muted">45 días</span>
          </header>
          <ol class="up">
            <li v-for="it in upcoming" :key="it.id">
              <button type="button" class="up-it" :style="{ '--c': calColor(it.color) }" @click="onSelect(it.date); openItem(it)">
                <span class="up-d">
                  <span class="num">{{ Number(it.date.slice(8)) }}</span>
                  <span>{{ fmonth(it.date.slice(0, 7)) }}</span>
                </span>
                <span class="up-t">
                  <strong>{{ it.title }}</strong>
                  <span>{{ it.date === today ? 'Hoy' : relDays(it.date) }}<template v-if="it.time"> · {{ it.time }}</template><template v-if="it.subtitle"> · {{ it.subtitle }}</template></span>
                </span>
                <span v-if="it.amount" class="up-a num" :class="it.flow">{{ it.flow === 'in' ? '+' : it.flow === 'out' ? '−' : '' }}{{ eur(it.amount, false) }}</span>
              </button>
            </li>
          </ol>
        </section>

        <!-- Conectar (si aún no se ha usado) -->
        <button type="button" class="card connect-cta rise" style="--i: 4" @click="connect = { open: true, tab: 'out' }">
          <span class="cc-ic" aria-hidden="true"><Icon name="ph:device-mobile-camera" /></span>
          <span class="cc-t">
            <strong>Llévalo en el móvil</strong>
            <span>Añádelo a Google Calendar, Apple Calendar u Outlook y recibe los avisos de Hacienda allí.</span>
          </span>
          <Icon name="ph:arrow-right" class="cc-go" aria-hidden="true" />
        </button>
        <p class="keys" aria-hidden="true">
          <span class="kbd">←</span><span class="kbd">→</span> mes · <span class="kbd">H</span> hoy<template v-if="canEdit"> · <span class="kbd">N</span> nuevo</template> · arrastra tus eventos a otro día
        </p>
      </aside>
    </div>

    <CalendarItemModal v-model="detailOpen" :item="detail" :can-edit="canEdit" @edit="edit" @toggle="toggleDone" />
    <CalendarEventModal v-model="editor.open" :event-id="editor.id" :date="editor.date" :time="editor.time" @saved="onSaved" @deleted="onSaved" />
    <CalendarConnectModal v-model="connect.open" :feeds="feeds" :initial-tab="connect.tab" @changed="reloadAll" />
  </div>
</template>

<style scoped>
.cal-page {
  container: calpage / inline-size;
}

/* ─── Resumen ─── */

.kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--s-4);
  margin-bottom: var(--s-5);
}

.kpi {
  min-width: 0;
  padding: var(--s-4) var(--s-5);
  color: inherit;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.kpi .eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kdot {
  width: 7px;
  height: 7px;
  border-radius: var(--r-full);
}

.kpi .v {
  margin-top: 6px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.025em;
  color: var(--text);
}

.kpi .v.pos {
  color: var(--success);
}

.per {
  margin-left: 0.35em;
  font-size: var(--text-sm);
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-3);
}

.kpi .s {
  margin-top: 2px;
  overflow: hidden;
  font-size: var(--text-xs);
  color: var(--text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.neg {
  color: var(--danger);
}

.kpi-tax {
  cursor: pointer;
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast) var(--ease-out);
}

.kpi-tax:disabled {
  cursor: default;
}

.kpi-tax:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--cal-red) 35%, var(--border));
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.kpi-tax.hot {
  background: linear-gradient(160deg, color-mix(in srgb, var(--cal-red) 8%, var(--surface)), var(--surface) 70%);
  border-color: color-mix(in srgb, var(--cal-red) 30%, var(--border));
}

.kpi-tax.hot .v {
  color: var(--danger);
}

/* ─── Cuadrícula + lateral ─── */

.cal-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--s-5);
  align-items: start;
}

.cal-card {
  position: relative;
  overflow: hidden;
  container: cal / inline-size;
}

.loadbar {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--brand), transparent);
  background-size: 40% 100%;
  background-repeat: no-repeat;
  opacity: 0;
  transition: opacity var(--t-base);
}

.busy .loadbar {
  opacity: 1;
  animation: load 1s linear infinite;
}

@keyframes load {
  from { background-position: -40% 0; }
  to { background-position: 140% 0; }
}

.busy .cal-view {
  opacity: 0.72;
}

.cal-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-5) var(--s-3);
}

.nav {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-width: 0;
}

.arrows {
  display: flex;
  padding: 3px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.arr {
  display: grid;
  place-items: center;
  width: 30px;
  height: 28px;
  font-size: 13px;
  color: var(--text-2);
  border-radius: 6px;
  transition: background var(--t-fast), color var(--t-fast);
}

.arr:hover {
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--shadow-xs);
}

.cal-title {
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.today-btn {
  height: 28px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
  transition: background var(--t-fast);
  animation: pop 260ms var(--ease-spring);
}

.today-btn:hover {
  background: var(--brand-soft-2);
}

@keyframes pop {
  from { opacity: 0; transform: scale(0.85); }
}

.layers {
  display: flex;
  gap: 6px;
  padding: 0 var(--s-5) var(--s-3);
  overflow-x: auto;
  scrollbar-width: none;
}

.layers::-webkit-scrollbar {
  display: none;
}

.lchip {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 6px;
  height: 28px;
  padding: 0 10px 0 6px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-2);
  background: color-mix(in srgb, var(--c) 7%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--c) 22%, var(--border));
  border-radius: var(--r-full);
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast), opacity var(--t-fast);
}

.lchip:hover {
  background: color-mix(in srgb, var(--c) 12%, var(--surface));
}

.lc-dot {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  font-size: 10px;
  color: #fff;
  background: var(--c);
  border-radius: var(--r-full);
  transition: background var(--t-fast), box-shadow var(--t-fast);
}

.lchip.off {
  color: var(--text-4);
  background: var(--surface);
  border-color: var(--border);
}

.lchip.off .lc-dot {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--c);
}

.lc-n {
  font-size: var(--text-2xs);
  font-weight: 650;
  color: var(--text-3);
}

.lchip.add-feed {
  --c: var(--text-4);
  padding: 0 10px;
  color: var(--text-3);
  background: none;
  border-style: dashed;
}

.lchip.add-feed:hover {
  color: var(--brand-text);
  border-color: var(--brand);
}

.cal-view {
  border-top: 1px solid var(--border);
  transition: opacity var(--t-base);
}

.cal-sk {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 1px;
  padding: var(--s-3);
}

.cal-sk .skeleton {
  height: 104px;
  border-radius: 6px;
}

/* Cambio de mes: desliza hacia donde se va */
.cal-next-enter-active,
.cal-prev-enter-active {
  transition: opacity 220ms var(--ease-out), transform 260ms var(--ease-out);
}

.cal-next-leave-active,
.cal-prev-leave-active {
  transition: opacity 120ms var(--ease-in), transform 120ms var(--ease-in);
}

.cal-next-enter-from,
.cal-prev-leave-to {
  opacity: 0;
  transform: translateX(18px);
}

.cal-next-leave-to,
.cal-prev-enter-from {
  opacity: 0;
  transform: translateX(-18px);
}

@media (prefers-reduced-motion: reduce) {
  .cal-next-enter-active,
  .cal-prev-enter-active,
  .cal-next-leave-active,
  .cal-prev-leave-active {
    transition: opacity 120ms;
    transform: none;
  }
}

/* ─── Lateral ─── */

.cal-side {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  min-width: 0;
}

.side-card {
  padding: var(--s-4);
}

.day-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: var(--s-3);
}

.day-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 48px;
  height: 52px;
  line-height: 1;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 13px;
}

.db-wd {
  font-size: var(--text-2xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--cal-red);
}

.db-n {
  margin-top: 3px;
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.day-badge.today {
  color: var(--on-brand);
  background: var(--brand);
  border-color: var(--brand);
  box-shadow: 0 6px 16px -6px color-mix(in srgb, var(--brand) 70%, transparent);
}

.day-badge.today .db-wd {
  color: rgb(255 255 255 / 0.8);
}

.day-t {
  flex: 1;
  min-width: 0;
}

.day-t h2 {
  font-size: var(--text-md);
  font-weight: 650;
  letter-spacing: -0.01em;
}

.day-t p {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.hol {
  font-weight: 600;
  color: var(--cal-pink);
}

.window {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-bottom: var(--s-2);
  padding: 10px 12px;
  color: inherit;
  text-align: left;
  background:
    repeating-linear-gradient(135deg, color-mix(in srgb, var(--c) 8%, transparent) 0 6px, color-mix(in srgb, var(--c) 3%, transparent) 6px 12px),
    var(--surface);
  border: 1px solid color-mix(in srgb, var(--c) 28%, var(--border));
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast);
}

.window:hover {
  border-color: color-mix(in srgb, var(--c) 55%, var(--border));
}

.window.done {
  --c: var(--cal-green) !important;
}

.w-ic {
  flex: none;
  font-size: 18px;
  color: var(--c);
}

.w-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.w-t strong {
  font-size: var(--text-sm);
  font-weight: 650;
}

.w-t span {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.w-go {
  flex: none;
  color: var(--text-4);
}

.day-sum {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 2px 12px 6px;
  font-size: var(--text-xs);
  font-weight: 600;
}

.day-sum .in {
  color: var(--success);
}

.day-sum .out {
  color: var(--text-3);
}

.day-list {
  display: flex;
  flex-direction: column;
  margin: 0 calc(-1 * var(--s-2));
}

.day-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--s-5) 0 var(--s-3);
  text-align: center;
}

.day-empty > :first-child {
  font-size: 28px;
  color: var(--text-4);
}

.day-empty p {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-3);
}

.up-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--s-2);
}

.muted {
  font-size: var(--text-xs);
  color: var(--text-4);
}

.up {
  display: flex;
  flex-direction: column;
  margin: 0 calc(-1 * var(--s-2));
  padding: 0;
  list-style: none;
}

.up-it {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  color: inherit;
  text-align: left;
  border-radius: var(--r-md);
  transition: background var(--t-fast);
}

.up-it:hover {
  background: var(--surface-hover);
}

.up-d {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: none;
  width: 36px;
  padding: 4px 0;
  line-height: 1.05;
  border-left: 3px solid var(--c);
}

.up-d .num {
  font-size: var(--text-md);
  font-weight: 700;
}

.up-d span:last-child {
  font-size: var(--text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-3);
}

.up-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.up-t strong {
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.up-t span {
  overflow: hidden;
  font-size: var(--text-xs);
  color: var(--text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.up-a {
  flex: none;
  font-size: var(--text-sm);
  font-weight: 650;
}

.up-a.in {
  color: var(--success);
}

.connect-cta {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: var(--s-4);
  color: inherit;
  text-align: left;
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 9%, var(--surface)), var(--surface) 65%);
  border-color: color-mix(in srgb, var(--brand) 22%, var(--border));
  transition: box-shadow var(--t-fast), transform var(--t-fast) var(--ease-out);
}

.connect-cta:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.cc-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  font-size: 21px;
  color: var(--on-brand);
  background: var(--brand);
  border-radius: 12px;
  box-shadow: 0 6px 14px -6px color-mix(in srgb, var(--brand) 80%, transparent);
}

.cc-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cc-t strong {
  font-size: var(--text-base);
  font-weight: 650;
}

.cc-t span {
  font-size: var(--text-xs);
  line-height: 1.45;
  color: var(--text-3);
}

.cc-go {
  flex: none;
  color: var(--brand-text);
}

.keys {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 0 var(--s-2);
  font-size: var(--text-2xs);
  color: var(--text-4);
}

/* ─── Contenedor estrecho ─── */

@container calpage (max-width: 1100px) {
  .cal-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .cal-side {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }

  .keys {
    display: none;
  }
}

@container calpage (max-width: 860px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
  }
}

@container calpage (max-width: 700px) {
  .cal-side {
    display: flex;
    align-items: stretch;
  }
}

@container cal (min-width: 621px) {
  .layers {
    flex-wrap: wrap;
  }
}

@container cal (max-width: 620px) {
  .cal-bar {
    padding: var(--s-3) var(--s-3) var(--s-2);
  }

  .layers {
    padding: 0 var(--s-3) var(--s-3);
  }

  .cal-title {
    font-size: var(--text-lg);
  }

  .views {
    width: 100%;
  }

  .cal-sk .skeleton {
    height: 48px;
  }
}

@media (max-width: 767px) {
  .kpi {
    padding: var(--s-3) var(--s-4);
  }

  .kpi .v {
    font-size: var(--text-xl);
  }
}
</style>
