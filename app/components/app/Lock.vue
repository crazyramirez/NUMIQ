<script setup lang="ts">
/**
 * Pantalla de bloqueo de NUMIQ (useAppLock): huella, Face ID o el PIN del dispositivo, o la contraseña si
 * no van. Tres formas: bloqueada (tapa toda la app), tapa sin nada (fuera de la app con «Siempre», para
 * la vista del multitarea) y confirmación de identidad antes de un cambio que baja la protección.
 */
const appLock = useAppLock()
const s = appLock.state
const { user } = useUserSession()

const visible = computed(() => s.value.locked || s.value.covered || s.value.confirm)
const confirming = computed(() => s.value.confirm && !s.value.locked)
const cover = computed(() => s.value.covered && !s.value.locked && !s.value.confirm)
const firstName = computed(() => user.value?.name?.split(/\s+/)[0] ?? '')

/** Cómo se llama lo que pide el sistema en este dispositivo */
const method = ref({ label: 'tu huella o PIN', icon: 'ph:fingerprint' })
onMounted(() => {
  const ua = navigator.userAgent
  const iosLike = /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  if (iosLike) method.value = { label: 'Face ID', icon: 'ph:scan-smiley' }
  else if (/Macintosh/.test(ua)) method.value = { label: 'Touch ID', icon: 'ph:fingerprint' }
  else if (/Android/.test(ua)) method.value = { label: 'tu huella', icon: 'ph:fingerprint' }
  else if (/Windows/.test(ua)) method.value = { label: 'Windows Hello', icon: 'ph:fingerprint' }
})
// Sin llave aquí (ordenador sin huella confirmando un cambio): la del móvil con el QR, o la contraseña
const methodLabel = computed(() => (s.value.bound ? method.value.label : 'tu llave de acceso'))

const busy = ref<'passkey' | 'password' | null>(null)
const error = ref<string | null>(null)
const showPassword = ref(false)
const password = ref('')
const pwError = ref<string | null>(null)

/** El intento automático no ocupa el botón: si el sistema no lo abre (sin toque), el botón lo sustituye */
async function passkey(auto = false) {
  if (busy.value && !auto) return
  if (!auto) busy.value = 'passkey'
  error.value = null
  try {
    // Cancelada (o, sin toque, el sistema no la abrió): queda el botón
    await appLock.withPasskey()
  }
  catch (err) {
    if (!auto) error.value = errorMessage(err, 'No se pudo comprobar. Prueba otra vez o usa tu contraseña.')
  }
  finally {
    if (!auto) busy.value = null
  }
}

async function withPassword() {
  if (!password.value || busy.value) return
  busy.value = 'password'
  pwError.value = null
  try {
    await appLock.withPassword(password.value)
    password.value = ''
    showPassword.value = false
  }
  catch (err) {
    pwError.value = errorMessage(err)
  }
  finally {
    busy.value = null
  }
}

async function logout() {
  const email = user.value?.email ?? ''
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
  // Carga completa: lo que esperaba al desbloqueo se descarta con la página
  window.location.assign(`/login${email ? `?email=${encodeURIComponent(email)}` : ''}`)
}

// Pidiendo la huella: el resto de la página no se puede tocar ni recorrer con el teclado. Al abrirse,
// el foco vuelve donde estaba (el campo que se estaba escribiendo). La tapa no lo hace: con la app
// fuera de la vista no se puede tocar nada, y así el foco no se pierde al cambiar de pestaña
const root = ref<HTMLElement | null>(null)
let inerted: Element[] = []
let lastFocus: HTMLElement | null = null
function setInert(on: boolean) {
  inerted.forEach(el => el.removeAttribute('inert'))
  inerted = []
  if (!on) {
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true })
    lastFocus = null
    return
  }
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) lastFocus = document.activeElement
  for (const el of Array.from(document.body.children)) {
    if (el === root.value || el.hasAttribute('inert') || el.tagName === 'SCRIPT') continue
    el.setAttribute('inert', '')
    inerted.push(el)
  }
}

let refreshTimer: ReturnType<typeof setInterval> | null = null
let pendingAuto = false
// Al aparecer: el reto ya pedido (Face ID se abre dentro del toque) y, si el sistema lo deja sin toque, se abre solo
watch(() => (s.value.locked || s.value.confirm) && !!user.value, async (asking) => {
  error.value = null
  pwError.value = null
  password.value = ''
  showPassword.value = false
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  if (!asking) return
  await appLock.prepare()
  refreshTimer = setInterval(() => void appLock.prepare(), 4 * 60_000)
  if (!s.value.hasKeys) return
  if (document.visibilityState === 'visible' && document.hasFocus()) void passkey(true)
  // Windows Hello y Chrome no se abren sin el foco: al volver a la ventana
  else pendingAuto = true
}, { immediate: true })

function onFocus() {
  if (!pendingAuto || !(s.value.locked || s.value.confirm)) return
  pendingAuto = false
  void passkey(true)
}

watch(() => s.value.locked || s.value.confirm, async (v) => {
  await nextTick()
  setInert(v)
}, { immediate: true })

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && confirming.value) appLock.cancelConfirm()
}

onMounted(() => {
  window.addEventListener('focus', onFocus)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('keydown', onKey)
  if (refreshTimer) clearInterval(refreshTimer)
  setInert(false)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="lk">
      <div
        v-if="visible"
        ref="root"
        class="lk"
        :class="{ confirm: confirming, cover }"
        :role="cover ? undefined : 'dialog'"
        :aria-modal="cover ? undefined : 'true'"
        :aria-labelledby="cover ? undefined : 'lk-title'"
        @click.self="confirming && appLock.cancelConfirm()"
      >
        <div v-if="cover" class="lk-cover"><AppLogo :size="34" /></div>

        <div v-else class="lk-card">
          <AppLogo v-if="!confirming" class="lk-logo" :size="26" />
          <div class="lk-who">
            <UiAvatar :name="user?.name ?? ''" :src="user?.avatarUrl" :size="confirming ? 52 : 68" />
            <span class="lk-badge" aria-hidden="true"><Icon :name="confirming ? 'ph:shield-check-fill' : 'ph:lock-simple-fill'" /></span>
          </div>
          <h1 id="lk-title" class="lk-title">{{ confirming ? 'Confirma que eres tú' : 'NUMIQ está bloqueada' }}</h1>
          <p class="lk-sub">
            <template v-if="confirming">Este cambio afecta a la seguridad de tu cuenta.</template>
            <template v-else>{{ firstName ? `Hola, ${firstName}. ` : '' }}Desbloquéala para seguir donde lo dejaste.</template>
          </p>

          <div class="lk-acts">
            <UiButton v-if="s.hasKeys" variant="primary" size="lg" block :icon="s.bound ? method.icon : 'ph:key'" :loading="busy === 'passkey'" @click="passkey()">
              {{ confirming ? 'Confirmar' : 'Desbloquear' }} con {{ methodLabel }}
            </UiButton>
            <Transition name="fade">
              <p v-if="error" class="lk-error" role="alert"><Icon name="ph:warning-circle-fill" /> {{ error }}</p>
            </Transition>

            <form v-if="showPassword || !s.hasKeys" class="lk-pw" novalidate @submit.prevent="withPassword">
              <input class="sr-only" type="email" autocomplete="username" :value="user?.email" readonly tabindex="-1" aria-hidden="true">
              <UiInput v-model="password" label="Contraseña" type="password" autocomplete="current-password" icon="ph:lock-simple" :error="pwError" />
              <UiButton type="submit" :variant="s.hasKeys ? 'secondary' : 'primary'" size="lg" block :loading="busy === 'password'" :disabled="!password">
                {{ confirming ? 'Confirmar' : 'Desbloquear' }} con la contraseña
              </UiButton>
            </form>
            <button v-else type="button" class="link lk-alt" @click="showPassword = true">Usar mi contraseña</button>
          </div>

          <footer class="lk-foot">
            <button v-if="confirming" type="button" class="link lk-alt" @click="appLock.cancelConfirm()">Cancelar</button>
            <template v-else>
              <span class="truncate">{{ user?.email }}</span>
              <button type="button" class="link lk-alt" @click="logout">Cerrar sesión</button>
            </template>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lk {
  position: fixed;
  inset: 0;
  /* Por encima de todo: avisos, menús, el visor de documentos */
  z-index: 1000;
  display: grid;
  place-items: center;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: max(var(--s-6), env(safe-area-inset-top)) var(--s-4) max(var(--s-6), env(safe-area-inset-bottom));
  background: var(--bg-grad), var(--bg);
}

.lk.confirm {
  background: var(--overlay);
  backdrop-filter: blur(6px);
}

.lk-cover {
  display: grid;
  place-items: center;
  opacity: 0.9;
}

.lk-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(380px, 100%);
  text-align: center;
}

.confirm .lk-card {
  padding: var(--s-7) var(--s-6) var(--s-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-xl);
}

.lk-logo {
  margin-bottom: var(--s-8);
}

.lk-who {
  position: relative;
  padding: 5px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--border), var(--shadow-lg);
}

.lk-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  font-size: 14px;
  color: #fff;
  background: var(--ai-grad);
  border: 2px solid var(--surface);
  border-radius: 50%;
}

.lk-title {
  margin-top: var(--s-5);
  font-size: var(--text-2xl);
  letter-spacing: -0.025em;
}

.lk-sub {
  margin-top: var(--s-2);
  font-size: var(--text-md);
  color: var(--text-3);
}

.lk-acts {
  display: grid;
  gap: var(--s-3);
  width: 100%;
  margin-top: var(--s-7);
}

.lk-pw {
  display: grid;
  gap: var(--s-3);
  text-align: left;
}

.lk-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--danger);
  text-align: left;
  background: var(--danger-soft);
  border-radius: var(--r-md);
}

.lk-alt {
  justify-self: center;
  font-size: var(--text-sm);
}

.lk-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-3);
  max-width: 100%;
  margin-top: var(--s-7);
  font-size: var(--text-sm);
  color: var(--text-3);
}

.confirm .lk-foot {
  margin-top: var(--s-4);
}

.lk-enter-active {
  transition: opacity var(--t-fast) var(--ease-out);
}

.lk-leave-active {
  transition: opacity var(--t-base) var(--ease-out);
}

.lk-enter-from,
.lk-leave-to {
  opacity: 0;
}

.lk-enter-active .lk-card,
.lk-leave-active .lk-card {
  transition: transform var(--t-slow) var(--ease-out);
}

.lk-enter-from .lk-card {
  transform: translateY(10px) scale(0.98);
}

.lk-leave-to .lk-card {
  transform: scale(1.02);
}
</style>
