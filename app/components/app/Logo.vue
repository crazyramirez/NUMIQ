<script setup lang="ts">
withDefaults(defineProps<{ size?: number, wordmark?: boolean }>(), { size: 30, wordmark: true })
const gid = useId()
</script>

<template>
  <span class="logo">
    <svg :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7464ff" />
          <stop offset="1" stop-color="#3a2fd6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" :fill="`url(#${gid})`" />
      <path d="M10 23V10.2l12 12.6V14.2" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="22" cy="9.4" r="2.4" fill="#67e8f9" />
    </svg>
    <span v-if="wordmark" class="word">NUMIQ</span>
  </span>
</template>

<style scoped>
.logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

svg {
  flex-shrink: 0;
  filter: drop-shadow(0 2px 6px rgb(79 70 229 / 0.35));
}

.word {
  font-size: 17px;
  font-weight: 760;
  letter-spacing: 0.04em;
  color: var(--text);
}
</style>
