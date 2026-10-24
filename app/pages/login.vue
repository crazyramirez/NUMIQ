<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Entrar · NUMIQ' })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const form = reactive({ email: typeof route.query.email === 'string' ? route.query.email : '', password: '' })
const showPassword = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const target = () => (typeof route.query.r === 'string' && route.query.r.startsWith('/') ? route.query.r : '/')

async function submit() {
  loading.value = true
  error.value = null
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: form })
    await refreshSession()
    // Tras entrar con contraseña, Inicio ofrecerá usar la huella o Face ID la próxima vez
    try {
      sessionStorage.setItem('numiq-passkey-offer', '1')
    }
    catch { /* sin almacenamiento: no pasa nada */ }
    await navigateTo(target())
  }
  catch (err) {
    error.value = errorMessage(err)
  }
  finally {
    loading.value = false
  }
}

// Entrar con llave de acceso: huella, cara o PIN (con el email escrito, el navegador va directo a sus llaves)
const { authenticate, isSupported } = useWebAuthn({ registerEndpoint: '/api/passkeys/register', authenticateEndpoint: '/api/passkeys/authenticate' })
const passkeyBusy = ref(false)
async function withPasskey() {
  passkeyBusy.value = true
  error.value = null
  try {
    await authenticate(form.email.trim() || undefined)
    await refreshSession()
    await navigateTo(target())
  }
  catch (err) {
    const name = (err as { name?: string }).name
    if (name !== 'NotAllowedError' && name !== 'AbortError') error.value = errorMessage(err, 'No se pudo entrar con la llave de acceso. Prueba con tu contraseña.')
  }
  finally {
    passkeyBusy.value = false
  }
}
</script>

<template>
  <div class="rise">
    <h1 class="title">Bienvenido de nuevo</h1>
    <p class="lead">Entra para ver cómo va tu negocio hoy.</p>

    <form class="form" novalidate @submit.prevent="submit">
      <UiInput v-model="form.email" label="Email" type="email" autocomplete="email" placeholder="tu@empresa.es" icon="ph:envelope-simple" required />
      <UiInput v-model="form.password" label="Contraseña" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" icon="ph:lock-simple" required>
        <template #end>
          <button type="button" class="eye" :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'" @click="showPassword = !showPassword">
            <Icon :name="showPassword ? 'ph:eye-slash' : 'ph:eye'" />
          </button>
        </template>
      </UiInput>

      <NuxtLink :to="{ path: '/recuperar', query: form.email ? { email: form.email } : undefined }" class="link forgot">¿Olvidaste tu contraseña?</NuxtLink>

      <Transition name="fade">
        <p v-if="error" class="alert" role="alert"><Icon name="ph:warning-circle-fill" /> {{ error }}</p>
      </Transition>

      <UiButton type="submit" variant="primary" size="lg" block :loading="loading">Entrar</UiButton>
      <template v-if="isSupported">
        <div class="or" aria-hidden="true"><span>o</span></div>
        <UiButton size="lg" block icon="ph:fingerprint" :loading="passkeyBusy" @click="withPasskey">Entrar con huella o Face ID</UiButton>
      </template>
    </form>

    <p class="switch">¿Aún no tienes cuenta? <NuxtLink :to="{ path: '/registro', query: route.query.r ? { r: route.query.r } : undefined }" class="link">Crea una gratis</NuxtLink></p>
  </div>
</template>

<style scoped>
.title {
  font-size: var(--text-3xl);
  letter-spacing: -0.03em;
}

.lead {
  margin-top: var(--s-2);
  color: var(--text-3);
  font-size: var(--text-md);
}

.form {
  display: grid;
  gap: var(--s-4);
  margin-top: var(--s-7);
}

.eye {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: -6px;
  color: var(--text-3);
  border-radius: var(--r-sm);
}

.eye:hover {
  color: var(--text);
}

.alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: var(--r-md);
}

.forgot {
  justify-self: end;
  margin-top: -6px;
  font-size: var(--text-sm);
}

.or {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  font-size: var(--text-xs);
  color: var(--text-4);
}

.or::before,
.or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.switch {
  margin-top: var(--s-6);
  text-align: center;
  color: var(--text-3);
}
</style>
