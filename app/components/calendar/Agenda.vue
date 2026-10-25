<script setup lang="ts">
import type { CalendarItem } from '#shared/utils/calendar'

/** El mes como lista, día a día; lo de varios días aparece el día que empieza (o el primero del mes) */
const props = defineProps<{ items: CalendarItem[], from: string, to: string, today: string, canEdit: boolean }>()
const emit = defineEmits<{ open: [item: CalendarItem], toggle: [item: CalendarItem], create: [date: string] }>()

const groups = computed(() => {
  const map = new Map<string, CalendarItem[]>()
  for (const it of props.items) {
    const d = it.date < props.from ? props.from : it.date
    if (d > props.to) continue
    map.set(d, [...(map.get(d) ?? []), it])
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, list }))
})

const totals = (list: CalendarItem[]) => {
  const pending = list.filter(i => i.status !== 'done' && (i.type === 'due' || i.type === 'run'))
  return {
    in: round2(pending.filter(i => i.flow === 'in').reduce((s, i) => s + (i.amount ?? 0), 0)),
    out: round2(pending.filter(i => i.flow === 'out').reduce((s, i) => s + (i.amount ?? 0), 0)),
  }
}

const rel = (d: string) => (d === props.today ? 'Hoy' : relDays(d))
</script>

<template>
  <div class="ag">
    <UiEmpty v-if="!groups.length" compact icon="ph:calendar-blank" title="Nada este mes" text="Sin facturas, pagos ni plazos con fecha en este mes.">
      <UiButton v-if="canEdit" icon="ph:plus-bold" @click="emit('create', from > today ? from : today)">Añadir evento</UiButton>
    </UiEmpty>
    <ol v-else class="ag-list">
      <li v-for="(g, i) in groups" :key="g.date" class="ag-day rise" :class="{ today: g.date === today, past: g.date < today }" :style="{ '--i': Math.min(i, 8) }">
        <div class="ag-date">
          <span class="wd">{{ weekdayShort(g.date) }}</span>
          <span class="dn num">{{ Number(g.date.slice(8)) }}</span>
          <span class="rl">{{ rel(g.date) }}</span>
        </div>
        <div class="ag-items">
          <div v-if="totals(g.list).in || totals(g.list).out" class="ag-sum num">
            <span v-if="totals(g.list).in" class="in">+{{ eur(totals(g.list).in) }} por cobrar</span>
            <span v-if="totals(g.list).out" class="out">−{{ eur(totals(g.list).out) }} por pagar</span>
          </div>
          <CalendarRow v-for="it in g.list" :key="it.id" :item="it" :day="g.date" :can-edit="canEdit" @open="emit('open', it)" @toggle="emit('toggle', it)" />
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.ag {
  padding: var(--s-2) var(--s-3) var(--s-3);
}

.ag-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ag-day {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: var(--s-3);
  padding: var(--s-3) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.ag-day:last-child {
  border-bottom: 0;
}

.ag-date {
  position: sticky;
  top: calc(var(--topbar-h) + 8px);
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: start;
  padding-top: 8px;
  line-height: 1.1;
}

.wd,
.rl {
  font-size: var(--text-2xs);
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
}

.rl {
  margin-top: 4px;
  font-weight: 560;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text-4);
}

.dn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-top: 2px;
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
  border-radius: var(--r-full);
}

.today .dn {
  color: var(--on-brand);
  background: var(--brand);
  box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--brand) 70%, transparent);
}

.today .wd,
.today .rl {
  color: var(--brand-text);
}

.past .dn {
  color: var(--text-3);
}

.ag-items {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ag-sum {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 6px 12px 2px;
  font-size: var(--text-xs);
  font-weight: 600;
}

.ag-sum .in {
  color: var(--success);
}

.ag-sum .out {
  color: var(--text-3);
}

@container cal (max-width: 520px) {
  .ag {
    padding: var(--s-1) var(--s-1) var(--s-2);
  }

  .ag-day {
    grid-template-columns: 48px minmax(0, 1fr);
    gap: var(--s-1);
  }

  .dn {
    width: 34px;
    height: 34px;
    font-size: var(--text-lg);
  }
}
</style>
