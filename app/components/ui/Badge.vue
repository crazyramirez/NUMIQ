<script setup lang="ts">
import type { Tone } from '~/utils/labels'

withDefaults(defineProps<{ tone?: Tone, dot?: boolean, icon?: string, size?: 'sm' | 'md' }>(), { tone: 'neutral', size: 'md' })
</script>

<template>
  <span class="badge" :class="[`t-${tone}`, `s-${size}`]">
    <span v-if="dot" class="dot" aria-hidden="true" />
    <Icon v-else-if="icon" :name="icon" class="ic" aria-hidden="true" />
    <slot />
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  font-size: var(--text-xs);
  font-weight: 560;
  white-space: nowrap;
  border-radius: var(--r-full);
  color: var(--c);
  background: var(--bgc);
}

.s-sm {
  height: 19px;
  padding: 0 6px;
  font-size: var(--text-2xs);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.ic {
  width: 12px;
  height: 12px;
}

.t-neutral { --c: var(--text-2); --bgc: var(--surface-active); }
.t-brand { --c: var(--brand-text); --bgc: var(--brand-soft); }
.t-success { --c: var(--success); --bgc: var(--success-soft); }
.t-warning { --c: var(--warning); --bgc: var(--warning-soft); }
.t-danger { --c: var(--danger); --bgc: var(--danger-soft); }
.t-info { --c: var(--info); --bgc: var(--info-soft); }
.t-ai { --c: var(--ai-text); --bgc: transparent; background: var(--ai-soft); box-shadow: inset 0 0 0 1px rgb(124 58 237 / 0.18); }
</style>
