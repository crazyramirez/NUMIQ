<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Crear cuenta · NUMIQ' })

const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const { refresh: refreshMe } = useMe()
// Registro desde una invitación: el email ya viene dado y al terminar se une a la empresa
const invitation = typeof route.query.invitacion === 'string' ? route.query.invitacion : null
const form = reactive({ name: '', email: typeof route.query.email === 'string' ? route.query.email : '', password: '' })
const showPassword = ref(false)
const loading = ref(false)
const errors = reactive<Record<string, string | null>>({ name: null, email: null, password: null })
const error = ref<string | null>(null)

const strength = computed(() => {
  const p = form.password
  let s = 0
  if (p.length >= 8) s++
  if (p.length >= 12) s++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++
  return s
})
const strengthLabel = computed(() => ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Excelente'][strength.value])

async function submit() {
  loading.value = true
  error.value = null
  Object.keys(errors).forEach(k => (errors[k] = null))
  try {
    await $fetch('/api/auth/register', { method: 'POST', body: form })
    await refreshSession()
    if (invitation) {
      try {
        await $fetch(`/api/invites/${invitation}/accept`, { method: 'POST' })
        await refreshMe()
        return navigateTo('/')
      }
      catch (err) {
        error.value = errorMessage(err)
      }
    }
    const r = typeof route.query.r === 'string' && route.query.r.startsWith('/') ? route.query.r : null
    await navigateTo(r ?? '/bienvenida')
  }
  catch (err) {
    const field = errorField(err)
    if (field && field in errors) errors[field] = errorMessage(err)
    else error.value = errorMessage(err)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="rise">
    <h1 class="title">{{ invitation ? 'Crea tu cuenta' : 'Empieza en 2 minutos' }}</h1>
    <p class="lead">{{ invitation ? 'Con ella aceptarás la invitación y entrarás directamente.' : 'Facturas legales, gastos ordenados e impuestos calculados. Sin papeles.' }}</p>

    <form class="form" novalidate @submit.prevent="submit">
      <UiInput v-model="form.name" label="Nombre" autocomplete="name" placeholder="Tu nombre" icon="ph:user" :error="errors.name" required />
      <UiInput v-model="form.email" label="Email" type="email" autocomplete="email" placeholder="tu@empresa.es" icon="ph:envelope-simple" :error="errors.email" required />
      <div class="pw">
        <UiInput v-model="form.password" label="Contraseña" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" icon="ph:lock-simple" :error="errors.password" hint="Mínimo 8 caracteres" required>
          <template #end>
            <button type="button" class="eye" :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'" @click="showPassword = !showPassword">
              <Icon :name="showPassword ? 'ph:eye-slash' : 'ph:eye'" />
            </button>
          </template>
        </UiInput>
        <div v-if="form.password" class="meter" :data-s="strength" aria-live="polite">
          <span v-for="i in 4" :key="i" class="bar" :class="{ on: i <= strength }" />
          <span class="m-label">{{ strengthLabel }}</span>
        </div>
      </div>

      <Transition name="fade">
        <p v-if="error" class="alert" role="alert"><Icon name="ph:warning-circle-fill" /> {{ error }}</p>
      </Transition>

      <UiButton type="submit" variant="primary" size="lg" block :loading="loading" icon-right="ph:arrow-right">Crear cuenta</UiButton>
    </form>

    <p class="switch">¿Ya tienes cuenta? <NuxtLink to="/login" class="link">Entra</NuxtLink></p>
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

.meter {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}

.bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-active);
  transition: background var(--t-base);
}

.meter[data-s='1'] .bar.on { background: var(--danger-solid); }
.meter[data-s='2'] .bar.on { background: var(--warning-solid); }
.meter[data-s='3'] .bar.on,
.meter[data-s='4'] .bar.on { background: var(--success-solid); }

.m-label {
  min-width: 70px;
  margin-left: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
  text-align: right;
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
  color: var(--text-3);
}
</style>
