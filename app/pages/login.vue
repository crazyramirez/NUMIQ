<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Entrar · NUMIQ' })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const form = reactive({ email: typeof route.query.email === 'string' ? route.query.email : '', password: '' })
const showPassword = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const back = typeof route.query.r === 'string' && route.query.r.startsWith('/') ? route.query.r : null
const target = () => back ?? '/'
const fromInvite = back?.startsWith('/invitacion') ?? false

async function submit() {
  loading.value = true
  error.value = null
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: form })
    await refreshSession()
    // Tras entrar con contraseña, Inicio ofrecerá usar la huella o Face ID la próxima vez
    try {
      sessionStorage.setItem(PASSKEY_OFFER, '1')
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

// Entrar con llave de acceso: huella, cara o PIN. También aparece sugerida en el teclado del email
const signedIn = async () => {
  await refreshSession()
  await navigateTo(target())
}
const { isSupported, signIn } = usePasskeyLogin(signedIn, (err) => {
  error.value = errorMessage(err, 'No se pudo entrar con la llave de acceso. Prueba con tu contraseña.')
})
const passkeyBusy = ref(false)
// El botón solo sale donde la huella o Face ID ya se activó (o ya se usó). En los demás dispositivos,
// una llave sincronizada (iCloud, Google) sigue apareciendo sugerida al tocar el email
const hasDeviceKey = ref(false)
onMounted(() => (hasDeviceKey.value = !!passkeyOnDevice()))
async function withPasskey() {
  passkeyBusy.value = true
  error.value = null
  try {
    await signIn()
  }
  catch (err) {
    error.value = errorMessage(err, 'No se pudo entrar con la llave de acceso. Prueba con tu contraseña.')
    // La llave de este dispositivo se quitó de la cuenta: el botón deja de salir
    if (/ya no está en tu cuenta/.test(error.value)) {
      markPasskeyOnDevice('')
      hasDeviceKey.value = false
    }
  }
  finally {
    passkeyBusy.value = false
  }
}
</script>

<template>
  <div class="rise">
    <h1 class="title">{{ fromInvite ? 'Entra en tu cuenta' : 'Bienvenido de nuevo' }}</h1>
    <p class="lead">{{ fromInvite ? 'Con tu contraseña de NUMIQ. Después aceptas la invitación.' : 'Entra para ver cómo va tu negocio hoy.' }}</p>

    <form class="form" novalidate @submit.prevent="submit">
      <UiInput v-model="form.email" label="Email" type="email" autocomplete="username webauthn" placeholder="tu@empresa.es" icon="ph:envelope-simple" required />
      <UiInput v-model="form.password" label="Contraseña" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" icon="ph:lock-simple" required>
        <template #end>
          <button type="button" class="eye" :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'" @click="showPassword = !showPassword">
            <Icon :name="showPassword ? 'ph:eye-slash' : 'ph:eye'" />
          </button>
        </template>
      </UiInput>

      <NuxtLink :to="{ path: '/recuperar', query: { ...(form.email ? { email: form.email } : {}), ...(back ? { r: back } : {}) } }" class="link forgot">¿Olvidaste tu contraseña?</NuxtLink>

      <Transition name="fade">
        <p v-if="error" class="alert" role="alert"><Icon name="ph:warning-circle-fill" /> {{ error }}</p>
      </Transition>

      <UiButton type="submit" variant="primary" size="lg" block :loading="loading">Entrar</UiButton>
      <template v-if="isSupported && hasDeviceKey">
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
