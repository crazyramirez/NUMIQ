<script setup lang="ts">
import type { CalendarItem, EventRepeat } from '#shared/utils/calendar'

/**
 * Un elemento del calendario en lista: el título se lee entero; debajo la hora o el periodo y el
 * estado a la izquierda, y el importe a la derecha. Las tareas llevan su casilla para marcarlas.
 */
const props = defineProps<{ item: CalendarItem, day?: string, canEdit?: boolean }>()
const emit = defineEmits<{ open: [], toggle: [] }>()

const it = computed(() => props.item)
const style = computed(() => ({ '--c': calColor(it.value.color) }))
const status = computed(() => statusText(it.value))

const when = computed(() => {
  const i = it.value
  const parts: string[] = []
  if (isMultiDay(i)) parts.push(props.day && props.day !== i.date ? `Hasta el ${dayMonth(i.endDate!)}` : `Del ${dayMonth(i.date)} al ${dayMonth(i.endDate!)}`)
  const t = timeRange(i)
  if (t) parts.push(t)
  else if (!isMultiDay(i) && i.layer === 'event') parts.push('Todo el día')
  if (i.repeat) parts.push(REPEAT_LABELS[i.repeat as EventRepeat].toLowerCase())
  return parts.join(' · ')
})

const tone = computed(() => {
  const s = it.value.status
  return s === 'overdue' ? 'late' : s === 'done' ? 'ok' : s === 'today' ? 'now' : ''
})
</script>

<template>
  <div class="crow" :class="{ done: it.type === 'task' && it.done }" :style="style">
    <button v-if="it.type === 'task' && canEdit" type="button" class="lead task" :class="{ on: it.done }" :aria-pressed="!!it.done" :aria-label="it.done ? 'Marcar como pendiente' : 'Marcar como hecha'" @click="emit('toggle')">
      <Icon v-if="it.done" name="ph:check-bold" aria-hidden="true" />
    </button>
    <span v-else class="lead" aria-hidden="true"><Icon :name="it.icon" /></span>

    <button type="button" class="body" @click="emit('open')">
      <span class="t">{{ it.title }}</span>
      <span v-if="it.subtitle" class="s">{{ it.subtitle }}</span>
      <span v-if="when || status || it.amount" class="meta">
        <span class="left">
          <span v-if="when" class="when num">{{ when }}</span>
          <span v-if="status" class="st" :class="tone">{{ status }}</span>
        </span>
        <span v-if="it.amount" class="amt num" :class="it.flow">{{ it.flow === 'in' ? '+' : it.flow === 'out' ? '−' : '' }}{{ eur(it.amount) }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.crow {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--r-lg);
  transition: background var(--t-fast);
}

@media (hover: hover) {
  .crow:hover {
    background: var(--surface-hover);
  }
}

.lead {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  font-size: 17px;
  color: color-mix(in srgb, var(--c) 82%, var(--text));
  background: color-mix(in srgb, var(--c) 12%, var(--surface));
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 16%, transparent);
}

.lead.task {
  width: 22px;
  height: 22px;
  margin: 6px;
  font-size: 13px;
  color: #fff;
  background: var(--surface);
  border: 2px solid var(--c);
  border-radius: 7px;
  box-shadow: none;
  transition: background var(--t-fast), transform var(--t-fast) var(--ease-spring);
}

.lead.task:active {
  transform: scale(0.9);
}

.lead.task.on {
  background: var(--c);
}

.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: inherit;
  text-align: left;
}

.body:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 4px;
  border-radius: 4px;
}

.t {
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 1.35;
  color: var(--text);
  overflow-wrap: anywhere;
}

.done .t {
  color: var(--text-3);
  text-decoration: line-through;
  text-decoration-color: var(--text-4);
}

.s {
  font-size: var(--text-sm);
  line-height: 1.4;
  color: var(--text-3);
  overflow-wrap: anywhere;
}

.meta {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
}

.left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
}

.when {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.st {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 7px;
  font-size: var(--text-2xs);
  font-weight: 650;
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.st.late {
  color: var(--danger);
  background: var(--danger-soft);
}

.st.ok {
  color: var(--success);
  background: var(--success-soft);
}

.st.now {
  color: var(--warning);
  background: var(--warning-soft);
}

.amt {
  flex: none;
  font-size: var(--text-base);
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--text);
}

.amt.in {
  color: var(--success);
}
</style>
