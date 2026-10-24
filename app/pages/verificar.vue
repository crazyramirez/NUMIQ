<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Confirmar email · NUMIQ' })

const route = useRoute()
const { loggedIn } = useUserSession()
const { me, refresh } = useMe()
const state = ref<'loading' | 'ok' | 'error'>('loading')
const error = ref('')

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  try {
    if (!token) throw new Error('Falta el enlace')
    await $fetch('/api/auth/verify', { method: 'POST', body: { token } })
    state.value = 'ok'
    if (loggedIn.value && me.value) await refresh().catch(() => {})
  }
  catch (err) {
    error.value = errorMessage(err, 'El enlace no es válido o ha caducado')
    state.value = 'error'
  }
})
</script>

<template>
  <div class="rise verify">
    <span class="ic" :class="state" aria-hidden="true">
      <span v-if="state === 'loading'" class="spinner" />
      <Icon v-else :name="state === 'ok' ? 'ph:seal-check-fill' : 'ph:link-break'" />
    </span>
    <h1 class="title">{{ state === 'loading' ? 'Confirmando…' : state === 'ok' ? 'Email confirmado' : 'No se pudo confirmar' }}</h1>
    <p class="lead">{{ state === 'ok' ? 'Gracias. Tu cuenta queda protegida: podrás recuperarla si olvidas la contraseña.' : state === 'error' ? error : '' }}</p>
    <UiButton v-if="state !== 'loading'" class="go" variant="primary" size="lg" block :to="loggedIn ? '/' : '/login'">{{ loggedIn ? 'Ir a NUMIQ' : 'Entrar' }}</UiButton>
    <p v-if="state === 'error' && loggedIn" class="hint">Puedes pedir otro enlace desde Ajustes → Tu cuenta.</p>
  </div>
</template>

<style scoped>
.verify {
  text-align: center;
}

.ic {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin: 0 auto var(--s-5);
  font-size: 32px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.ic.ok {
  color: var(--success);
  background: var(--success-soft);
}

.ic.error {
  color: var(--danger);
  background: var(--danger-soft);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.title {
  font-size: var(--text-3xl);
  letter-spacing: -0.03em;
}

.lead {
  margin-top: var(--s-2);
  color: var(--text-3);
  font-size: var(--text-md);
}

.go {
  margin-top: var(--s-7);
}

.hint {
  margin-top: var(--s-4);
  font-size: var(--text-sm);
  color: var(--text-3);
}
</style>
