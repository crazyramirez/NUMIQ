<script setup lang="ts">
/** Recordatorios automáticos de cobro: calendario de avisos, mensaje y facturas vencidas en cola */
interface Settings { enabled: boolean, days: number[], message: string | null, attachPdf: boolean }
interface Item {
  id: number
  number: string | null
  customer: string
  contactId: number | null
  email: string | null
  pending: number
  dueDate: string
  overdueDays: number
  sent: number
  nextDate: string | null
  ready: boolean
  problem: 'no_email' | null
}

const props = withDefaults(defineProps<{ canEdit?: boolean }>(), { canEdit: true })
const toast = useToast()

const { data, refresh, status } = await useFetch<{ settings: Settings, queue: Item[], total: number, mail: boolean, businessHours: boolean }>('/api/reminders', { lazy: true, server: false })

const OPTIONS = [1, 3, 7, 15, 30, 45, 60, 90]
const TOKENS = [
  { k: '{cliente}', l: 'Cliente' },
  { k: '{numero}', l: 'Nº factura' },
  { k: '{importe}', l: 'Pendiente' },
  { k: '{vencimiento}', l: 'Vencimiento' },
  { k: '{dias}', l: 'Días de retraso' },
  { k: '{empresa}', l: 'Tu empresa' },
]

const form = reactive<Settings>({ enabled: false, days: [3, 15, 30], message: '', attachPdf: true })
const original = ref('')
const saving = ref(false)
const sending = ref(false)
const error = ref<string | null>(null)

watch(() => data.value?.settings, (s) => {
  if (!s) return
  Object.assign(form, { ...s, days: [...s.days], message: s.message ?? '' })
  original.value = JSON.stringify(form)
}, { immediate: true })

const dirty = computed(() => JSON.stringify(form) !== original.value)
const readyCount = computed(() => data.value?.queue.filter(i => i.ready).length ?? 0)
const noEmail = computed(() => data.value?.queue.filter(i => i.problem === 'no_email').length ?? 0)

function toggleDay(d: number) {
  const i = form.days.indexOf(d)
  if (i >= 0) {
    if (form.days.length > 1) form.days.splice(i, 1)
  }
  else if (form.days.length < 4) {
    form.days.push(d)
    form.days.sort((a, b) => a - b)
  }
  else {
    toast.info('Como mucho 4 avisos por factura', 'Quita uno para elegir otro.')
  }
}

function insert(token: string) {
  const m = form.message ?? ''
  form.message = `${m}${m && !/\s$/.test(m) ? ' ' : ''}${token}`
}

const autoSaving = ref(false)
const lastSaved = ref<Date | null>(null)

async function save(silent: boolean | Event = false) {
  const isSilent = typeof silent === 'boolean' ? silent : false
  error.value = null
  saving.value = true
  if (isSilent) autoSaving.value = true
  try {
    await $fetch('/api/reminders', { method: 'PUT', body: { ...form, message: form.message?.trim() || null } })
    original.value = JSON.stringify(form)
    lastSaved.value = new Date()
    if (!isSilent) {
      toast.success(form.enabled ? 'Recordatorios activados' : 'Recordatorios guardados', form.enabled ? 'NUMIQ avisará a tus clientes en horario laboral.' : undefined)
    }
    await refresh()
  }
  catch (err) {
    error.value = errorMessage(err)
    if (!isSilent) toast.error('Error al guardar', error.value)
  }
  finally {
    saving.value = false
    autoSaving.value = false
  }
}

const debouncedAutoSaveReminders = useDebounceFn(() => {
  if (dirty.value && props.canEdit) {
    save(true)
  }
}, 600)

watch(form, () => {
  if (dirty.value && props.canEdit) {
    debouncedAutoSaveReminders()
  }
}, { deep: true })

async function sendNow() {
  sending.value = true
  try {
    const r = await $fetch<{ sent: number, failed: number }>('/api/reminders/send', { method: 'POST' })
    if (r.failed) toast.error(`${r.sent} enviados, ${r.failed} con error`, 'Revisa el historial de envíos de cada factura.')
    else toast.success(r.sent === 1 ? 'Recordatorio enviado' : `${r.sent} recordatorios enviados`)
    await refresh()
  }
  catch (err) {
    toast.error('No se pudieron enviar', errorMessage(err))
  }
  finally {
    sending.value = false
  }
}

function nextLabel(i: Item) {
  if (i.problem === 'no_email') return 'Sin email'
  if (!i.nextDate) return 'Avisos completos'
  if (i.ready) return form.enabled ? 'Hoy' : 'Pendiente'
  return fdateShort(i.nextDate).slice(0, 5)
}
</script>

<template>
  <div class="stack gap-4">
    <UiCard title="Recordatorios de cobro" icon="ph:bell-ringing" subtitle="Cuando una factura vence sin cobrar, NUMIQ escribe al cliente por ti con la factura adjunta. Solo en horario laboral: de lunes a viernes, de 9 a 19 h.">
      <div v-if="status === 'pending' && !data" class="stack gap-3">
        <div v-for="i in 3" :key="i" class="skeleton" style="height: 44px" />
      </div>
      <form v-else class="rem" novalidate @submit.prevent="save">
        <div v-if="data && !data.mail" class="warn">
          <Icon name="ph:envelope-simple-open" aria-hidden="true" />
          <span>El correo de la app no está configurado: añade GOOGLE_APP_EMAIL y GOOGLE_APP_PASSWORD para poder enviar avisos.</span>
        </div>

        <fieldset :disabled="!props.canEdit" class="fs">
          <UiSwitch v-model="form.enabled" label="Enviar recordatorios automáticos" hint="Puedes pararlo cuando quieras. Al registrar el cobro, la factura sale de la cola." />

          <div class="block" :class="{ off: !form.enabled }">
            <p class="lbl">¿Cuándo avisar? <span class="muted">Días después del vencimiento · hasta 4 avisos</span></p>
            <div class="chips" role="group" aria-label="Días tras el vencimiento">
              <button
                v-for="d in OPTIONS"
                :key="d"
                type="button"
                class="chip"
                :class="{ on: form.days.includes(d) }"
                :aria-pressed="form.days.includes(d)"
                @click="toggleDay(d)"
              >
                {{ d }} {{ d === 1 ? 'día' : 'días' }}
              </button>
            </div>
            <ol class="timeline" aria-label="Calendario de avisos">
              <li class="tl due"><span class="tl-dot" /><span class="tl-t">Vence</span></li>
              <li v-for="(d, i) in form.days" :key="d" class="tl">
                <span class="tl-dot"><Icon name="ph:bell-simple-fill" aria-hidden="true" /></span>
                <span class="tl-t">{{ i + 1 }}.º aviso</span>
                <span class="tl-s">+{{ d }} d</span>
              </li>
            </ol>
          </div>

          <div class="block" :class="{ off: !form.enabled }">
            <UiTextarea
              v-model="form.message"
              label="Mensaje (opcional)"
              rows="5"
              placeholder="Déjalo vacío y NUMIQ usará un mensaje cordial, con el nombre del cliente, que cambia de tono en el segundo aviso."
              hint="Pulsa un dato para añadirlo: se rellena con el de cada factura."
            />
            <div class="tokens">
              <button v-for="t in TOKENS" :key="t.k" type="button" class="token" @click="insert(t.k)">
                <Icon name="ph:plus" aria-hidden="true" />{{ t.l }}
              </button>
            </div>
          </div>

          <UiSwitch v-model="form.attachPdf" label="Adjuntar la factura en PDF" hint="Además del enlace para verla y pagarla." />
        </fieldset>

        <p v-if="error" class="err" role="alert">{{ error }}</p>
        <div v-if="props.canEdit" class="actions">
          <span v-if="autoSaving" class="status-indicator saving"><span class="spin" /> Guardando automáticamente…</span>
          <span v-else-if="lastSaved && !dirty" class="status-indicator saved"><Icon name="ph:check-circle-fill" /> Guardado</span>
          <UiButton type="submit" variant="primary" icon="ph:check-bold" :loading="saving" :disabled="!dirty">Guardar ahora</UiButton>
        </div>
      </form>
    </UiCard>

    <UiCard v-if="data" title="Facturas vencidas" icon="ph:clock-countdown" padding="none" :subtitle="data.total ? `${data.total} sin cobrar · lo que saldrá en cada aviso` : 'Nada pendiente'">
      <template v-if="readyCount && props.canEdit && data.mail" #actions>
        <UiButton size="sm" icon="ph:paper-plane-tilt" :loading="sending" @click="sendNow">Enviar {{ readyCount === 1 ? 'el que toca' : `los ${readyCount} que tocan` }}</UiButton>
      </template>
      <ul v-if="data.queue.length" class="q">
        <li v-for="i in data.queue" :key="i.id">
          <NuxtLink :to="`/facturas/${i.id}`" class="q-row">
            <span class="q-main min0">
              <span class="q-t truncate"><span class="num">{{ i.number }}</span> · {{ i.customer }}</span>
              <span class="q-s">Vencida hace {{ i.overdueDays }} {{ i.overdueDays === 1 ? 'día' : 'días' }}{{ i.sent ? ` · ${i.sent} ${i.sent === 1 ? 'aviso enviado' : 'avisos enviados'}` : '' }}</span>
            </span>
            <span class="q-amt num">{{ eur(i.pending) }}</span>
            <span class="q-next" :class="{ ready: i.ready, bad: i.problem, done: !i.nextDate && !i.problem }">{{ nextLabel(i) }}</span>
          </NuxtLink>
        </li>
      </ul>
      <div v-else class="q-empty">
        <Icon name="ph:confetti" aria-hidden="true" />
        <p>No tienes facturas vencidas sin cobrar.</p>
      </div>
      <p v-if="noEmail" class="q-foot">
        <Icon name="ph:info" aria-hidden="true" />
        {{ noEmail === 1 ? 'Una factura no tiene' : `${noEmail} facturas no tienen` }} email del cliente: añádelo en su ficha para que reciba los avisos.
      </p>
    </UiCard>
  </div>
</template>

<style scoped>
.rem {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.fs {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
  min-width: 0;
  padding: 0;
  border: 0;
}

.warn {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  font-size: var(--text-sm);
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: var(--r-md);
}

.warn :deep(svg) {
  flex: none;
  margin-top: 2px;
}

.block {
  transition: opacity var(--t-base);
}

.block.off {
  opacity: 0.55;
}

.lbl {
  margin-bottom: var(--s-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.lbl .muted {
  font-weight: 400;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  min-height: 36px;
  padding: 0 14px;
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  cursor: pointer;
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
}

.chip:hover {
  border-color: var(--border-strong);
}

.chip.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: var(--brand);
}

.chip:focus-visible,
.token:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.timeline {
  display: flex;
  gap: 0;
  margin-top: var(--s-4);
  padding: var(--s-4) var(--s-2) 0;
  list-style: none;
  overflow-x: auto;
}

.tl {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 72px;
  text-align: center;
}

.tl + .tl::before {
  content: '';
  position: absolute;
  top: 13px;
  right: 50%;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, var(--border-strong), var(--brand-soft-2));
  z-index: 0;
}

.tl-dot {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  font-size: 13px;
  color: var(--brand);
  background: var(--brand-soft);
  border: 2px solid var(--surface);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--brand-soft-2);
}

.tl.due .tl-dot {
  color: var(--text-3);
  background: var(--surface-sunken);
  box-shadow: 0 0 0 1px var(--border);
}

.tl.due .tl-dot::after {
  content: '';
  width: 8px;
  height: 8px;
  background: var(--text-4);
  border-radius: 50%;
}

.tl-t {
  margin-top: 6px;
  font-size: var(--text-xs);
  font-weight: 600;
}

.tl-s {
  font-size: 11px;
  color: var(--text-3);
}

.tokens {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: var(--s-2);
}

.token {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 0 10px;
  font-size: var(--text-xs);
  font-weight: 550;
  color: var(--text-2);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-full);
  cursor: pointer;
  transition: border-color var(--t-fast), color var(--t-fast);
}

.token:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.token :deep(svg) {
  width: 12px;
  height: 12px;
  color: var(--text-3);
}

.err {
  font-size: var(--text-sm);
  color: var(--danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.q {
  max-height: 440px;
  margin: 0;
  padding: 0 0 6px;
  list-style: none;
  overflow-y: auto;
}

.q li + li {
  border-top: 1px solid var(--border-subtle);
}

.q-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 12px var(--s-5);
  transition: background var(--t-fast);
}

.q-row:hover {
  background: var(--surface-hover);
}

.q-main {
  flex: 1;
}

.q-t {
  display: block;
  font-size: var(--text-sm);
  font-weight: 580;
}

.q-s {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.q-amt {
  font-size: var(--text-sm);
  font-weight: 600;
  white-space: nowrap;
}

.q-next {
  flex: none;
  min-width: 92px;
  padding: 4px 10px;
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.q-next.ready {
  color: var(--brand-text);
  background: var(--brand-soft);
}

.q-next.bad {
  color: var(--warning);
  background: var(--warning-soft);
}

.q-next.done {
  color: var(--text-4);
}

.q-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: var(--s-7) var(--s-5);
  color: var(--text-3);
  font-size: var(--text-sm);
}

.q-empty :deep(svg) {
  width: 28px;
  height: 28px;
  color: var(--success-solid);
}

.q-foot {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 12px var(--s-5);
  font-size: var(--text-xs);
  color: var(--text-3);
  border-top: 1px solid var(--border-subtle);
}

.q-foot :deep(svg) {
  flex: none;
  margin-top: 1px;
}

.min0 {
  min-width: 0;
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 550;
  padding: 4px 10px;
  border-radius: var(--r-full);
}

.status-indicator.saving {
  color: var(--brand);
  background: var(--brand-soft);
}

.status-indicator.saved {
  color: var(--success);
  background: var(--success-soft);
}

.status-indicator :deep(svg) {
  font-size: 14px;
}

.spin {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .q-row {
    flex-wrap: wrap;
    padding-inline: var(--s-4);
  }

  .q-main {
    flex-basis: 100%;
  }

  .q-amt {
    margin-right: auto;
  }
}
</style>
