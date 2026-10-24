<script setup lang="ts">
/**
 * Ingresos frente a gastos por mes (columnas agrupadas, un solo eje en €).
 * Tooltip por mes con ratón y teclado, leyenda siempre visible y vista de tabla.
 */
interface Point { month: string, income: number, expenses: number, profit: number }

const props = defineProps<{ data: Point[] }>()

const wrap = ref<HTMLElement>()
const { width } = useElementSize(wrap)
const showTable = ref(false)
const active = ref<number | null>(null)

const H = 264
const pad = { top: 16, right: 4, bottom: 30, left: 56 }
const innerH = H - pad.top - pad.bottom
const innerW = computed(() => Math.max(0, width.value - pad.left - pad.right))
const n = computed(() => Math.max(1, props.data.length))
const band = computed(() => innerW.value / n.value)

const hasData = computed(() => props.data.some(d => d.income !== 0 || d.expenses !== 0))

function niceStep(range: number) {
  const raw = range / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow
}

const scale = computed(() => {
  const vals = props.data.flatMap(d => [d.income, d.expenses])
  const max = Math.max(0, ...vals)
  const min = Math.min(0, ...vals)
  const step = niceStep(Math.max(max - min, 1))
  const top = Math.ceil(max / step) * step || step
  const bottom = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = bottom; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 100) / 100)
  return { top, bottom, ticks }
})

const y = (v: number) => pad.top + ((scale.value.top - v) / (scale.value.top - scale.value.bottom)) * innerH

const GAP = 2
const barW = computed(() => Math.max(3, Math.min(24, (band.value * 0.62 - GAP) / 2)))

/** Columna con el extremo de datos redondeado (4 px) y la base recta */
function barPath(x: number, w: number, v: number) {
  const y0 = y(0)
  const y1 = y(v)
  const h = Math.abs(y0 - y1)
  if (h < 0.5) return ''
  const r = Math.min(4, w / 2, h)
  if (v >= 0) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`
}

const bars = computed(() => props.data.map((d, i) => {
  const cx = pad.left + band.value * (i + 0.5)
  const groupW = barW.value * 2 + GAP
  const x0 = cx - groupW / 2
  return {
    ...d,
    i,
    cx,
    incomePath: barPath(x0, barW.value, d.income),
    expensePath: barPath(x0 + barW.value + GAP, barW.value, d.expenses),
  }
}))

// En pantallas estrechas, una etiqueta de mes sí y otra no
const labelEvery = computed(() => (band.value < 30 ? 2 : 1))

const tooltip = computed(() => {
  if (active.value == null) return null
  const d = bars.value[active.value]
  if (!d) return null
  const w = 196
  const left = Math.min(Math.max(d.cx - w / 2, 0), Math.max(0, width.value - w))
  return { d, left, w }
})

const summary = computed(() => {
  const inc = props.data.reduce((s, d) => s + d.income, 0)
  const exp = props.data.reduce((s, d) => s + d.expenses, 0)
  const best = [...props.data].sort((a, b) => b.income - a.income)[0]
  return `Últimos ${props.data.length} meses: ingresos ${eur(inc)}, gastos ${eur(exp)}, beneficio ${eur(inc - exp)}.${best && best.income > 0 ? ` Mes con más ingresos: ${fmonth(best.month, true)} (${eur(best.income)}).` : ''}`
})

const tickLabel = (v: number) => (v === 0 ? '0' : eurCompact(v).replace(' €', ''))
</script>

<template>
  <div class="income-chart">
    <div class="legend-row">
      <ul class="legend" aria-label="Leyenda">
        <li><span class="sw inc" aria-hidden="true" />Ingresos</li>
        <li><span class="sw exp" aria-hidden="true" />Gastos</li>
      </ul>
      <UiButton size="sm" variant="ghost" :icon="showTable ? 'ph:chart-bar' : 'ph:table'" :aria-pressed="showTable" @click="showTable = !showTable">
        {{ showTable ? 'Ver gráfico' : 'Ver tabla' }}
      </UiButton>
    </div>

    <p class="sr-only">{{ summary }}</p>

    <div v-if="!hasData && !showTable" class="empty-chart">
      <UiEmpty compact icon="ph:chart-bar" title="Aún no hay movimientos" text="En cuanto emitas facturas o registres gastos verás aquí su evolución mes a mes." />
    </div>

    <div v-else-if="!showTable" ref="wrap" class="plot" @pointerleave="active = null">
      <svg v-if="width > 0" :width="width" :height="H" role="img" :aria-label="summary">
        <!-- Rejilla y eje Y -->
        <g class="grid">
          <template v-for="t in scale.ticks" :key="t">
            <line :x1="pad.left" :x2="width - pad.right" :y1="y(t)" :y2="y(t)" :class="{ zero: t === 0 }" />
            <text :x="pad.left - 10" :y="y(t)" dy="0.32em" text-anchor="end" class="tick num">{{ tickLabel(t) }}</text>
          </template>
        </g>

        <!-- Banda del mes activo -->
        <rect
          v-if="active != null"
          class="hover-band"
          :x="pad.left + band * active + 2"
          :y="pad.top"
          :width="Math.max(0, band - 4)"
          :height="innerH"
          rx="6"
        />

        <g v-for="b in bars" :key="b.month" :style="{ '--i': b.i }">
          <path v-if="b.incomePath" :d="b.incomePath" class="bar inc" :class="{ dim: active != null && active !== b.i, neg: b.income < 0 }" />
          <path v-if="b.expensePath" :d="b.expensePath" class="bar exp" :class="{ dim: active != null && active !== b.i, neg: b.expenses < 0 }" />
          <text
            v-if="b.i % labelEvery === (n - 1) % labelEvery"
            :x="b.cx"
            :y="H - 10"
            text-anchor="middle"
            class="xlabel"
            :class="{ current: b.i === n - 1 }"
          >{{ fmonth(b.month) }}</text>
        </g>

        <!-- Zonas de interacción: todo el mes, más grandes que las barras -->
        <rect
          v-for="b in bars"
          :key="`hit-${b.month}`"
          class="hit"
          :x="pad.left + band * b.i"
          :y="pad.top"
          :width="band"
          :height="innerH + pad.bottom"
          tabindex="0"
          role="button"
          :aria-label="`${fmonth(b.month, true)}: ingresos ${eur(b.income)}, gastos ${eur(b.expenses)}, beneficio ${eur(b.profit)}`"
          @pointerenter="active = b.i"
          @pointermove="active = b.i"
          @focus="active = b.i"
          @blur="active = null"
        />
      </svg>

      <Transition name="fade">
        <div v-if="tooltip" class="tip" :style="{ left: `${tooltip.left}px`, width: `${tooltip.w}px` }" aria-hidden="true">
          <p class="tip-title">{{ fmonth(tooltip.d.month, true) }}</p>
          <div class="tip-row">
            <span class="key inc" />
            <span class="tip-l">Ingresos</span>
            <strong class="num">{{ eur(tooltip.d.income) }}</strong>
          </div>
          <div class="tip-row">
            <span class="key exp" />
            <span class="tip-l">Gastos</span>
            <strong class="num">{{ eur(tooltip.d.expenses) }}</strong>
          </div>
          <div class="tip-row total">
            <span class="key none" />
            <span class="tip-l">Beneficio</span>
            <strong class="num">{{ eur(tooltip.d.profit) }}</strong>
          </div>
        </div>
      </Transition>
    </div>

    <div v-else class="table-wrap tbl">
      <table class="table">
        <caption class="sr-only">Ingresos, gastos y beneficio por mes</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col" class="r">Ingresos</th>
            <th scope="col" class="r">Gastos</th>
            <th scope="col" class="r">Beneficio</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in [...data].reverse()" :key="d.month">
            <td class="strong">{{ fmonth(d.month, true) }}</td>
            <td class="r num">{{ eur(d.income) }}</td>
            <td class="r num">{{ eur(d.expenses) }}</td>
            <td class="r num strong" :class="{ neg: d.profit < 0 }">{{ eur(d.profit) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.income-chart {
  --c-inc: var(--chart-income);
  --c-exp: var(--chart-expense);
}

.legend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  margin-bottom: var(--s-3);
}

.legend {
  display: flex;
  gap: var(--s-5);
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

.sw.inc { background: var(--c-inc); }
.sw.exp { background: var(--c-exp); }

.plot {
  position: relative;
  width: 100%;
  min-height: 264px;
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
  text-transform: capitalize;
}

.xlabel.current {
  fill: var(--text);
  font-weight: 600;
}

.hover-band {
  fill: var(--surface-hover);
}

.bar {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: grow 620ms var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 28ms);
  transition: opacity var(--t-fast);
}

.bar.neg {
  transform-origin: 50% 0%;
}

.bar.inc { fill: var(--c-inc); }
.bar.exp { fill: var(--c-exp); }

.bar.dim {
  opacity: 0.38;
}

@keyframes grow {
  from { transform: scaleY(0); }
  to { transform: scaleY(1); }
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
  text-transform: capitalize;
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
  width: 12px;
  height: 3px;
  border-radius: 2px;
  flex-shrink: 0;
}

.key.inc { background: var(--c-inc); }
.key.exp { background: var(--c-exp); }
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
  min-height: 264px;
}

.tbl {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}
</style>
