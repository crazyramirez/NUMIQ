<script setup lang="ts">
import type { NuxtError } from '#app'

// Página de error propia: la de Nuxt sale en inglés y sin el diseño de la app
const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error.statusCode === 404)
useHead({ title: computed(() => `${notFound.value ? 'No encontrado' : 'Algo ha fallado'} · NUMIQ`) })

const home = () => clearError({ redirect: '/' })
const retry = () => clearError().then(() => reloadNuxtApp())
function back() {
  if (window.history.length > 1) clearError().then(() => window.history.back())
  else home()
}
</script>

<template>
  <main class="err">
    <AppLogo :size="30" class="err-logo" />
    <div class="err-card">
      <span class="err-ic" aria-hidden="true">
        <Icon :name="notFound ? 'ph:compass' : 'ph:cloud-warning'" />
      </span>
      <p class="err-code num">{{ error.statusCode || 500 }}</p>
      <h1>{{ notFound ? 'Esta página no existe' : 'Algo ha fallado' }}</h1>
      <p class="err-text">
        {{ notFound
          ? 'Puede que el enlace esté mal escrito o que lo que buscabas se haya movido o borrado.'
          : 'No es culpa tuya. Vuelve a intentarlo en unos segundos; si sigue pasando, escríbenos.' }}
      </p>
      <div class="err-acts">
        <UiButton v-if="notFound" icon="ph:arrow-left" @click="back">Volver</UiButton>
        <UiButton v-else icon="ph:arrow-clockwise" @click="retry">Reintentar</UiButton>
        <UiButton variant="primary" icon="ph:house" @click="home">Ir a Inicio</UiButton>
      </div>
    </div>
  </main>
</template>

<style scoped>
.err {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-7);
  min-height: 100dvh;
  padding: var(--s-6) var(--s-4);
  background:
    radial-gradient(60% 50% at 50% 0%, var(--brand-soft), transparent 70%),
    var(--bg);
}

.err-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 440px;
  padding: var(--s-8) var(--s-6);
  text-align: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-lg);
}

.err-ic {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  font-size: 28px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-xl);
  box-shadow: inset 0 0 0 1px var(--brand-soft-2);
}

.err-code {
  margin-top: var(--s-4);
  font-size: var(--text-xs);
  font-weight: 650;
  letter-spacing: 0.12em;
  color: var(--text-3);
}

h1 {
  margin-top: 4px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.025em;
}

.err-text {
  margin-top: var(--s-2);
  color: var(--text-3);
  line-height: 1.55;
}

.err-acts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--s-2);
  margin-top: var(--s-6);
}

@media (max-width: 480px) {
  .err-card {
    padding: var(--s-7) var(--s-5);
  }

  .err-acts > * {
    flex: 1 1 100%;
  }
}
</style>
