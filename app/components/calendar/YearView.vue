<script setup lang="ts">
import type { CalendarItem } from '#shared/utils/calendar'

/**
 * El año de un vistazo: doce meses con un punto de color por día con algo, el último día de cada
 * plazo de Hacienda marcado y lo que entra y sale cada mes. Un clic lleva al mes y al día.
 */
const props = defineProps<{ year: number, items: CalendarItem[], today: string, selected: string }>()
const emit = defineEmits<{ pick: [date: string] }>()

interface Mini { ym: string, weeks: string[][], inflow: number, outflow: number, deadlines: number }

const byDay = computed(() => {
  const map = new Map<string, CalendarItem[]>()
  for (const it of props.items) {
    if (it.type === 'window') continue
    map.set(it.date, [...(map.get(it.date) ?? []), it])
  }
  return map
})

const months = computed<Mini[]>(() => Array.from({ length: 12 }, (_, i) => {
  const ym = `${props.year}-${String(i + 1).padStart(2, '0')}`
  const g = monthGrid(ym)
  const days = daysOf(g.from, g.to)
  const weeks: string[][] = []
  for (let w = 0; w < days.length; w += 7) weeks.push(days.slice(w, w + 7))
  const own = props.items.filter(it => it.date.startsWith(ym) && it.type !== 'window')
  // Lo previsto: vencimientos pendientes y recurrentes (no lo ya emitido, para no contar dos veces)
  const sum = (flow: 'in' | 'out') => round2(own.filter(it => it.flow === flow && (it.type === 'due' || it.type === 'run' || it.type === 'paid')).reduce((s, it) => s + (it.amount ?? 0), 0))
  return { ym, weeks, inflow: sum('in'), outflow: sum('out'), deadlines: own.filter(it => it.layer === 'tax' && it.type === 'deadline').length }
}))

function dayClass(d: string, ym: string) {
  const list = byDay.value.get(d) ?? []
  return {
    out: !d.startsWith(ym),
    today: d === props.today,
    sel: d === props.selected,
    tax: list.some(i => i.layer === 'tax' && i.status !== 'done'),
    hol: list.some(i => i.layer === 'holiday'),
    has: list.length > 0,
  }
}

const dotOf = (d: string) => {
  const list = (byDay.value.get(d) ?? []).filter(i => i.layer !== 'holiday' && i.layer !== 'tax')
  return list.length ? calColor(list[0]!.color) : null
}

const isCurrent = (ym: string) => props.today.startsWith(ym)
</script>

<template>
  <div class="yv">
    <section v-for="(m, i) in months" :key="m.ym" class="mo rise" :class="{ cur: isCurrent(m.ym) }" :style="{ '--i': Math.min(i, 8) }">
      <header class="mo-h">
        <button type="button" class="mo-name" @click="emit('pick', `${m.ym}-01`)">{{ monthName(m.ym) }}</button>
        <span v-if="m.deadlines" class="tax-pill" :title="`${m.deadlines} ${m.deadlines === 1 ? 'plazo' : 'plazos'} de Hacienda`">
          <Icon name="ph:bank-fill" aria-hidden="true" /> {{ m.deadlines }}
        </span>
      </header>
      <div class="mo-grid" role="grid" :aria-label="monthTitle(m.ym)">
        <span v-for="w in WEEKDAYS_SHORT" :key="w" class="wd" aria-hidden="true">{{ w }}</span>
        <template v-for="wk in m.weeks" :key="wk[0]">
          <button
            v-for="d in wk"
            :key="d"
            type="button"
            class="d num"
            :class="dayClass(d, m.ym)"
            :tabindex="d.startsWith(m.ym) ? 0 : -1"
            :aria-label="longDate(d, true)"
            @click="emit('pick', d)"
          >
            {{ Number(d.slice(8)) }}
            <i v-if="d.startsWith(m.ym) && dotOf(d)" :style="{ background: dotOf(d)! }" aria-hidden="true" />
          </button>
        </template>
      </div>
      <footer v-if="m.inflow || m.outflow" class="mo-f num">
        <span v-if="m.inflow" class="in">+{{ eurCompact(m.inflow) }}</span>
        <span v-if="m.outflow" class="outf">−{{ eurCompact(m.outflow) }}</span>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.yv {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--s-4);
  padding: var(--s-4);
}

@container cal (max-width: 900px) {
  .yv {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@container cal (max-width: 640px) {
  .yv {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
    padding: var(--s-3);
  }
}

.mo {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: var(--s-3);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-xl);
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}

.mo.cur {
  background: var(--surface);
  border-color: color-mix(in srgb, var(--brand) 35%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 8%, transparent);
}

.mo-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
}

.mo-name {
  font-size: var(--text-base);
  font-weight: 680;
  letter-spacing: -0.01em;
  color: var(--text);
}

.mo-name:hover {
  color: var(--brand-text);
}

.cur .mo-name {
  color: var(--brand-text);
}

.tax-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  font-size: var(--text-2xs);
  font-weight: 700;
  color: var(--cal-red);
  background: color-mix(in srgb, var(--cal-red) 11%, transparent);
  border-radius: var(--r-full);
}

.mo-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 1px;
}

.wd {
  padding-bottom: 2px;
  font-size: 10px;
  font-weight: 650;
  color: var(--text-4);
  text-align: center;
}

.d {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  font-size: 11.5px;
  font-weight: 540;
  color: var(--text-2);
  border-radius: var(--r-full);
  transition: background var(--t-fast), color var(--t-fast);
}

.d:hover {
  background: var(--surface-hover);
}

.d.out {
  visibility: hidden;
}

.d.hol {
  color: var(--cal-pink);
}

.d i {
  position: absolute;
  bottom: 1px;
  left: 50%;
  width: 4px;
  height: 4px;
  border-radius: var(--r-full);
  transform: translateX(-50%);
}

.d.tax {
  font-weight: 700;
  color: var(--cal-red);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--cal-red) 55%, transparent);
}

.d.today {
  font-weight: 700;
  color: var(--on-brand);
  background: var(--brand);
  box-shadow: none;
}

.d.today i {
  background: var(--on-brand) !important;
}

.d.sel:not(.today) {
  background: var(--surface-active);
}

.mo-f {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 6px;
  font-size: var(--text-2xs);
  font-weight: 650;
}

.in {
  color: var(--success);
}

.outf {
  color: var(--text-3);
}
</style>
