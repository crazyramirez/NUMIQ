<script setup lang="ts">
import type { CalendarItem, EventRepeat } from '#shared/utils/calendar'

/** Detalle de un elemento del calendario: qué es, cuándo, cuánto y a dónde llevarlo */
const props = defineProps<{ item: CalendarItem | null, canEdit: boolean }>()
const emit = defineEmits<{ edit: [id: number], toggle: [item: CalendarItem] }>()
const open = defineModel<boolean>({ default: false })

const it = computed(() => props.item)
const LAYER_NAME: Record<string, string> = Object.fromEntries(CALENDAR_LAYERS.map(l => [l.key, l.label]))
const TYPE_NAME: Record<string, string> = { issue: 'Emitido', due: 'Vencimiento', paid: 'Cobro o pago', deadline: 'Último día del plazo', window: 'Plazo de presentación', run: 'Se genera solo', event: 'Evento', task: 'Tarea', holiday: 'Festivo', external: 'Calendario externo' }

const eyebrow = computed(() => {
  const i = it.value
  if (!i) return ''
  const layer = i.layer === 'feed' ? (i.subtitle ?? 'Calendario externo') : LAYER_NAME[i.layer] ?? ''
  const type = i.layer === 'income' && i.type === 'issue' ? 'Factura emitida' : i.layer === 'expense' && i.type === 'issue' ? 'Gasto' : TYPE_NAME[i.type] ?? ''
  return [layer, i.layer === 'feed' ? null : type].filter(Boolean).join(' · ')
})

const when = computed(() => {
  const i = it.value
  if (!i) return ''
  if (isMultiDay(i)) return `Del ${longDate(i.date)} al ${longDate(i.endDate!).toLowerCase()}`
  return longDate(i.date)
})

const countdown = computed(() => {
  const i = it.value
  if (!i?.status || i.status === 'done') return null
  const target = i.type === 'window' ? i.endDate! : i.date
  const n = daysUntil(target)
  if (i.layer !== 'tax' && i.type !== 'due') return null
  if (n < 0) return { text: `Venció hace ${-n} ${n === -1 ? 'día' : 'días'}`, tone: 'late' }
  if (n === 0) return { text: 'Vence hoy', tone: 'now' }
  return { text: `Quedan ${n} ${n === 1 ? 'día' : 'días'}`, tone: n <= 5 ? 'now' : 'calm' }
})

const openLabel = computed(() => {
  const i = it.value
  if (!i?.to) return null
  if (i.layer === 'income') return 'Ver factura'
  if (i.layer === 'expense') return 'Ver gasto'
  if (i.layer === 'quote') return 'Ver presupuesto'
  if (i.layer === 'tax') return 'Preparar los modelos'
  if (i.layer === 'recurring') return 'Ver programación'
  if (i.layer === 'event') return 'Ver contacto'
  return 'Abrir'
})

// Al volver de la factura, el gasto o el contacto, el calendario reabre este mismo elemento
const route = useRoute()
function go() {
  if (!it.value?.to) return
  const to = linkWithReturn(it.value.to, route, { item: it.value.id })
  open.value = false
  navigateTo(to)
}

function downloadIcs() {
  if (!it.value) return
  const url = URL.createObjectURL(itemIcs(it.value))
  const a = document.createElement('a')
  a.href = url
  a.download = `${it.value.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'evento'}.ics`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

const canShare = computed(() => !!it.value && it.value.layer !== 'feed' && it.value.layer !== 'holiday')
</script>

<template>
  <UiModal v-model="open" size="sm" no-touch-keyboard>
    <template #head>
      <div v-if="it" class="im-head" :style="{ '--c': calColor(it.color) }">
        <span class="im-ic" aria-hidden="true"><Icon :name="it.icon" /></span>
        <div class="im-titles">
          <p class="eyebrow">{{ eyebrow }}</p>
          <h2 class="im-t">{{ it.title }}</h2>
          <p v-if="it.subtitle && it.layer !== 'feed'" class="im-s">{{ it.subtitle }}</p>
        </div>
      </div>
    </template>

    <div v-if="it" class="im-body">
      <div v-if="it.amount" class="im-amount num" :class="it.flow">
        {{ it.flow === 'in' ? '+' : it.flow === 'out' ? '−' : '' }}{{ eur(it.amount) }}
        <span class="im-amount-l">{{ it.layer === 'quote' ? 'base imponible' : it.type === 'due' ? 'pendiente' : it.layer === 'tax' ? 'a ingresar' : 'total' }}</span>
      </div>

      <dl class="im-dl">
        <div>
          <dt><Icon name="ph:calendar-blank" aria-hidden="true" /> Cuándo</dt>
          <dd>
            {{ when }}<template v-if="timeRange(it)"> · <span class="num">{{ timeRange(it) }}</span></template>
            <span class="rel">{{ isMultiDay(it) ? '' : relDays(it.date) }}</span>
          </dd>
        </div>
        <div v-if="it.repeat">
          <dt><Icon name="ph:arrows-clockwise" aria-hidden="true" /> Repite</dt>
          <dd>{{ REPEAT_LABELS[it.repeat as EventRepeat] }}</dd>
        </div>
        <div v-if="statusText(it)">
          <dt><Icon name="ph:circle-half" aria-hidden="true" /> Estado</dt>
          <dd>
            <span class="st" :class="it.status">{{ statusText(it) }}</span>
            <span v-if="countdown" class="cd" :class="countdown.tone">{{ countdown.text }}</span>
          </dd>
        </div>
        <div v-if="it.location">
          <dt><Icon name="ph:map-pin" aria-hidden="true" /> Lugar</dt>
          <dd>
            <a v-if="/^https?:\/\//.test(it.location)" :href="it.location" target="_blank" rel="noopener" class="link">{{ it.location }}</a>
            <template v-else>{{ it.location }}</template>
          </dd>
        </div>
      </dl>

      <p v-if="it.notes" class="im-notes">{{ it.notes }}</p>

      <div v-if="canShare" class="im-share">
        <span class="eyebrow">Añadir a tu calendario</span>
        <div class="im-share-row">
          <a :href="googleEventUrl(it)" target="_blank" rel="noopener" class="share-btn"><Icon name="ph:google-logo" aria-hidden="true" /> Google</a>
          <button type="button" class="share-btn" @click="downloadIcs"><Icon name="ph:apple-logo" aria-hidden="true" /> Apple</button>
          <button type="button" class="share-btn" @click="downloadIcs"><Icon name="ph:microsoft-outlook-logo" aria-hidden="true" /> Outlook</button>
        </div>
      </div>
    </div>

    <template v-if="it" #footer>
      <UiButton v-if="it.eventId && canEdit && it.type === 'task'" :icon="it.done ? 'ph:arrow-counter-clockwise' : 'ph:check-bold'" @click="emit('toggle', it)">
        {{ it.done ? 'Pendiente' : 'Hecha' }}
      </UiButton>
      <UiButton v-if="it.eventId && canEdit" icon="ph:pencil-simple" :variant="openLabel ? 'secondary' : 'primary'" @click="emit('edit', it.eventId)">Editar</UiButton>
      <UiButton v-if="openLabel" variant="primary" icon-right="ph:arrow-right" @click="go">{{ openLabel }}</UiButton>
      <UiButton v-if="!openLabel && !(it.eventId && canEdit)" @click="open = false">Cerrar</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.im-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
}

.im-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  font-size: 22px;
  color: color-mix(in srgb, var(--c) 85%, var(--text));
  background: color-mix(in srgb, var(--c) 13%, var(--surface));
  border-radius: 13px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 20%, transparent);
}

.im-titles {
  min-width: 0;
}

.im-titles .eyebrow {
  color: color-mix(in srgb, var(--c) 80%, var(--text-3));
}

.im-t {
  margin-top: 2px;
  font-size: var(--text-lg);
  font-weight: 680;
  line-height: 1.3;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

.im-s {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-3);
  overflow-wrap: anywhere;
}

.im-body {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.im-amount {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--text-3xl);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text);
}

.im-amount.in {
  color: var(--success);
}

.im-amount-l {
  font-size: var(--text-sm);
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-3);
}

.im-dl {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}

.im-dl > div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: var(--s-3);
  align-items: baseline;
}

.im-dl dt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
}

.im-dl dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 0;
  font-size: var(--text-base);
  color: var(--text);
  overflow-wrap: anywhere;
}

.rel {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.st {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  font-size: var(--text-xs);
  font-weight: 650;
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.st.overdue {
  color: var(--danger);
  background: var(--danger-soft);
}

.st.done {
  color: var(--success);
  background: var(--success-soft);
}

.st.today {
  color: var(--warning);
  background: var(--warning-soft);
}

.cd {
  font-size: var(--text-xs);
  font-weight: 650;
}

.cd.late {
  color: var(--danger);
}

.cd.now {
  color: var(--warning);
}

.cd.calm {
  color: var(--text-3);
}

.im-notes {
  padding: var(--s-3) var(--s-4);
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--text-2);
  white-space: pre-line;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  overflow-wrap: anywhere;
}

.im-share {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: var(--s-3);
  border-top: 1px solid var(--border-subtle);
}

.im-share-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.share-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
}

.share-btn:hover {
  color: var(--text);
  background: var(--surface-hover);
  border-color: var(--border-strong);
}
</style>
