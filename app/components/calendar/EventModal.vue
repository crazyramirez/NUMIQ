<script setup lang="ts">
import type { CalendarColor, EventRepeat } from '#shared/utils/calendar'
import type { ComboOption } from '~/components/ui/Combobox.vue'

/** Crear o editar un evento o una tarea propios del calendario */
const props = defineProps<{ eventId: number | null, date?: string | null, time?: string | null }>()
const emit = defineEmits<{ saved: [id: number], deleted: [] }>()
const open = defineModel<boolean>({ default: false })

const toast = useToast()
const { confirm } = useConfirm()
const formId = useId()

interface EventDto {
  id: number
  kind: 'event' | 'task'
  title: string
  notes: string | null
  location: string | null
  startDate: string
  endDate: string | null
  startTime: string | null
  endTime: string | null
  color: CalendarColor
  repeat: EventRepeat
  repeatInterval: number
  repeatUntil: string | null
  remindMinutes: number | null
  contactId: number | null
}

const blank = () => ({
  kind: 'event' as 'event' | 'task',
  title: '',
  startDate: todayISO(),
  allDay: true,
  startTime: '09:00',
  endTime: '10:00',
  multiDay: false,
  endDate: todayISO(),
  repeat: 'none' as EventRepeat,
  repeatUntil: '' as string,
  remind: 'none' as string,
  color: 'green' as CalendarColor,
  location: '',
  notes: '',
  contactId: null as number | null,
})

const form = ref(blank())
const loading = ref(false)
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const isEdit = computed(() => !!props.eventId)

const contacts = ref<ComboOption[]>([])
async function loadContacts() {
  if (contacts.value.length) return
  const list = await $fetch<Array<{ id: number, name: string, isClient: boolean, isSupplier: boolean, logoUrl?: string | null }>>('/api/contacts', { query: { limit: 500 } }).catch(() => [])
  contacts.value = list.map(c => ({ value: c.id, label: c.name, sub: c.isClient && c.isSupplier ? 'Cliente y proveedor' : c.isClient ? 'Cliente' : 'Proveedor', image: c.logoUrl ?? null }))
}

watch(open, async (v) => {
  if (!v) return
  errors.value = {}
  form.value = blank()
  void loadContacts()
  if (!props.eventId) {
    const d = props.date || todayISO()
    form.value.startDate = d
    form.value.endDate = d
    if (props.time) {
      form.value.allDay = false
      form.value.startTime = props.time
      form.value.endTime = addHour(props.time)
    }
    return
  }
  loading.value = true
  try {
    const e = await $fetch<EventDto>(`/api/calendar/events/${props.eventId}`)
    form.value = {
      kind: e.kind,
      title: e.title,
      startDate: e.startDate,
      allDay: !e.startTime,
      startTime: e.startTime ?? '09:00',
      endTime: e.endTime ?? addHour(e.startTime ?? '09:00'),
      multiDay: !!e.endDate && e.endDate > e.startDate,
      endDate: e.endDate ?? e.startDate,
      repeat: e.repeat,
      repeatUntil: e.repeatUntil ?? '',
      remind: e.remindMinutes == null ? 'none' : String(e.remindMinutes),
      color: e.color,
      location: e.location ?? '',
      notes: e.notes ?? '',
      contactId: e.contactId,
    }
  }
  catch (err) {
    toast.error('No se pudo abrir el evento', errorMessage(err))
    open.value = false
  }
  finally {
    loading.value = false
  }
})

function addHour(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${String(Math.min(23, h! + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// La hora final acompaña a la inicial si se queda antes
watch(() => form.value.startTime, (t, prev) => {
  if (!t || !prev || form.value.multiDay) return
  if (form.value.endTime <= t) form.value.endTime = addHour(t)
})
watch(() => form.value.startDate, (d) => {
  if (form.value.endDate < d) form.value.endDate = d
})

const kinds = [
  { value: 'event', label: 'Evento' },
  { value: 'task', label: 'Tarea' },
]
const isTask = computed(() => form.value.kind === 'task')

const repeatOptions = (Object.keys(REPEAT_LABELS) as EventRepeat[]).map(k => ({ value: k, label: REPEAT_LABELS[k] }))

const remindOptions = computed(() => form.value.allDay
  ? [
      { value: 'none', label: 'Sin aviso' },
      { value: '0', label: 'El mismo día, a las 9:00' },
      { value: '1440', label: 'El día antes, a las 9:00' },
      { value: '4320', label: '3 días antes' },
      { value: '10080', label: 'Una semana antes' },
    ]
  : [
      { value: 'none', label: 'Sin aviso' },
      { value: '0', label: 'A la hora' },
      { value: '10', label: '10 minutos antes' },
      { value: '30', label: '30 minutos antes' },
      { value: '60', label: '1 hora antes' },
      { value: '1440', label: '1 día antes' },
    ])
watch(() => form.value.allDay, () => {
  if (!remindOptions.value.some(o => o.value === form.value.remind)) form.value.remind = 'none'
})

// Ideas para empezar rápido (solo al crear)
const quick = [
  { label: 'Reunión', kind: 'event', color: 'brand', icon: 'ph:users-three' },
  { label: 'Llamar a', kind: 'task', color: 'sky', icon: 'ph:phone' },
  { label: 'Pagar', kind: 'task', color: 'amber', icon: 'ph:credit-card' },
  { label: 'Enviar al gestor', kind: 'task', color: 'violet', icon: 'ph:paper-plane-tilt' },
  { label: 'Vacaciones', kind: 'event', color: 'teal', icon: 'ph:airplane-tilt' },
] as const

function applyQuick(q: typeof quick[number]) {
  form.value.kind = q.kind
  form.value.color = q.color
  if (q.label === 'Vacaciones') {
    form.value.multiDay = true
    form.value.allDay = true
    form.value.endDate = shiftDays(form.value.startDate, 6)
  }
  form.value.title = q.label === 'Llamar a' ? 'Llamar a ' : q.label
  nextTick(() => document.querySelector<HTMLInputElement>(`#${CSS.escape(formId)} input[name="title"]`)?.focus())
}

async function submit() {
  const f = form.value
  errors.value = {}
  if (!f.title.trim()) {
    errors.value.title = 'Ponle un título'
    return
  }
  const body = {
    kind: f.kind,
    title: f.title.trim(),
    notes: f.notes.trim() || null,
    location: isTask.value ? null : f.location.trim() || null,
    startDate: f.startDate,
    endDate: !isTask.value && f.multiDay ? f.endDate : null,
    startTime: f.allDay ? null : f.startTime,
    endTime: f.allDay || isTask.value ? null : f.endTime,
    color: f.color,
    repeat: f.repeat,
    repeatInterval: 1,
    repeatUntil: f.repeat !== 'none' && f.repeatUntil ? f.repeatUntil : null,
    remindMinutes: f.remind === 'none' ? null : Number(f.remind),
    contactId: f.contactId,
  }
  saving.value = true
  try {
    const id = props.eventId
      ? (await $fetch(`/api/calendar/events/${props.eventId}`, { method: 'PATCH', body }), props.eventId)
      : (await $fetch<{ id: number }>('/api/calendar/events', { method: 'POST', body })).id
    toast.success(isEdit.value ? 'Guardado' : isTask.value ? 'Tarea añadida' : 'Evento añadido', longDate(f.startDate))
    open.value = false
    emit('saved', id)
  }
  catch (err) {
    const field = errorField(err)
    if (field) errors.value[field] = errorMessage(err)
    else toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.eventId) return
  const ok = await confirm({
    title: `¿Borrar «${form.value.title}»?`,
    body: form.value.repeat !== 'none' ? 'Se borran todas sus repeticiones.' : 'No se puede deshacer.',
    confirmLabel: 'Borrar',
    danger: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/calendar/events/${props.eventId}`, { method: 'DELETE' })
    toast.success('Borrado')
    open.value = false
    emit('deleted')
  }
  catch (err) {
    toast.error('No se pudo borrar', errorMessage(err))
  }
}
</script>

<template>
  <UiModal v-model="open" :title="isEdit ? (isTask ? 'Editar tarea' : 'Editar evento') : (isTask ? 'Nueva tarea' : 'Nuevo evento')" size="md">
    <div v-if="loading" class="ev-loading">
      <div class="skeleton" style="height: 36px" />
      <div class="skeleton" style="height: 44px" />
      <div class="skeleton" style="height: 44px; width: 70%" />
    </div>
    <form v-else :id="formId" class="ev-form" novalidate @submit.prevent="submit">
      <UiSegmented v-model="form.kind" :options="kinds" label="Tipo" />

      <div class="title-wrap">
        <input
          v-model="form.title"
          name="title"
          class="title-in"
          :class="{ invalid: errors.title }"
          :placeholder="isTask ? '¿Qué hay que hacer?' : 'Título del evento'"
          maxlength="200"
          autocomplete="off"
          autofocus
          aria-label="Título"
        >
        <p v-if="errors.title" class="error-text" role="alert">{{ errors.title }}</p>
        <div v-if="!isEdit && !form.title" class="quick" role="group" aria-label="Ideas">
          <button v-for="q in quick" :key="q.label" type="button" class="qk" :style="{ '--c': calColor(q.color) }" @click="applyQuick(q)">
            <Icon :name="q.icon" aria-hidden="true" /> {{ q.label }}
          </button>
        </div>
      </div>

      <section class="grp">
        <div class="when">
          <UiInput v-model="form.startDate" type="date" :label="form.multiDay && !isTask ? 'Desde' : 'Fecha'" :error="errors.startDate" required />
          <UiInput v-if="form.multiDay && !isTask" v-model="form.endDate" type="date" label="Hasta" :min="form.startDate" :error="errors.endDate" />
          <template v-else-if="!form.allDay">
            <UiInput v-model="form.startTime" type="time" :label="isTask ? 'Hora' : 'Empieza'" :error="errors.startTime" />
            <UiInput v-if="!isTask" v-model="form.endTime" type="time" label="Acaba" :error="errors.endTime" />
          </template>
        </div>
        <div class="toggles">
          <UiSwitch v-model="form.allDay" label="Todo el día" :disabled="form.multiDay && !isTask" />
          <UiSwitch v-if="!isTask" v-model="form.multiDay" label="Varios días" @update:model-value="v => v && (form.allDay = true)" />
        </div>
      </section>

      <div class="two">
        <UiSelect v-model="form.repeat" label="Repetir" :options="repeatOptions" />
        <UiInput v-if="form.repeat !== 'none'" v-model="form.repeatUntil" type="date" label="Hasta (opcional)" :min="form.startDate" :error="errors.repeatUntil" />
        <UiSelect v-model="form.remind" label="Aviso al móvil" :options="remindOptions" hint="Llega si tienes los avisos activados" />
      </div>

      <div class="field">
        <span class="label">Color</span>
        <div class="swatches" role="radiogroup" aria-label="Color">
          <button
            v-for="c in CALENDAR_COLORS"
            :key="c.key"
            type="button"
            role="radio"
            class="sw"
            :class="{ on: form.color === c.key }"
            :aria-checked="form.color === c.key"
            :aria-label="c.label"
            :title="c.label"
            :style="{ '--c': calColor(c.key) }"
            @click="form.color = c.key"
          >
            <Icon v-if="form.color === c.key" name="ph:check-bold" aria-hidden="true" />
          </button>
        </div>
      </div>

      <UiCombobox v-model="form.contactId" label="Cliente o proveedor (opcional)" :options="contacts" placeholder="Vincular con un contacto" avatars />
      <UiInput v-if="!isTask" v-model="form.location" label="Lugar o enlace (opcional)" icon="ph:map-pin" placeholder="Oficina, dirección o enlace de la videollamada" maxlength="200" />
      <UiTextarea v-model="form.notes" label="Notas" rows="3" placeholder="Lo que quieras recordar" maxlength="5000" />
    </form>

    <template #footer>
      <UiButton v-if="isEdit" variant="ghost" icon="ph:trash" class="del" @click="remove">Borrar</UiButton>
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" :form="formId" variant="primary" icon="ph:check-bold" :loading="saving" :disabled="loading">{{ isEdit ? 'Guardar' : 'Añadir' }}</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.ev-loading {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.ev-form {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.ev-form :deep(.seg) {
  align-self: flex-start;
}

.title-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.title-in {
  width: 100%;
  padding: 4px 0 8px;
  font-size: var(--text-xl);
  font-weight: 650;
  letter-spacing: -0.015em;
  color: var(--text);
  background: none;
  border: 0;
  border-bottom: 1.5px solid var(--border);
  outline: none;
  transition: border-color var(--t-fast);
}

.title-in::placeholder {
  color: var(--text-4);
  font-weight: 560;
}

.title-in:focus {
  border-bottom-color: var(--brand);
}

.title-in.invalid {
  border-bottom-color: var(--danger);
}

.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.qk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
}

.qk > :first-child {
  color: var(--c);
}

.qk:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--c) 8%, var(--surface));
  border-color: color-mix(in srgb, var(--c) 35%, var(--border));
}

.grp {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4) var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.when {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--s-3);
}

.toggles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-3) var(--s-6);
}

.toggles :deep(.switch-row) {
  justify-content: flex-start;
  flex-direction: row-reverse;
  gap: 10px;
}

.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-3);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sw {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  font-size: 14px;
  color: #fff;
  background: var(--c);
  border-radius: var(--r-full);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
  transition: transform var(--t-fast) var(--ease-spring), box-shadow var(--t-fast);
}

.sw:hover {
  transform: scale(1.08);
}

.sw.on {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--c);
}

.del {
  margin-right: auto;
  color: var(--danger);
}

@media (max-width: 560px) {
  .when {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .when > :first-child {
    grid-column: 1 / -1;
  }

  .two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
