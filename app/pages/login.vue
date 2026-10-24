<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Entrar · NUMIQ' })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const form = reactive({ email: typeof route.query.email === 'string' ? route.query.email : '', password: '' })
const showPassword = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

async function submit() {
  loading.value = true
  error.value = null
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: form })
    await refreshSession()
    await navigateTo(typeof route.query.r === 'string' && route.query.r.startsWith('/') ? route.query.r : '/')
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

.switch {
  margin-top: var(--s-6);
  text-align: center;
  color: var(--text-3);
}
</style>
