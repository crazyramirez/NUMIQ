<script setup lang="ts">
defineProps<{ icon: string, title: string, text: string }>()
</script>

<template>
  <article class="card feature">
    <span class="f-ic" aria-hidden="true"><Icon :name="icon" /></span>
    <h3>{{ title }}</h3>
    <p>{{ text }}</p>
  </article>
</template>

<style scoped>
.feature {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--s-5);
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}

.feature:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.f-ic {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin-bottom: 4px;
  font-size: 19px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-md);
}

h3 {
  font-size: var(--text-md);
  font-weight: 620;
}

p {
  font-size: var(--text-sm);
  color: var(--text-3);
  line-height: 1.55;
}
</style>
