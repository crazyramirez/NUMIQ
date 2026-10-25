<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import type { CalendarItem } from '#shared/utils/calendar'

/**
 * Mes en cuadrícula de lunes a domingo. Lo que dura varios días (plazos de Hacienda, viajes…) va
 * en barras continuas arriba; lo de un día, en etiquetas debajo. En pantallas estrechas cada día
 * muestra solo puntos de color y el detalle va en la lista del día elegido.
 * Los eventos propios se arrastran a otro día.
 */
const props = defineProps<{
  ym: string
  items: CalendarItem[]
  selected: string
  today: string
  canEdit: boolean
}>()
const emit = defineEmits<{ select: [date: string], open: [item: CalendarItem], create: [date: string], move: [item: CalendarItem, date: string] }>()

const menus = useCalendarMenus()
const root = ref<HTMLElement>()
const { width } = useElementSize(root)
const dots = computed(() => width.value > 0 && width.value < 620)
// Filas que caben en una celda: barras + etiquetas (la última se cambia por «+N más» si sobra)
const ROWS = computed(() => (width.value >= 900 ? 4 : 3))
const MAX_LANES = 2

const grid = computed(() => monthGrid(props.ym))

interface Segment { item: CalendarItem, lane: number, col: number, span: number, head: boolean, tail: boolean }
interface Week {
  days: string[]
  segments: Segment[]
  lanes: number
  singles: CalendarItem[][]
  more: number[]
  /** Puntos del modo compacto */
  dots: string[][]
  band: Array<string | null>
}

const weeks = computed<Week[]>(() => {
  const all = daysOf(grid.value.from, grid.value.to)
  const multi = props.items.filter(isMultiDay)
  const single = props.items.filter(i => !isMultiDay(i))
  const out: Week[] = []
  for (let w = 0; w < all.length; w += 7) {
    const days = all.slice(w, w + 7)
    const ws = days[0]!
    const we = days[6]!
    // Barras de la semana: las que empiezan antes y las más largas primero
    const inWeek = multi.filter(i => i.date <= we && i.endDate! >= ws)
      .sort((a, b) => a.date.localeCompare(b.date) || b.endDate!.localeCompare(a.endDate!))
    const laneEnds: string[] = []
    const segments: Segment[] = []
    for (const item of inWeek) {
      const s = item.date < ws ? ws : item.date
      const e = item.endDate! > we ? we : item.endDate!
      let lane = laneEnds.findIndex(end => end < s)
      if (lane < 0) lane = laneEnds.push(e) - 1
      else laneEnds[lane] = e
      segments.push({ item, lane, col: days.indexOf(s) + 1, span: days.indexOf(e) - days.indexOf(s) + 1, head: item.date >= ws, tail: item.endDate! <= we })
    }
    const lanes = Math.min(laneEnds.length, MAX_LANES)
    const cap = ROWS.value - lanes
    const singles: CalendarItem[][] = []
    const more: number[] = []
    const dotList: string[][] = []
    const band: Array<string | null> = []
    for (const d of days) {
      const list = single.filter(i => i.date === d)
      const hiddenBars = segments.filter(s => s.lane >= MAX_LANES && onDay(s.item, d)).length
      const fits = list.length + (hiddenBars ? 1 : 0) <= cap ? list.length : Math.max(0, cap - 1)
      singles.push(list.slice(0, fits))
      more.push(list.length - fits + hiddenBars)
      // Puntos: un color por capa, como mucho 4; los plazos largos van como franja
      const colors = [...new Set([...list, ...multi.filter(i => i.type !== 'window' && onDay(i, d))].map(i => i.color))]
      dotList.push(colors.slice(0, 4))
      const win = multi.find(i => i.type === 'window' && onDay(i, d) && i.status !== 'done')
      band.push(win ? win.color : null)
    }
    out.push({ days, segments: segments.filter(s => s.lane < MAX_LANES), lanes, singles, more, dots: dotList, band })
  }
  return out
})

// Sin barras no hay filas para ellas (repeat(0, …) invalidaría toda la plantilla)
const rowsOf = (lanes: number) => `var(--num-h) ${lanes ? `repeat(${lanes}, var(--row-h)) ` : ''}auto`
const dayNum = (iso: string) => Number(iso.slice(8))
const inMonth = (iso: string) => iso.slice(0, 7) === props.ym
const isWeekend = (i: number) => i >= 5
const holidayOf = (d: string) => props.items.find(i => i.layer === 'holiday' && i.date === d)

const chipStyle = (it: CalendarItem) => ({ '--c': calColor(it.color) })
const solid = (it: CalendarItem) => it.layer === 'tax' && it.type === 'deadline' && it.status !== 'done'

function label(it: CalendarItem) {
  const t = timeRange(it)
  return [t, it.title, it.subtitle, it.amount ? eur(it.amount) : null, statusText(it)].filter(Boolean).join(' · ')
}

// ─── Arrastrar eventos propios ───

const dragging = ref<CalendarItem | null>(null)
const over = ref<string | null>(null)
const draggable = (it: CalendarItem) => props.canEdit && !dots.value && !!it.eventId

function onDragStart(e: DragEvent, it: CalendarItem) {
  if (!draggable(it)) return
  dragging.value = it
  e.dataTransfer?.setData('text/plain', it.title)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e: DragEvent, d: string) {
  if (!dragging.value) return
  e.preventDefault()
  over.value = d
}

function onDrop(d: string) {
  const it = dragging.value
  dragging.value = null
  over.value = null
  if (it && it.occurrence && d !== it.occurrence) emit('move', it, d)
}

function onDragEnd() {
  dragging.value = null
  over.value = null
}
</script>

<template>
  <div ref="root" class="mg" :class="{ dots }">
    <div class="mg-head" aria-hidden="true">
      <span v-for="(w, i) in (dots ? WEEKDAYS_SHORT : WEEKDAYS_MID)" :key="i" :class="{ we: isWeekend(i) }">{{ w }}</span>
    </div>

    <div class="mg-body" role="grid" :aria-label="monthTitle(ym)">
      <div v-for="w in weeks" :key="w.days[0]" class="wk" role="row">
        <!-- Fondo: los días (clic, doble clic para crear, soltar al arrastrar) -->
        <div class="wk-cells">
          <div
            v-for="(d, i) in w.days"
            :key="d"
            role="gridcell"
            class="cell"
            :class="{ out: !inMonth(d), we: isWeekend(i), today: d === today, sel: d === selected, over: over === d, hol: !!holidayOf(d) }"
            :aria-selected="d === selected"
            :aria-label="longDate(d)"
            tabindex="-1"
            v-ctx="() => menus.day(d)"
            @click="emit('select', d)"
            @dblclick="canEdit && !dots && emit('create', d)"
            @dragover="onDragOver($event, d)"
            @dragleave="over === d && (over = null)"
            @drop.prevent="onDrop(d)"
          >
            <span class="dn num">{{ dayNum(d) }}</span>
            <button v-if="canEdit && !dots" type="button" class="add" :aria-label="`Añadir evento el ${longDate(d)}`" @click.stop="emit('create', d)">
              <Icon name="ph:plus-bold" aria-hidden="true" />
            </button>
            <template v-if="dots">
              <span class="dts" aria-hidden="true">
                <i v-for="c in w.dots[i]" :key="c" :style="{ background: calColor(c) }" />
              </span>
              <span v-if="w.band[i]" class="band" :style="{ background: calColor(w.band[i]) }" aria-hidden="true" />
            </template>
          </div>
        </div>

        <!-- Encima: barras y etiquetas -->
        <div v-if="!dots" class="wk-fg" :style="{ gridTemplateRows: rowsOf(w.lanes) }">
          <button
            v-for="s in w.segments"
            :key="s.item.id"
            type="button"
            class="bar"
            :class="{ head: s.head, tail: s.tail, done: s.item.status === 'done', late: s.item.status === 'overdue', win: s.item.type === 'window' }"
            :style="{ ...chipStyle(s.item), gridColumn: `${s.col} / span ${s.span}`, gridRow: s.lane + 2 }"
            :title="label(s.item)"
            :draggable="draggable(s.item)"
            v-ctx="() => menus.item(s.item)"
            @click.stop="emit('open', s.item)"
            @dragstart="onDragStart($event, s.item)"
            @dragend="onDragEnd"
          >
            <Icon v-if="s.head" :name="s.item.icon" class="ic" aria-hidden="true" />
            <span class="tt">{{ s.head || s.col === 1 ? s.item.title : '' }}</span>
          </button>

          <div v-for="(list, i) in w.singles" :key="i" class="col" :style="{ gridColumn: i + 1, gridRow: w.lanes + 2 }">
            <button
              v-for="it in list"
              :key="it.id"
              type="button"
              class="chip"
              :class="{ solid: solid(it), done: it.status === 'done', late: it.status === 'overdue', hol: it.layer === 'holiday', task: it.type === 'task', drag: dragging?.id === it.id }"
              :style="chipStyle(it)"
              :title="label(it)"
              :draggable="draggable(it)"
              v-ctx="() => menus.item(it)"
              @click.stop="emit('open', it)"
              @dragstart="onDragStart($event, it)"
              @dragend="onDragEnd"
            >
              <span v-if="it.type === 'task'" class="box" :class="{ on: it.done }" aria-hidden="true"><Icon v-if="it.done" name="ph:check-bold" /></span>
              <span v-else-if="!solid(it)" class="dot" aria-hidden="true" />
              <Icon v-else name="ph:bank-fill" class="ic" aria-hidden="true" />
              <span v-if="it.time" class="tm num">{{ it.time }}</span>
              <span class="tt">{{ it.title }}</span>
            </button>
            <button v-if="w.more[i]" v-ctx="() => menus.day(w.days[i]!)" type="button" class="more" @click.stop="emit('select', w.days[i]!)">
              +{{ w.more[i] }} más
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mg {
  --cell-min: 128px;
  --row-h: 22px;
  --row-gap: 3px;
  --num-h: 30px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  user-select: none;
}

.mg-head {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-bottom: 1px solid var(--border);
}

.mg-head span {
  padding: 10px 10px 8px;
  font-size: var(--text-2xs);
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-3);
}

.mg-head span.we {
  color: var(--text-4);
}

.mg-body {
  display: flex;
  flex-direction: column;
}

.wk {
  position: relative;
  min-height: var(--cell-min);
  border-bottom: 1px solid var(--border-subtle);
}

.wk:last-child {
  border-bottom: 0;
}

.wk-cells {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.cell {
  position: relative;
  min-width: 0;
  border-right: 1px solid var(--border-subtle);
  cursor: default;
  outline: none;
  transition: background var(--t-fast), box-shadow var(--t-fast);
}

.cell:last-child {
  border-right: 0;
}

.cell.we {
  background: color-mix(in srgb, var(--surface-sunken) 55%, transparent);
}

.cell.out {
  background: repeating-linear-gradient(135deg, transparent 0 7px, color-mix(in srgb, var(--border-subtle) 55%, transparent) 7px 8px);
}

.cell.out .dn {
  color: var(--text-4);
}

@media (hover: hover) {
  .cell:hover {
    background: var(--surface-hover);
  }

  .cell:hover .add {
    opacity: 1;
    transform: scale(1);
  }
}

.cell.sel {
  background: color-mix(in srgb, var(--brand) 5%, transparent);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--brand) 45%, transparent);
}

.cell.over {
  background: color-mix(in srgb, var(--brand) 10%, transparent);
  box-shadow: inset 0 0 0 2px var(--brand);
}

.dn {
  position: absolute;
  top: 6px;
  left: 8px;
  display: grid;
  place-items: center;
  min-width: 24px;
  height: 24px;
  padding: 0 5px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
  border-radius: var(--r-full);
}

.cell.hol .dn {
  color: var(--cal-pink);
}

.cell.today .dn {
  color: var(--on-brand);
  background: var(--brand);
  box-shadow: 0 2px 8px -2px color-mix(in srgb, var(--brand) 70%, transparent);
}

.add {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  font-size: 12px;
  color: var(--text-3);
  border-radius: var(--r-sm);
  opacity: 0;
  transform: scale(0.85);
  transition: opacity var(--t-fast), transform var(--t-fast) var(--ease-out), background var(--t-fast), color var(--t-fast);
}

.add:hover,
.add:focus-visible {
  color: var(--brand-text);
  background: var(--brand-soft);
  opacity: 1;
  transform: scale(1);
}

/* ─── Barras y etiquetas ─── */

.wk-fg {
  position: relative;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  row-gap: var(--row-gap);
  padding-bottom: 6px;
  pointer-events: none;
}

.bar,
.chip,
.more {
  pointer-events: auto;
}

.bar {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: var(--row-h);
  margin: 0 -1px;
  padding: 0 8px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: color-mix(in srgb, var(--c) 78%, var(--text));
  text-align: left;
  background: color-mix(in srgb, var(--c) 13%, var(--surface));
  border-block: 1px solid color-mix(in srgb, var(--c) 22%, transparent);
  transition: background var(--t-fast), filter var(--t-fast);
}

.bar.head {
  margin-left: 4px;
  border-left: 1px solid color-mix(in srgb, var(--c) 22%, transparent);
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
}

.bar.tail {
  margin-right: 4px;
  border-right: 1px solid color-mix(in srgb, var(--c) 22%, transparent);
  border-top-right-radius: 6px;
  border-bottom-right-radius: 6px;
}

/* Plazo de presentación: franja suave a rayas, sin robar protagonismo al último día */
.bar.win {
  font-weight: 560;
  background:
    repeating-linear-gradient(135deg, color-mix(in srgb, var(--c) 9%, transparent) 0 6px, color-mix(in srgb, var(--c) 4%, transparent) 6px 12px),
    var(--surface);
}

.bar.done {
  color: var(--text-3);
  background: var(--surface-sunken);
  border-color: var(--border);
}

.bar:hover {
  filter: brightness(0.97) saturate(1.1);
}

.bar .ic {
  flex: none;
  font-size: 13px;
}

.tt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col {
  display: flex;
  flex-direction: column;
  gap: var(--row-gap);
  min-width: 0;
  padding: 0 4px;
}

.chip {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: var(--row-h);
  padding: 0 6px;
  font-size: var(--text-xs);
  font-weight: 540;
  color: var(--text-2);
  text-align: left;
  border-radius: 6px;
  transition: background var(--t-fast), transform var(--t-fast) var(--ease-out), opacity var(--t-fast);
}

.chip:hover {
  background: color-mix(in srgb, var(--c) 11%, var(--surface));
}

.chip:active {
  transform: scale(0.98);
}

.chip[draggable='true'] {
  cursor: grab;
}

.chip.drag {
  opacity: 0.4;
}

.chip .dot {
  flex: none;
  width: 7px;
  height: 7px;
  background: var(--c);
  border-radius: var(--r-full);
}

.chip.late .dot {
  box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--cal-red) 28%, transparent);
  background: var(--cal-red);
}

.chip.done {
  color: var(--text-4);
}

.chip.done.task .tt {
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-4) 70%, transparent);
}

.chip.done .dot {
  background: color-mix(in srgb, var(--c) 45%, var(--surface));
}

.chip.hol {
  color: color-mix(in srgb, var(--c) 80%, var(--text));
  background: color-mix(in srgb, var(--c) 9%, transparent);
}

/* Último día de un plazo de Hacienda: lo único sólido del calendario */
.chip.solid {
  font-weight: 650;
  color: #fff;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 92%, #fff), var(--c));
  box-shadow: 0 1px 2px color-mix(in srgb, var(--c) 40%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.18);
}

.chip.solid:hover {
  filter: brightness(1.05);
}

.chip .ic {
  flex: none;
  font-size: 12px;
}

.tm {
  flex: none;
  font-size: var(--text-2xs);
  font-weight: 650;
  color: var(--text-3);
}

.chip.solid .tm {
  color: inherit;
}

.box {
  display: grid;
  place-items: center;
  flex: none;
  width: 12px;
  height: 12px;
  font-size: 9px;
  color: #fff;
  border: 1.5px solid var(--c);
  border-radius: 3px;
}

.box.on {
  background: var(--c);
}

.more {
  height: 20px;
  padding: 0 6px;
  font-size: var(--text-2xs);
  font-weight: 650;
  color: var(--text-3);
  text-align: left;
  border-radius: 6px;
}

.more:hover {
  color: var(--brand-text);
  background: var(--brand-soft);
}

/* ─── Modo compacto (móvil): número y puntos ─── */

.dots {
  --cell-min: 54px;
}

.dots .mg-head span {
  padding: 8px 0 6px;
  text-align: center;
}

.dots .wk {
  border-bottom: 0;
}

.dots .cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  border-right: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.dots .cell.we,
.dots .cell.out {
  background: none;
}

.dots .cell.sel {
  background: none;
  box-shadow: none;
}

.dots .dn {
  position: static;
  width: 34px;
  height: 34px;
  margin-top: 4px;
  font-size: var(--text-md);
  transition: background var(--t-fast), color var(--t-fast);
}

.dots .cell.sel:not(.today) .dn {
  color: var(--text);
  background: var(--surface-active);
  box-shadow: inset 0 0 0 1.5px var(--border-strong);
}

.dts {
  display: flex;
  gap: 3px;
  height: 6px;
  margin-top: 3px;
}

.dts i {
  width: 5px;
  height: 5px;
  border-radius: var(--r-full);
}

.band {
  position: absolute;
  right: 0;
  bottom: 3px;
  left: 0;
  height: 2px;
  opacity: 0.35;
}
</style>
