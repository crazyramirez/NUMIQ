<script setup lang="ts">
import type { AiCategory, AiUsageGroup, AiUsageReport } from '#shared/utils/ai-usage'

/**
 * Coste de la IA por día, semana o mes: columnas apiladas por categoría (un solo eje, en la moneda elegida).
 * Tooltip por tramo con ratón y teclado, leyenda siempre visible y vista de tabla.
 */
const props = defineProps<{ series: AiUsageReport['series'], group: AiUsageGroup, currency: 'eur' | 'usd' }>()

const wrap = ref<HTMLElement>()
const { width } = useElementSize(wrap)
const showTable = ref(false)
const active = ref<number | null>(null)

const H = 248
const pad = { top: 14, right: 4, bottom: 30, left: 52 }
const innerH = H - pad.top - pad.bottom
const innerW = computed(() => Math.max(0, width.value - pad.left - pad.right))
const n = computed(() => Math.max(1, props.series.length))
const band = computed(() => innerW.value / n.value)

const value = (s: { usd: number, eur: number }) => (props.currency === 'eur' ? s.eur : s.usd)
const ORDER = Object.keys(AI_CATEGORIES) as AiCategory[]
/** Categorías con consumo en el periodo, en su orden fijo (leyenda y apilado) */
const present = computed(() => ORDER.filter(c => props.series.some(s => (s.byCategory[c] ? value(s.byCategory[c]!) : 0) > 0)))
const hasData = computed(() => props.series.some(s => value(s) > 0))

function niceStep(range: number) {
  const raw = range / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow
}

const scale = computed(() => {
  const max = Math.max(0, ...props.series.map(value))
  const step = niceStep(max || 0.01)
  const top = Math.ceil(max / step) * step || step
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(v)
  return { top, ticks, step }
})

const y = (v: number) => pad.top + ((scale.value.top - v) / scale.value.top) * innerH
const barW = computed(() => Math.max(3, Math.min(34, band.value * 0.64)))
const GAP = 2

/** Segmento: solo el de arriba lleva el extremo redondeado (4 px); la base queda recta */
function segPath(x: number, w: number, y0: number, y1: number, round: boolean) {
  const h = y0 - y1
  if (h < 0.5) return ''
  const r = round ? Math.min(4, w / 2, h) : 0
  return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
}

const bars = computed(() => props.series.map((s, i) => {
  const cx = pad.left + band.value * (i + 0.5)
  const x = cx - barW.value / 2
  const parts = present.value.map(c => ({ c, v: s.byCategory[c] ? value(s.byCategory[c]!) : 0 })).filter(p => p.v > 0)
  let acc = 0
  const segs = parts.map((p, j) => {
    const y0 = y(acc) - (j > 0 ? GAP / 2 : 0)
    acc += p.v
    const y1 = y(acc) + (j < parts.length - 1 ? GAP / 2 : 0)
    return { c: p.c, d: segPath(x, barW.value, y0, Math.min(y0, y1), j === parts.length - 1) }
  }).filter(sg => sg.d)
  return { ...s, i, cx, segs, total: value(s) }
}))

const today = todayISO()
function label(s: AiUsageReport['series'][number], long = false) {
  const d = new Date(`${s.from}T12:00:00`)
  if (props.group === 'month') return fmonth(s.key, long)
  if (props.group === 'week') {
    const f = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')
    if (!long) return f
    return `Semana del ${f} al ${new Date(`${s.to}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')}`
  }
  if (long) {
    const t = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
    return t.charAt(0).toUpperCase() + t.slice(1)
  }
  return d.getDate() === 1 || s === props.series[0] ? d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '') : String(d.getDate())
}

// Etiquetas del eje X: tantas como quepan sin pisarse (siempre la última)
const labelEvery = computed(() => Math.max(1, Math.ceil((props.group === 'week' ? 52 : 34) / Math.max(band.value, 1))))

const tooltip = computed(() => {
  if (active.value == null) return null
  const b = bars.value[active.value]
  if (!b) return null
  const w = 288
  const left = Math.min(Math.max(b.cx - w / 2, 0), Math.max(0, width.value - w))
  const rows = present.value
    .map(c => ({ c, v: b.byCategory[c] ? value(b.byCategory[c]!) : 0 }))
    .filter(r => r.v > 0)
    .sort((a, z) => z.v - a.v)
  return { b, left, w, rows }
})

const total = computed(() => props.series.reduce((s, x) => s + value(x), 0))
const peak = computed(() => [...props.series].sort((a, b) => value(b) - value(a))[0])
const summary = computed(() => `Coste de la IA en ${props.series.length} tramos: ${aiMoney(total.value, props.currency)}.${peak.value && value(peak.value) > 0 ? ` Máximo: ${label(peak.value, true)} (${aiMoney(value(peak.value), props.currency)}).` : ''}`)

const tickLabel = (v: number) => (v === 0 ? '0' : aiMoney(v, props.currency, true))
</script>

<template>
  <div class="ai-chart">
    <div class="legend-row">
      <ul class="legend" aria-label="Leyenda">
        <li v-for="c in present" :key="c"><span class="sw" :style="{ background: AI_CATEGORIES[c].color }" aria-hidden="true" />{{ AI_CATEGORIES[c].label }}</li>
      </ul>
      <UiButton size="sm" variant="ghost" :icon="showTable ? 'ph:chart-bar' : 'ph:table'" :aria-pressed="showTable" @click="showTable = !showTable">
        {{ showTable ? 'Ver gráfico' : 'Ver tabla' }}
      </UiButton>
    </div>

    <p class="sr-only">{{ summary }}</p>

    <div v-if="!hasData && !showTable" class="empty-chart">
      <UiEmpty compact icon="ph:chart-bar" title="Sin consumo en este periodo" text="Cada lectura, importación o respuesta del asistente aparecerá aquí con su coste." />
    </div>

    <div v-else-if="!showTable" ref="wrap" class="plot" @pointerleave="active = null">
      <svg v-if="width > 0" :width="width" :height="H" role="img" :aria-label="summary">
        <g class="grid">
          <template v-for="t in scale.ticks" :key="t">
            <line :x1="pad.left" :x2="width - pad.right" :y1="y(t)" :y2="y(t)" :class="{ zero: t === 0 }" />
            <text :x="pad.left - 10" :y="y(t)" dy="0.32em" text-anchor="end" class="tick num">{{ tickLabel(t) }}</text>
          </template>
        </g>

        <rect v-if="active != null" class="hover-band" :x="pad.left + band * active + 1" :y="pad.top" :width="Math.max(0, band - 2)" :height="innerH" rx="6" />

        <g v-for="b in bars" :key="b.key" :style="{ '--i': b.i }">
          <path v-for="sg in b.segs" :key="sg.c" :d="sg.d" class="bar" :class="{ dim: active != null && active !== b.i }" :style="{ fill: AI_CATEGORIES[sg.c].color }" />
          <text
            v-if="(n - 1 - b.i) % labelEvery === 0"
            :x="b.cx"
            :y="H - 10"
            text-anchor="middle"
            class="xlabel"
            :class="{ current: b.from <= today && b.to >= today }"
          >{{ label(b) }}</text>
        </g>

        <rect
          v-for="b in bars"
          :key="`hit-${b.key}`"
          class="hit"
          :x="pad.left + band * b.i"
          :y="pad.top"
          :width="band"
          :height="innerH + pad.bottom"
          tabindex="0"
          role="button"
          :aria-label="`${label(b, true)}: ${aiMoney(b.total, currency)}, ${b.calls} llamadas`"
          @pointerenter="active = b.i"
          @pointermove="active = b.i"
          @focus="active = b.i"
          @blur="active = null"
        />
      </svg>

      <Transition name="fade">
        <div v-if="tooltip" class="tip" :style="{ left: `${tooltip.left}px`, width: `${tooltip.w}px` }" aria-hidden="true">
          <p class="tip-title">{{ label(tooltip.b, true) }}</p>
          <div v-for="r in tooltip.rows" :key="r.c" class="tip-row">
            <span class="key" :style="{ background: AI_CATEGORIES[r.c].color }" />
            <span class="tip-l truncate">{{ AI_CATEGORIES[r.c].label }}</span>
            <strong class="num">{{ aiMoney(r.v, currency) }}</strong>
          </div>
          <div class="tip-row total">
            <span class="key none" />
            <span class="tip-l">{{ tooltip.b.calls }} {{ tooltip.b.calls === 1 ? 'llamada' : 'llamadas' }}</span>
            <strong class="num">{{ aiMoney(tooltip.b.total, currency) }}</strong>
          </div>
        </div>
      </Transition>
    </div>

    <div v-else class="table-wrap tbl">
      <table class="table">
        <caption class="sr-only">Coste de la IA por tramo y categoría</caption>
        <thead>
          <tr>
            <th scope="col">{{ group === 'month' ? 'Mes' : group === 'week' ? 'Semana' : 'Día' }}</th>
            <th v-for="c in present" :key="c" scope="col" class="r">{{ AI_CATEGORIES[c].label }}</th>
            <th scope="col" class="r">Llamadas</th>
            <th scope="col" class="r">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in [...series].reverse().filter(x => x.calls)" :key="s.key">
            <td class="strong">{{ label(s, true) }}</td>
            <td v-for="c in present" :key="c" class="r num">{{ s.byCategory[c] ? aiMoney(value(s.byCategory[c]!), currency) : '—' }}</td>
            <td class="r num">{{ num(s.calls) }}</td>
            <td class="r num strong">{{ aiMoney(value(s), currency) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.legend-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-3);
  margin-bottom: var(--s-3);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px var(--s-4);
  list-style: none;
  padding: 0;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.legend li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.sw {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.plot {
  position: relative;
  width: 100%;
  min-height: 248px;
}

svg {
  display: block;
  overflow: visible;
}

.grid line {
  stroke: var(--chart-grid);
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.grid line.zero {
  stroke: var(--border-strong);
}

.tick {
  font-size: 11px;
  fill: var(--text-3);
}

.xlabel {
  font-size: 11px;
  fill: var(--text-3);
}

.xlabel.current {
  fill: var(--text);
  font-weight: 600;
}

.hover-band {
  fill: var(--surface-hover);
}

.bar {
  transform-box: view-box;
  transform-origin: 0 100%;
  transition: opacity var(--t-fast);
  animation: fade-in 520ms var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 14ms);
}

.bar.dim {
  opacity: 0.38;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.hit {
  fill: transparent;
  cursor: crosshair;
  outline: none;
}

.hit:focus-visible {
  stroke: var(--brand);
  stroke-width: 2;
}

.tip {
  position: absolute;
  top: 4px;
  z-index: 2;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lg);
  pointer-events: none;
}

.tip-title {
  margin-bottom: 6px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
}

.tip-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  font-size: var(--text-sm);
}

.tip-row.total {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
}

.key {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}

.key.none { background: transparent; }

.tip-l {
  flex: 1;
  color: var(--text-3);
}

.tip strong {
  color: var(--text);
  font-weight: 620;
}

.empty-chart {
  display: grid;
  place-items: center;
  min-height: 248px;
}

.tbl {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.tbl .r {
  text-align: right;
}

.tbl .strong {
  font-weight: 600;
  white-space: nowrap;
}
</style>
