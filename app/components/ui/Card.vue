<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  subtitle?: string
  icon?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** Tarjeta resaltada para funciones de IA */
  ai?: boolean
}>(), { padding: 'md' })
</script>

<template>
  <section class="card ui-card" :class="[`p-${padding}`, { ai }]">
    <header v-if="title || $slots.head || $slots.actions" class="head">
      <div class="titles">
        <slot name="head">
          <h2 class="section-title row gap-2">
            <Icon v-if="icon" :name="icon" class="ic" aria-hidden="true" />
            {{ title }}
          </h2>
          <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
    </header>
    <div class="body"><slot /></div>
    <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
  </section>
</template>

<style scoped>
.ui-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-5) var(--s-5) 0;
}

.p-none .head {
  padding-bottom: var(--s-4);
}

.titles {
  flex: 1;
  min-width: 0;
}

.ic {
  width: 17px;
  height: 17px;
  color: var(--text-3);
}

.subtitle {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  flex-shrink: 0;
  margin: -4px -6px 0 0;
}

.body {
  flex: 1;
  min-width: 0;
}

.p-sm .body { padding: var(--s-3); }
.p-md .body { padding: var(--s-5); }
.p-lg .body { padding: var(--s-7); }
.p-md .head + .body,
.p-sm .head + .body { padding-top: var(--s-4); }

.foot {
  padding: var(--s-3) var(--s-5);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-2);
}

.ai {
  position: relative;
  border-color: transparent;
  background:
    linear-gradient(var(--surface), var(--surface)) padding-box,
    linear-gradient(120deg, rgb(124 58 237 / 0.45), rgb(79 70 229 / 0.25), rgb(14 165 233 / 0.4)) border-box;
  border: 1px solid transparent;
}

.ai::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--ai-soft);
  opacity: 0.5;
  pointer-events: none;
}

.ai > * {
  position: relative;
}
</style>
