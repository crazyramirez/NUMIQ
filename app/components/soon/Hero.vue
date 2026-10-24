<script setup lang="ts">
/** Cabecera de los módulos que llegan en la Fase 2 */
defineProps<{ icon: string, eyebrow: string, title: string, text: string }>()
</script>

<template>
  <header class="hero rise">
    <div class="glow" aria-hidden="true" />
    <div class="inner">
      <span class="hero-ic" aria-hidden="true"><Icon :name="icon" /></span>
      <div class="grow">
        <p class="eyebrow row gap-2">{{ eyebrow }} <UiBadge tone="ai" size="sm" icon="ph:rocket-launch">Fase 2</UiBadge></p>
        <h1>{{ title }}</h1>
        <p class="text">{{ text }}</p>
        <div v-if="$slots.default" class="actions"><slot /></div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  margin-bottom: var(--s-6);
  padding: var(--s-8);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-xs);
}

.glow {
  position: absolute;
  inset: -40% -10% auto auto;
  width: 520px;
  height: 420px;
  background:
    radial-gradient(closest-side, rgb(124 58 237 / 0.16), transparent),
    radial-gradient(closest-side at 70% 60%, rgb(14 165 233 / 0.12), transparent);
  pointer-events: none;
}

.inner {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--s-5);
}

.hero-ic {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  font-size: 26px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-xl);
  box-shadow: 0 10px 28px -10px rgb(99 70 229 / 0.7);
}

h1 {
  margin-top: var(--s-2);
  font-size: var(--text-3xl);
  font-weight: 680;
  letter-spacing: -0.028em;
}

.text {
  max-width: 640px;
  margin-top: var(--s-2);
  font-size: var(--text-md);
  color: var(--text-3);
  line-height: 1.6;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-top: var(--s-5);
}

@media (max-width: 767px) {
  .hero {
    padding: var(--s-5);
  }

  .inner {
    flex-direction: column;
    gap: var(--s-4);
  }

  h1 {
    font-size: var(--text-2xl);
  }
}
</style>
