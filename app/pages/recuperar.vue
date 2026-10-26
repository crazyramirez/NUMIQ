<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Recuperar contraseña · NUMIQ' })

const route = useRoute()
const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
// Desde una invitación: el enlace del correo vuelve a ella tras elegir la contraseña
const back = typeof route.query.r === 'string' && route.query.r.startsWith('/') ? route.query.r : undefined
const loading = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

async function submit() {
  loading.value = true
  error.value = null
  try {
    await $fetch('/api/auth/forgot', { method: 'POST', body: { email: email.value, r: back } })
    sent.value = true
  }
  catch (err) {
    error.value = errorMessage(err)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="rise">
    <template v-if="!sent">
      <h1 class="title">¿Olvidaste tu contraseña?</h1>
      <p class="lead">Escribe tu email y te enviamos un enlace para elegir una nueva.</p>
      <form class="form" novalidate @submit.prevent="submit">
        <UiInput v-model="email" label="Email" type="email" autocomplete="email" placeholder="tu@empresa.es" icon="ph:envelope-simple" required />
        <Transition name="fade">
          <p v-if="error" class="alert" role="alert"><Icon name="ph:warning-circle-fill" /> {{ error }}</p>
        </Transition>
        <UiButton type="submit" variant="primary" size="lg" block :loading="loading" :disabled="!email.includes('@')">Enviar enlace</UiButton>
      </form>
    </template>
    <div v-else class="done">
      <span class="done-ic" aria-hidden="true"><Icon name="ph:envelope-simple-open-fill" /></span>
      <h1 class="title">Revisa tu correo</h1>
      <p class="lead">Si hay una cuenta con <b>{{ email }}</b>, te hemos enviado un enlace para elegir una contraseña nueva. Caduca en una hora. Mira también en el spam.</p>
    </div>
    <p class="switch"><NuxtLink :to="{ path: '/login', query: back ? { r: back, ...(email ? { email } : {}) } : undefined }" class="link"><Icon name="ph:arrow-left" aria-hidden="true" /> Volver a entrar</NuxtLink></p>
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

.done-ic {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--s-5);
  font-size: 28px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-xl);
}

.switch {
  margin-top: var(--s-7);
  text-align: center;
}

.switch .link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
