<script setup lang="ts">
import type { CalendarColor, CalendarLayer } from '#shared/utils/calendar'

/**
 * Conectar el calendario con el móvil y el ordenador, en los dos sentidos:
 *  - NUMIQ en tu calendario: dirección privada (webcal) para Google Calendar, Apple Calendar u Outlook.
 *  - Tu calendario en NUMIQ: la dirección iCal secreta de Google, iCloud u Outlook, vista dentro.
 */
export interface FeedRow { id: number, name: string, color: string, active: boolean, lastSyncAt: string | null, lastError: string | null }

const props = defineProps<{ feeds: FeedRow[], initialTab?: 'out' | 'in' }>()
const emit = defineEmits<{ changed: [] }>()
const open = defineModel<boolean>({ default: false })

const toast = useToast()
const { confirm } = useConfirm()

interface Link { https: string, webcal: string, google: string, outlook: string, office: string, name: string, layers: CalendarLayer[], lastUsedAt: string | null, local: boolean }

const tab = ref<'out' | 'in'>('out')
const tabs = [
  { value: 'out', label: 'En tu calendario' },
  { value: 'in', label: 'Tus calendarios aquí' },
]
const link = ref<Link | null>(null)
const loading = ref(false)

watch(open, async (v) => {
  if (!v) return
  tab.value = props.initialTab ?? 'out'
  resetForm()
  if (link.value) return
  loading.value = true
  try {
    link.value = await $fetch<Link>('/api/calendar/link')
  }
  catch (err) {
    toast.error('No se pudo preparar la dirección', errorMessage(err))
  }
  finally {
    loading.value = false
  }
})

const PUBLISHABLE = CALENDAR_LAYERS
const layerOn = (k: CalendarLayer) => !!link.value?.layers.includes(k)
const savingLayers = ref(false)
async function toggleLayer(k: CalendarLayer, on: boolean) {
  if (!link.value) return
  const layers = on ? [...link.value.layers, k] : link.value.layers.filter(x => x !== k)
  const prev = link.value.layers
  link.value = { ...link.value, layers }
  savingLayers.value = true
  try {
    link.value = await $fetch<Link>('/api/calendar/link', { method: 'PATCH', body: { layers } })
  }
  catch (err) {
    link.value = { ...link.value, layers: prev }
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    savingLayers.value = false
  }
}

const copied = ref(false)
async function copy() {
  if (!link.value) return
  if (await copyToClipboard(link.value.https)) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  }
}

async function reset() {
  const ok = await confirm({
    title: '¿Crear una dirección nueva?',
    body: 'La actual deja de funcionar al momento en todos los calendarios donde la añadiste. Tendrás que volver a conectarlos.',
    confirmLabel: 'Crear nueva',
    danger: true,
  })
  if (!ok) return
  try {
    link.value = await $fetch<Link>('/api/calendar/link/reset', { method: 'POST' })
    toast.success('Dirección nueva lista', 'La anterior ya no funciona')
  }
  catch (err) {
    toast.error('No se pudo cambiar', errorMessage(err))
  }
}

const providers = computed(() => link.value
  ? [
      { key: 'google', name: 'Google Calendar', hint: 'Android, web y cualquier dispositivo con tu cuenta de Google', icon: 'logos', href: link.value.google, external: true },
      { key: 'apple', name: 'Apple Calendar', hint: 'iPhone, iPad y Mac: se abre la app Calendario', icon: 'ph:apple-logo', href: link.value.webcal, external: false },
      { key: 'outlook', name: 'Outlook', hint: 'Outlook.com, Hotmail y la app de Outlook', icon: 'ph:microsoft-outlook-logo', href: link.value.outlook, external: true },
      { key: 'office', name: 'Microsoft 365', hint: 'Outlook de empresa (trabajo o centro educativo)', icon: 'ph:microsoft-outlook-logo', href: link.value.office, external: true },
    ]
  : [])

// ─── Calendarios externos ───

const steps = [
  { key: 'google', name: 'Google Calendar', icon: 'ph:google-logo', text: 'En calendar.google.com (ordenador): ⚙ Configuración → elige tu calendario a la izquierda → «Integrar el calendario» → copia la «Dirección secreta en formato iCal».' },
  { key: 'apple', name: 'iCloud (Apple)', icon: 'ph:apple-logo', text: 'En la app Calendario del Mac o en icloud.com: pulsa en el calendario → «Calendario público» → copia el enlace (empieza por webcal://).' },
  { key: 'outlook', name: 'Outlook', icon: 'ph:microsoft-outlook-logo', text: 'En outlook.com: Configuración → Calendario → «Calendarios compartidos» → «Publicar un calendario» → elige «Puede ver todos los detalles» → copia el enlace ICS.' },
]
const howTo = ref<string | null>('google')

const feedForm = ref({ name: '', url: '', color: 'sky' as CalendarColor })
const feedError = ref<string | null>(null)
const adding = ref(false)
function resetForm() {
  feedForm.value = { name: '', url: '', color: (CALENDAR_COLORS.find(c => !props.feeds.some(f => f.color === c.key) && !['red', 'amber', 'brand'].includes(c.key))?.key ?? 'sky') as CalendarColor }
  feedError.value = null
}

// Nombre sugerido según la dirección
watch(() => feedForm.value.url, (u) => {
  if (feedForm.value.name) return
  if (/google\.com/i.test(u)) feedForm.value.name = 'Google Calendar'
  else if (/icloud\.com/i.test(u)) feedForm.value.name = 'iCloud'
  else if (/outlook|office365|live\.com/i.test(u)) feedForm.value.name = 'Outlook'
})

async function addFeed() {
  feedError.value = null
  const f = feedForm.value
  if (!f.url.trim()) {
    feedError.value = 'Pega la dirección del calendario'
    return
  }
  adding.value = true
  try {
    const r = await $fetch<{ id: number, count: number }>('/api/calendar/feeds', { method: 'POST', body: { name: f.name.trim() || 'Mi calendario', url: f.url.trim(), color: f.color } })
    toast.success('Calendario conectado', r.count ? `${r.count} ${r.count === 1 ? 'evento' : 'eventos'} a la vista` : 'Todavía no tiene eventos')
    resetForm()
    emit('changed')
  }
  catch (err) {
    feedError.value = errorMessage(err)
  }
  finally {
    adding.value = false
  }
}

const busyFeed = ref<number | null>(null)
async function syncFeed(f: FeedRow) {
  busyFeed.value = f.id
  try {
    const r = await $fetch<{ count: number }>(`/api/calendar/feeds/${f.id}/sync`, { method: 'POST' })
    toast.success(`${f.name} al día`, `${r.count} ${r.count === 1 ? 'evento' : 'eventos'}`)
  }
  catch (err) {
    toast.error('No se pudo actualizar', errorMessage(err))
  }
  finally {
    busyFeed.value = null
    emit('changed')
  }
}

async function patchFeed(f: FeedRow, body: Partial<Pick<FeedRow, 'active' | 'color' | 'name'>>) {
  try {
    await $fetch(`/api/calendar/feeds/${f.id}`, { method: 'PATCH', body })
    emit('changed')
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
}

async function removeFeed(f: FeedRow) {
  const ok = await confirm({ title: `¿Quitar «${f.name}»?`, body: 'Deja de verse en NUMIQ. Tu calendario original no cambia.', confirmLabel: 'Quitar', danger: true })
  if (!ok) return
  try {
    await $fetch(`/api/calendar/feeds/${f.id}`, { method: 'DELETE' })
    emit('changed')
  }
  catch (err) {
    toast.error('No se pudo quitar', errorMessage(err))
  }
}

const nextColor = (c: string) => {
  const i = CALENDAR_COLORS.findIndex(x => x.key === c)
  return CALENDAR_COLORS[(i + 1) % CALENDAR_COLORS.length]!.key
}
</script>

<template>
  <UiModal v-model="open" title="Conectar calendario" subtitle="Lo que pasa en NUMIQ, en el calendario de tu móvil; y tus citas, aquí" size="lg" no-touch-keyboard>
    <div class="cn">
      <UiSegmented v-model="tab" :options="tabs" label="Sentido" />

      <!-- ─── NUMIQ en tu calendario ─── -->
      <template v-if="tab === 'out'">
        <p class="cn-sub">Un toque y listo: lo nuevo de NUMIQ, también tus eventos y tareas, aparece solo en tu calendario. Apple y Outlook lo actualizan cada hora; Google, cada pocas horas.</p>
        <div v-if="loading || !link" class="cn-loading">
          <div v-for="i in 4" :key="i" class="skeleton" style="height: 64px; border-radius: 14px" />
        </div>
        <template v-else>
          <p v-if="link.local" class="cn-warn">
            <Icon name="ph:info" aria-hidden="true" />
            <span>Estás usando NUMIQ en local. Google, Apple y Outlook solo pueden leer una dirección pública: funcionará cuando NUMIQ esté publicado en su dominio.</span>
          </p>

          <div class="prov-grid">
            <a
              v-for="p in providers"
              :key="p.key"
              :href="p.href"
              class="prov"
              :class="p.key"
              :target="p.external ? '_blank' : undefined"
              :rel="p.external ? 'noopener' : undefined"
            >
              <span class="prov-ic" aria-hidden="true">
                <svg v-if="p.icon === 'logos'" viewBox="0 0 48 48" width="26" height="26"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.9 6.6-9.6 6.6-16.2z" /><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.5 46 24 46z" /><path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.8-.7-4.3s.3-3 .7-4.3V14H4.5C3 17 2 20.4 2 24s1 7 2.5 10l7.3-5.7z" /><path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14l7.3 5.7c1.7-5.2 6.5-8.9 12.2-8.9z" /></svg>
                <Icon v-else :name="p.icon" />
              </span>
              <span class="prov-t">
                <strong>{{ p.name }}</strong>
                <span>{{ p.hint }}</span>
              </span>
              <Icon :name="p.external ? 'ph:arrow-up-right' : 'ph:caret-right'" class="prov-go" aria-hidden="true" />
            </a>
          </div>

          <div class="addr">
            <span class="label">Otra app de calendario: copia la dirección</span>
            <div class="addr-row">
              <span class="addr-url" :title="link.https">{{ link.https }}</span>
              <UiButton size="sm" :variant="copied ? 'soft' : 'secondary'" :icon="copied ? 'ph:check-bold' : 'ph:copy'" @click="copy">{{ copied ? 'Copiada' : 'Copiar' }}</UiButton>
            </div>
            <p class="hint">
              <Icon name="ph:lock-simple" aria-hidden="true" />
              Es privada: quien la tenga ve lo que publiques.
              <span v-if="link.lastUsedAt" class="seen"><Icon name="ph:check-circle-fill" aria-hidden="true" /> Leída por un calendario {{ relTime(link.lastUsedAt) }}</span>
            </p>
          </div>

          <section class="pub">
            <header>
              <h3>Qué se publica</h3>
              <span v-if="savingLayers" class="spin" aria-label="Guardando" />
            </header>
            <ul class="pub-list">
              <li v-for="l in PUBLISHABLE" :key="l.key">
                <span class="pub-dot" :style="{ background: calColor(l.color) }" aria-hidden="true" />
                <UiSwitch :model-value="layerOn(l.key)" :label="l.label" :hint="l.hint" @update:model-value="v => toggleLayer(l.key, v)" />
              </li>
            </ul>
            <p class="hint">Los plazos de Hacienda llevan aviso 5 días antes y el mismo día; los vencimientos, la víspera. Google actualiza la suscripción cada pocas horas; Apple y Outlook, cada hora.</p>
          </section>

          <button type="button" class="reset" @click="reset">
            <Icon name="ph:arrows-counter-clockwise" aria-hidden="true" /> Crear una dirección nueva (anula la actual)
          </button>
        </template>
      </template>

      <!-- ─── Tu calendario en NUMIQ ─── -->
      <template v-else>
        <ul v-if="feeds.length" class="feeds">
          <li v-for="f in feeds" :key="f.id" class="feed" :class="{ off: !f.active }">
            <button type="button" class="feed-color" :style="{ background: calColor(f.color) }" title="Cambiar color" :aria-label="`Cambiar el color de ${f.name}`" @click="patchFeed(f, { color: nextColor(f.color) })" />
            <span class="feed-t">
              <strong>{{ f.name }}</strong>
              <span v-if="f.lastError" class="feed-err"><Icon name="ph:warning-circle-fill" aria-hidden="true" /> {{ f.lastError }}</span>
              <span v-else-if="f.lastSyncAt">Actualizado {{ relTime(f.lastSyncAt) }}</span>
            </span>
            <UiSwitch :model-value="f.active" :aria-label="`Mostrar ${f.name}`" @update:model-value="v => patchFeed(f, { active: v })" />
            <UiButton square size="sm" variant="ghost" icon="ph:arrows-clockwise" :loading="busyFeed === f.id" :aria-label="`Actualizar ${f.name}`" @click="syncFeed(f)" />
            <UiButton square size="sm" variant="ghost" icon="ph:trash" :aria-label="`Quitar ${f.name}`" @click="removeFeed(f)" />
          </li>
        </ul>

        <form class="add-feed" novalidate @submit.prevent="addFeed">
          <h3>{{ feeds.length ? 'Añadir otro calendario' : 'Ve tus citas de Google, iCloud u Outlook aquí' }}</h3>
          <UiInput v-model="feedForm.url" label="Dirección iCal del calendario" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" icon="ph:link" :error="feedError" inputmode="url" autocomplete="off" />
          <div class="add-row">
            <UiInput v-model="feedForm.name" label="Nombre" placeholder="Mi calendario" maxlength="80" />
            <div class="field">
              <span class="label">Color</span>
              <div class="swatches" role="radiogroup" aria-label="Color">
                <button
                  v-for="c in CALENDAR_COLORS"
                  :key="c.key"
                  type="button"
                  role="radio"
                  class="sw"
                  :class="{ on: feedForm.color === c.key }"
                  :aria-checked="feedForm.color === c.key"
                  :aria-label="c.label"
                  :style="{ '--c': calColor(c.key) }"
                  @click="feedForm.color = c.key"
                />
              </div>
            </div>
          </div>
          <div class="add-foot">
            <p class="hint"><Icon name="ph:eye" aria-hidden="true" /> Solo lo ves tú. NUMIQ lo lee, nunca lo cambia.</p>
            <UiButton type="submit" variant="primary" icon="ph:plus-bold" :loading="adding">Conectar</UiButton>
          </div>
        </form>

        <section class="howto">
          <h3>Dónde encontrar la dirección</h3>
          <div class="howto-tabs" role="tablist">
            <button v-for="s in steps" :key="s.key" type="button" role="tab" class="ht" :class="{ on: howTo === s.key }" :aria-selected="howTo === s.key" @click="howTo = s.key">
              <Icon :name="s.icon" aria-hidden="true" /> {{ s.name }}
            </button>
          </div>
          <p class="ht-text">{{ steps.find(s => s.key === howTo)?.text }}</p>
        </section>
      </template>
    </div>
  </UiModal>
</template>

<style scoped>
.cn {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.cn :deep(.seg) {
  align-self: flex-start;
  max-width: 100%;
}

.cn-sub {
  margin-top: calc(-1 * var(--s-2));
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--text-3);
}

.cn-loading {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-3);
}

.cn-warn {
  display: flex;
  gap: 10px;
  padding: var(--s-3) var(--s-4);
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--info);
  background: var(--info-soft);
  border-radius: var(--r-lg);
}

.cn-warn > :first-child {
  flex: none;
  margin-top: 2px;
}

.prov-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-3);
}

.prov {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  color: inherit;
  text-decoration: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast) var(--ease-out);
}

.prov:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.prov:active {
  transform: translateY(0) scale(0.99);
}

.prov-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  font-size: 24px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.apple .prov-ic {
  color: var(--text);
}

.outlook .prov-ic,
.office .prov-ic {
  color: #0a64c8;
}

:root[data-theme='dark'] .outlook .prov-ic,
:root[data-theme='dark'] .office .prov-ic {
  color: #4aa3ff;
}

.prov-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.prov-t strong {
  font-size: var(--text-base);
  font-weight: 650;
}

.prov-t span {
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--text-3);
}

.prov-go {
  flex: none;
  font-size: 16px;
  color: var(--text-4);
}

.addr {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.addr-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}

.addr-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--text-3);
}

.seen {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  color: var(--success);
}

.pub {
  padding: var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-xl);
}

.pub header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--s-2);
}

h3 {
  font-size: var(--text-base);
  font-weight: 650;
}

.pub-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px var(--s-5);
  margin: 0 0 var(--s-3);
  padding: 0;
  list-style: none;
}

.pub-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.pub-list li > :last-child {
  flex: 1;
  min-width: 0;
}

.pub-dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: var(--r-full);
}

.spin {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--brand);
  border-radius: var(--r-full);
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.reset {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-3);
}

.reset:hover {
  color: var(--danger);
}

/* ─── Externos ─── */

.feeds {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
}

.feed {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.feed:last-child {
  border-bottom: 0;
}

.feed.off .feed-t {
  opacity: 0.55;
}

.feed-color {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: var(--r-full);
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px var(--border-strong);
}

.feed-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.feed-t strong {
  font-size: var(--text-base);
  font-weight: 620;
  color: var(--text);
  overflow-wrap: anywhere;
}

.feed-err {
  display: inline-flex;
  gap: 4px;
  color: var(--danger);
}

.feed-err > :first-child {
  flex: none;
  margin-top: 2px;
}

.add-feed {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.add-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--s-4);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 38px;
  align-items: center;
}

.sw {
  width: 24px;
  height: 24px;
  background: var(--c);
  border-radius: var(--r-full);
  transition: transform var(--t-fast) var(--ease-spring), box-shadow var(--t-fast);
}

.sw:hover {
  transform: scale(1.1);
}

.sw.on {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--c);
}

.add-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
}

.howto {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-xl);
}

.howto-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ht {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-2);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
}

.ht.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: color-mix(in srgb, var(--brand) 30%, transparent);
}

.ht-text {
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--text-2);
}

@media (max-width: 640px) {
  .prov-grid,
  .pub-list,
  .cn-loading {
    grid-template-columns: minmax(0, 1fr);
  }

  .add-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
