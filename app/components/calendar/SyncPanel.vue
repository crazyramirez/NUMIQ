<script setup lang="ts">
import type { CalendarLayer } from '#shared/utils/calendar'

/**
 * Sincronizar al momento: NUMIQ escribe en tu Google Calendar o en iCloud (u otro CalDAV) un
 * calendario propio «NUMIQ» con tus eventos y tareas y, si quieres, los plazos de Hacienda y más.
 */
export interface SyncAccount {
  id: number
  provider: 'google' | 'caldav'
  label: string
  server: string | null
  layers: CalendarLayer[]
  active: boolean
  lastSyncAt: string | null
  lastError: string | null
  syncedCount: number
}
interface SyncResult { ok: boolean, created: number, updated: number, deleted: number, total: number, error?: string }

const emit = defineEmits<{ changed: [] }>()
const toast = useToast()
const { confirm } = useConfirm()

const data = ref<{ accounts: SyncAccount[], google: boolean } | null>(null)
const loading = ref(true)
async function load() {
  try {
    const url: string = '/api/calendar/accounts'
    data.value = await $fetch<{ accounts: SyncAccount[], google: boolean }>(url)
  }
  catch (err) {
    toast.error('No se pudieron cargar los calendarios', errorMessage(err))
  }
  finally {
    loading.value = false
  }
}
onMounted(load)
defineExpose({ load })

const accounts = computed(() => data.value?.accounts ?? [])
const has = (p: 'google' | 'caldav') => accounts.value.some(a => a.provider === p)
// Mientras la primera carga de Google sigue en segundo plano, se refresca sola
let poll: ReturnType<typeof setInterval> | undefined
watch(accounts, (list) => {
  clearInterval(poll)
  if (list.some(a => a.active && !a.lastSyncAt)) poll = setInterval(load, 2500)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(poll))

// ─── Añadir ───

const form = ref<null | 'icloud' | 'caldav'>(null)
const cred = ref({ server: '', username: '', password: '' })
const formError = ref<{ field?: string, message: string } | null>(null)
const connecting = ref(false)

function openForm(kind: 'icloud' | 'caldav') {
  form.value = kind
  cred.value = { server: '', username: '', password: '' }
  formError.value = null
}

function connectGoogle() {
  // Pantalla de permiso de Google y vuelta a /calendario
  window.location.href = '/api/calendar/google/connect'
}

const summary = (r: SyncResult) => (r.total ? `${r.total} ${r.total === 1 ? 'evento' : 'eventos'} en tu calendario` : 'Listo para lo que añadas')

async function connectCaldav() {
  formError.value = null
  const c = cred.value
  if (form.value === 'caldav' && !c.server.trim()) return (formError.value = { field: 'server', message: 'Escribe la dirección del servidor' })
  if (!c.username.trim()) return (formError.value = { field: 'username', message: form.value === 'icloud' ? 'Escribe tu Apple ID' : 'Escribe tu usuario' })
  if (!c.password) return (formError.value = { field: 'password', message: 'Escribe la contraseña de aplicación' })
  connecting.value = true
  try {
    const r = await $fetch<{ account: SyncAccount, result: SyncResult }>('/api/calendar/accounts/caldav', {
      method: 'POST',
      body: { preset: form.value, server: c.server.trim() || null, username: c.username.trim(), password: c.password },
    })
    toast.success(form.value === 'icloud' ? 'iCloud conectado' : 'Calendario conectado', r.result.ok ? summary(r.result) : r.result.error)
    form.value = null
    await load()
    emit('changed')
  }
  catch (err) {
    formError.value = { field: errorField(err), message: errorMessage(err) }
  }
  finally {
    connecting.value = false
  }
}

// ─── Cuentas conectadas ───

const busy = ref<number | null>(null)
function replace(a: SyncAccount) {
  if (data.value) data.value = { ...data.value, accounts: data.value.accounts.map(x => (x.id === a.id ? a : x)) }
}

async function syncNow(a: SyncAccount) {
  busy.value = a.id
  try {
    const r = await $fetch<{ account: SyncAccount, result: SyncResult }>(`/api/calendar/accounts/${a.id}/sync`, { method: 'POST' })
    replace(r.account)
    if (r.result.ok) toast.success('Al día', summary(r.result))
    else toast.error('No se pudo sincronizar', r.result.error)
  }
  catch (err) {
    toast.error('No se pudo sincronizar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function toggleLayer(a: SyncAccount, k: CalendarLayer, on: boolean) {
  const layers = on ? [...a.layers, k] : a.layers.filter(x => x !== k)
  replace({ ...a, layers })
  busy.value = a.id
  try {
    const r = await $fetch<{ account: SyncAccount, result: SyncResult | null }>(`/api/calendar/accounts/${a.id}`, { method: 'PATCH', body: { layers } })
    replace(r.account)
    if (r.result && !r.result.ok) toast.error('No se pudo sincronizar', r.result.error)
  }
  catch (err) {
    replace(a)
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function disconnect(a: SyncAccount) {
  const where = a.provider === 'google' ? 'Google Calendar' : 'tu calendario'
  const ok = await confirm({
    title: `¿Desconectar ${a.provider === 'google' ? 'Google Calendar' : a.label}?`,
    body: `Se quita de ${where} el calendario «NUMIQ» con todo lo que puso NUMIQ. Tus otros calendarios no se tocan.`,
    confirmLabel: 'Desconectar',
    danger: true,
  })
  if (!ok) return
  busy.value = a.id
  try {
    await $fetch(`/api/calendar/accounts/${a.id}`, { method: 'DELETE' })
    toast.success('Desconectado')
    await load()
    emit('changed')
  }
  catch (err) {
    toast.error('No se pudo desconectar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

// Google sin claves: cómo activarlo, con la dirección de vuelta de este servidor ya puesta
const googleHelp = ref(false)
const redirectUri = computed(() => (import.meta.client ? `${window.location.origin}/api/calendar/google/callback` : ''))
const uriCopied = ref(false)
async function copyUri() {
  if (await copyToClipboard(redirectUri.value)) {
    uriCopied.value = true
    setTimeout(() => (uriCopied.value = false), 1800)
  }
}

const expanded = ref<number | null>(null)
const SYNCABLE = CALENDAR_LAYERS
const providerName = (a: SyncAccount) => (a.provider === 'google' ? 'Google Calendar' : /icloud/i.test(a.label) ? 'iCloud' : 'CalDAV')
const statusOf = (a: SyncAccount) => {
  if (!a.active) return { tone: 'off', text: 'En pausa' }
  if (a.lastError) return { tone: 'err', text: a.lastError }
  if (!a.lastSyncAt) return { tone: 'run', text: 'Sincronizando por primera vez…' }
  return { tone: 'ok', text: `Al día · ${a.syncedCount} ${a.syncedCount === 1 ? 'evento' : 'eventos'} · ${relTime(a.lastSyncAt)}` }
}
const needsReconnect = (a: SyncAccount) => !!a.lastError && /permiso|contraseña|vuelve a conectar|configurado/i.test(a.lastError)
</script>

<template>
  <div class="sp">
    <p class="sp-intro">
      <Icon name="ph:lightning-fill" class="sp-bolt" aria-hidden="true" />
      <span>Lo que añades o cambias en NUMIQ aparece <strong>al momento</strong> en tu calendario, dentro de un calendario propio «NUMIQ» que puedes ocultar o colorear allí. NUMIQ solo toca lo suyo.</span>
    </p>

    <div v-if="loading" class="sp-sk">
      <div v-for="i in 2" :key="i" class="skeleton" style="height: 72px; border-radius: 16px" />
    </div>

    <template v-else>
      <!-- Conectados -->
      <ul v-if="accounts.length" class="accs">
        <li v-for="a in accounts" :key="a.id" class="acc" :class="statusOf(a).tone">
          <div class="acc-main">
            <span class="acc-ic" aria-hidden="true">
              <svg v-if="a.provider === 'google'" viewBox="0 0 48 48" width="24" height="24"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.9 6.6-9.6 6.6-16.2z" /><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.5 46 24 46z" /><path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.8-.7-4.3s.3-3 .7-4.3V14H4.5C3 17 2 20.4 2 24s1 7 2.5 10l7.3-5.7z" /><path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14l7.3 5.7c1.7-5.2 6.5-8.9 12.2-8.9z" /></svg>
              <Icon v-else :name="/icloud/i.test(a.label) ? 'ph:apple-logo' : 'ph:calendar-check'" />
            </span>
            <span class="acc-t">
              <strong>{{ providerName(a) }}</strong>
              <span class="acc-label">{{ providerName(a) === 'CalDAV' ? a.label : a.label.replace(/^[^·]+·\s*/, '') }}</span>
              <span class="acc-st" :class="statusOf(a).tone">
                <span v-if="statusOf(a).tone === 'run'" class="spin" aria-hidden="true" />
                <Icon v-else :name="statusOf(a).tone === 'ok' ? 'ph:check-circle-fill' : statusOf(a).tone === 'err' ? 'ph:warning-circle-fill' : 'ph:pause-circle-fill'" aria-hidden="true" />
                {{ statusOf(a).text }}
              </span>
            </span>
            <div class="acc-actions">
              <UiButton v-if="needsReconnect(a) && a.provider === 'google'" size="sm" variant="primary" icon="ph:arrows-clockwise" @click="connectGoogle">Reconectar</UiButton>
              <UiButton v-else-if="needsReconnect(a)" size="sm" variant="primary" icon="ph:key" @click="openForm(/icloud/i.test(a.label) ? 'icloud' : 'caldav')">Revisar</UiButton>
              <UiButton v-else square size="sm" variant="ghost" icon="ph:arrows-clockwise" :loading="busy === a.id" :aria-label="`Sincronizar ${providerName(a)} ahora`" title="Sincronizar ahora" @click="syncNow(a)" />
              <UiButton square size="sm" variant="ghost" :icon="expanded === a.id ? 'ph:caret-up' : 'ph:sliders-horizontal'" :aria-expanded="expanded === a.id" aria-label="Qué se escribe" title="Qué se escribe" @click="expanded = expanded === a.id ? null : a.id" />
              <UiButton square size="sm" variant="ghost" icon="ph:plugs" :aria-label="`Desconectar ${providerName(a)}`" title="Desconectar" @click="disconnect(a)" />
            </div>
          </div>
          <div v-if="expanded === a.id" class="acc-layers">
            <p class="eyebrow">Qué se escribe en {{ providerName(a) }}</p>
            <ul>
              <li v-for="l in SYNCABLE" :key="l.key">
                <span class="dot" :style="{ background: calColor(l.color) }" aria-hidden="true" />
                <UiSwitch :model-value="a.layers.includes(l.key)" :label="l.label" :hint="l.hint" :disabled="busy === a.id" @update:model-value="v => toggleLayer(a, l.key, v)" />
              </li>
            </ul>
          </div>
        </li>
      </ul>

      <!-- Añadir -->
      <div v-if="!form" class="opts">
        <button v-if="!has('google')" type="button" class="opt" :aria-expanded="data?.google ? undefined : googleHelp" @click="data?.google ? connectGoogle() : (googleHelp = !googleHelp)">
          <span class="opt-ic" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="26" height="26"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.9 6.6-9.6 6.6-16.2z" /><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.5 46 24 46z" /><path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.8-.7-4.3s.3-3 .7-4.3V14H4.5C3 17 2 20.4 2 24s1 7 2.5 10l7.3-5.7z" /><path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14l7.3 5.7c1.7-5.2 6.5-8.9 12.2-8.9z" /></svg>
          </span>
          <span class="opt-t">
            <strong>Google Calendar</strong>
            <span v-if="data?.google">Inicia sesión con Google y listo. Android, web y cualquier dispositivo.</span>
            <span v-else>Falta activarlo una vez con unas claves de Google (10 minutos). Toca para ver cómo.</span>
          </span>
          <Icon :name="data?.google ? 'ph:arrow-up-right' : googleHelp ? 'ph:caret-up' : 'ph:caret-down'" class="opt-go" aria-hidden="true" />
        </button>
        <div v-if="!data?.google && googleHelp" class="ghelp">
          <p>Google solo deja escribir en un calendario a las apps que tienen sus propias claves. Se crean gratis con tu cuenta de Google, una sola vez:</p>
          <ol>
            <li>Entra en <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener" class="link">console.cloud.google.com</a> y crea un proyecto llamado «NUMIQ».</li>
            <li>En <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener" class="link">Google Calendar API</a> pulsa <strong>Habilitar</strong>.</li>
            <li>En <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener" class="link">Google Auth Platform</a> pulsa <strong>Comenzar</strong>: nombre «NUMIQ», tu correo, público <strong>Externo</strong>. En <strong>Público → Usuarios de prueba</strong> añade los correos de Google que vayan a conectarse.</li>
            <li>En <strong>Clientes → Crear cliente</strong>: tipo <strong>Aplicación web</strong> y, en «URI de redireccionamiento autorizados», pega esta dirección:
              <span class="ghelp-uri">
                <code>{{ redirectUri }}</code>
                <UiButton size="sm" :icon="uriCopied ? 'ph:check-bold' : 'ph:copy'" @click="copyUri">{{ uriCopied ? 'Copiada' : 'Copiar' }}</UiButton>
              </span>
            </li>
            <li>Copia el <strong>ID de cliente</strong> y el <strong>secreto</strong> en el archivo <code>.env</code> del servidor y reinícialo:
              <code class="ghelp-env">NUXT_GOOGLE_CLIENT_ID=…<br>NUXT_GOOGLE_CLIENT_SECRET=…</code>
            </li>
          </ol>
          <p class="ghelp-note"><Icon name="ph:info" aria-hidden="true" /><span>Si usas NUMIQ en tu dominio y en local, añade en el paso 4 las dos direcciones (<code>https://tu-dominio/api/calendar/google/callback</code> y la de local). Mientras tanto, iCloud funciona ya y la pestaña «Suscripción» sirve para Google.</span></p>
        </div>
        <button v-if="!has('caldav')" type="button" class="opt" @click="openForm('icloud')">
          <span class="opt-ic apple" aria-hidden="true"><Icon name="ph:apple-logo" /></span>
          <span class="opt-t">
            <strong>iCloud · Apple Calendar</strong>
            <span>iPhone, iPad y Mac, con tu Apple ID y una contraseña de aplicación.</span>
          </span>
          <Icon name="ph:caret-right" class="opt-go" aria-hidden="true" />
        </button>
        <button v-if="!has('caldav')" type="button" class="opt" @click="openForm('caldav')">
          <span class="opt-ic" aria-hidden="true"><Icon name="ph:calendar-check" /></span>
          <span class="opt-t">
            <strong>Otro calendario (CalDAV)</strong>
            <span>Nextcloud, Fastmail, Synology, Zoho, mailbox.org…</span>
          </span>
          <Icon name="ph:caret-right" class="opt-go" aria-hidden="true" />
        </button>
        <p class="opts-note">
          <Icon name="ph:info" aria-hidden="true" />
          ¿Outlook o Microsoft 365? Usa la pestaña «Suscripción»: Outlook la actualiza sola cada hora.
        </p>
      </div>

      <form v-else class="cform" novalidate @submit.prevent="connectCaldav">
        <header class="cform-h">
          <button type="button" class="back" aria-label="Volver" @click="form = null"><Icon name="ph:arrow-left" aria-hidden="true" /></button>
          <h3>{{ form === 'icloud' ? 'Conectar iCloud' : 'Conectar un calendario CalDAV' }}</h3>
        </header>
        <ol v-if="form === 'icloud'" class="steps">
          <li>Entra en <a href="https://account.apple.com/account/manage" target="_blank" rel="noopener" class="link">account.apple.com</a> → <strong>Inicio de sesión y seguridad</strong> → <strong>Contraseñas específicas de apps</strong>.</li>
          <li>Crea una llamada «NUMIQ» y cópiala (tiene la forma <span class="mono">abcd-efgh-ijkl-mnop</span>).</li>
          <li>Pégala aquí con tu Apple ID. NUMIQ la guarda cifrada y nunca ve tu contraseña de Apple.</li>
        </ol>
        <UiInput v-if="form === 'caldav'" v-model="cred.server" label="Dirección del servidor" placeholder="https://cloud.ejemplo.com/remote.php/dav" icon="ph:globe" inputmode="url" autocomplete="off" :error="formError?.field === 'server' ? formError.message : null" hint="Nextcloud: …/remote.php/dav · Fastmail: https://caldav.fastmail.com" />
        <UiInput v-model="cred.username" :label="form === 'icloud' ? 'Apple ID' : 'Usuario'" :placeholder="form === 'icloud' ? 'tu@icloud.com' : 'usuario'" autocomplete="username" :error="formError?.field === 'username' ? formError.message : null" />
        <UiInput v-model="cred.password" type="password" :label="form === 'icloud' ? 'Contraseña específica de app' : 'Contraseña (mejor una de aplicación)'" :placeholder="form === 'icloud' ? 'abcd-efgh-ijkl-mnop' : ''" autocomplete="new-password" :error="formError?.field === 'password' ? formError.message : null" />
        <p v-if="formError && !['server', 'username', 'password'].includes(formError.field ?? '')" class="cform-err" role="alert">
          <Icon name="ph:warning-circle-fill" aria-hidden="true" /> {{ formError.message }}
        </p>
        <div class="cform-foot">
          <UiButton @click="form = null">Cancelar</UiButton>
          <UiButton type="submit" variant="primary" icon="ph:lightning" :loading="connecting">{{ connecting ? 'Conectando…' : 'Conectar y sincronizar' }}</UiButton>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.sp {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.sp-intro {
  display: flex;
  gap: 10px;
  padding: var(--s-3) var(--s-4);
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--text-2);
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 8%, var(--surface)), var(--surface) 70%);
  border: 1px solid color-mix(in srgb, var(--brand) 20%, var(--border));
  border-radius: var(--r-lg);
}

.sp-bolt {
  flex: none;
  margin-top: 3px;
  color: var(--brand-text);
}

.sp-sk {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.accs {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.acc {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.acc.ok {
  border-color: color-mix(in srgb, var(--success-solid) 28%, var(--border));
}

.acc.err {
  border-color: color-mix(in srgb, var(--danger-solid) 30%, var(--border));
}

.acc-main {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 12px 14px;
}

.acc-ic,
.opt-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  font-size: 23px;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.opt-ic.apple {
  color: var(--text);
}

.acc-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.acc-t strong {
  font-size: var(--text-base);
  font-weight: 650;
}

.acc-label {
  font-size: var(--text-xs);
  color: var(--text-3);
  overflow-wrap: anywhere;
}

.acc-st {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin-top: 3px;
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.4;
}

.acc-st > :first-child {
  flex: none;
  margin-top: 2px;
}

.acc-st.ok {
  color: var(--success);
}

.acc-st.err {
  color: var(--danger);
}

.acc-st.run {
  color: var(--brand-text);
}

.acc-st.off {
  color: var(--text-3);
}

.spin {
  width: 11px;
  height: 11px;
  border: 2px solid color-mix(in srgb, var(--brand) 25%, transparent);
  border-top-color: var(--brand);
  border-radius: var(--r-full);
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.acc-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}

.acc-layers {
  padding: var(--s-3) var(--s-4) var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.acc-layers ul {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--s-5);
  margin: var(--s-2) 0 0;
  padding: 0;
  list-style: none;
}

.acc-layers li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.acc-layers li > :last-child {
  flex: 1;
  min-width: 0;
}

.dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: var(--r-full);
}

.opts {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.opt {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px;
  color: inherit;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast) var(--ease-out);
}

.opt:not(:disabled):hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.opt:disabled {
  cursor: default;
  opacity: 0.6;
}

.opt-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.opt-t strong {
  font-size: var(--text-base);
  font-weight: 650;
}

.opt-t span {
  font-size: var(--text-xs);
  line-height: 1.45;
  color: var(--text-3);
}

.opt-go {
  flex: none;
  color: var(--text-4);
}

.ghelp {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  margin-top: calc(-1 * var(--s-2));
  padding: var(--s-4);
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-xl);
}

.ghelp ol {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding-left: var(--s-5);
}

.ghelp code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  overflow-wrap: anywhere;
}

.ghelp-uri {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 6px 6px 6px 10px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}

.ghelp-uri code {
  flex: 1;
  min-width: 0;
}

.ghelp-env {
  display: block;
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}

.ghelp-note {
  display: flex;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ghelp-note > :first-child {
  flex: none;
  margin-top: 3px;
}

.opts-note {
  display: flex;
  gap: 6px;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--text-3);
}

.opts-note > :first-child {
  flex: none;
  margin-top: 2px;
}

.cform {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.cform-h {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cform-h h3 {
  font-size: var(--text-md);
  font-weight: 650;
}

.back {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--text-2);
  border-radius: var(--r-md);
}

.back:hover {
  background: var(--surface-hover);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: var(--s-3) var(--s-4) var(--s-3) var(--s-7);
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.mono {
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.cform-err {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: var(--r-md);
}

.cform-err > :first-child {
  flex: none;
  margin-top: 3px;
}

.cform-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--s-2);
}

@media (max-width: 640px) {
  .acc-layers ul {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
