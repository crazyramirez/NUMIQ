<script setup lang="ts">
withDefaults(defineProps<{ icon?: string, title: string, text?: string, compact?: boolean }>(), { icon: 'ph:folder-open' })
</script>

<template>
  <div class="empty" :class="{ compact }">
    <div class="art" aria-hidden="true">
      <Icon :name="icon" />
    </div>
    <h3>{{ title }}</h3>
    <p v-if="text">{{ text }}</p>
    <div v-if="$slots.default" class="actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--s-9) var(--s-6);
}

.compact {
  padding: var(--s-7) var(--s-4);
}

.art {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--s-4);
  font-size: 26px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-xl);
  box-shadow: inset 0 0 0 1px var(--brand-soft-2);
}

.compact .art {
  width: 44px;
  height: 44px;
  font-size: 20px;
}

h3 {
  font-size: var(--text-lg);
  font-weight: 620;
}

p {
  max-width: 420px;
  margin-top: var(--s-2);
  color: var(--text-3);
}

.actions {
  display: flex;
  gap: var(--s-2);
  margin-top: var(--s-5);
  flex-wrap: wrap;
  justify-content: center;
}
</style>
