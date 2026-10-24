<script setup lang="ts">
defineProps<{ label?: string, hint?: string, disabled?: boolean }>()
const model = defineModel<boolean>({ default: false })
const id = useId()
</script>

<template>
  <label :for="id" class="switch-row" :class="{ disabled }">
    <span v-if="label || hint" class="text">
      <span v-if="label" class="t">{{ label }}</span>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </span>
    <span class="switch">
      <input :id="id" v-model="model" type="checkbox" role="switch" :disabled="disabled">
      <span class="track" aria-hidden="true"><span class="thumb" /></span>
    </span>
  </label>
</template>

<style scoped>
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  cursor: pointer;
}

.switch-row.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.t {
  font-weight: 550;
  color: var(--text);
}

.switch {
  position: relative;
  flex-shrink: 0;
}

.switch input {
  position: absolute;
  inset: 0;
  opacity: 0;
  margin: 0;
  cursor: inherit;
}

.track {
  display: block;
  width: 38px;
  height: 22px;
  padding: 2px;
  background: var(--border-strong);
  border-radius: var(--r-full);
  transition: background var(--t-base) var(--ease-out);
}

.thumb {
  display: block;
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
  transition: transform var(--t-base) var(--ease-spring);
}

input:checked + .track {
  background: var(--brand);
}

input:checked + .track .thumb {
  transform: translateX(16px);
}

input:focus-visible + .track {
  box-shadow: var(--focus-ring);
}
</style>
