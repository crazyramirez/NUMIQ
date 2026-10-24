<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Nueva contraseña · NUMIQ' })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const token = typeof route.query.token === 'string' ? route.query.token : ''
const password = ref('')
const repeat = ref('')
const show = ref(false)
const loading = ref(false)
const error = ref<string | null>(token ? null : 'El enlace no es válido: pide uno nuevo')

const mismatch = computed(() => !!repeat.value && repeat.value !== password.value)

async function submit() {
  if (password.value.length < 8 || mismatch.value) return
  loading.value = true
  error.value = null
  try {
    await $fetch('/api/auth/reset', { method: 'POST', body: { token, password: password.value } })
    await refreshSession()
    useToast().success('Contraseña cambiada', 'Ya has entrado con la nueva')
    await navigateTo('/')
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
    <h1 class="title">Elige una contraseña nueva</h1>
    <p class="lead">Al guardarla entrarás directamente en tu cuenta.</p>
    <form class="form" novalidate @submit.prevent="submit">
      <UiInput v-model="password" label="Contraseña nueva" :type="show ? 'text' : 'password'" autocomplete="new-password" icon="ph:lock-simple" hint="Mínimo 8 caracteres" required>
        <template #end>
          <button type="button" class="eye" :aria-label="show ? 'Ocultar contraseña' : 'Mostrar contraseña'" @click="show = !show">
            <Icon :name="show ? 'ph:eye-slash' : 'ph:eye'" />
          </button>
        </template>
      </UiInput>
      <UiInput v-model="repeat" label="Repítela" :type="show ? 'text' : 'password'" autocomplete="new-password" icon="ph:lock-simple" :error="mismatch ? 'No coinciden' : null" required />
      <Transition name="fade">
        <p v-if="error" class="alert" role="alert"><Icon name="ph:warning-circle-fill" /> {{ error }}</p>
      </Transition>
      <UiButton type="submit" variant="primary" size="lg" block :loading="loading" :disabled="!token || password.length < 8 || mismatch || !repeat">Guardar y entrar</UiButton>
    </form>
    <p class="switch"><NuxtLink to="/recuperar" class="link">Pedir otro enlace</NuxtLink></p>
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

.switch {
  margin-top: var(--s-6);
  text-align: center;
}
</style>
