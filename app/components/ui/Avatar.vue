<script setup lang="ts">
const props = withDefaults(defineProps<{
  name: string
  size?: number
  square?: boolean
  src?: string | null
  /** Logotipo: se ve entero sobre blanco en lugar de recortarse como una foto */
  contain?: boolean
}>(), { size: 32 })
const hue = computed(() => hueOf(props.name))
// Si la imagen no carga, vuelven las iniciales
const failed = ref(false)
watch(() => props.src, () => (failed.value = false))
const showImg = computed(() => !!props.src && !failed.value)
</script>

<template>
  <span
    class="avatar"
    :class="{ square, logo: showImg && contain }"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px`, '--h': hue }"
    aria-hidden="true"
  >
    <img v-if="showImg" :src="src!" alt="" loading="lazy" @error="failed = true">
    <template v-else>{{ initials(name) || '·' }}</template>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  overflow: hidden;
  font-weight: 620;
  letter-spacing: -0.02em;
  color: hsl(var(--h) 52% 36%);
  background: hsl(var(--h) 70% 93%);
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px hsl(var(--h) 40% 50% / 0.12);
}

:root[data-theme='dark'] .avatar {
  color: hsl(var(--h) 70% 78%);
  background: hsl(var(--h) 35% 20%);
}

.square {
  border-radius: 28%;
}

img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar.logo,
:root[data-theme='dark'] .avatar.logo {
  background: #fff;
  box-shadow: inset 0 0 0 1px rgb(16 24 40 / 0.1);
}

.logo img {
  padding: 9%;
  object-fit: contain;
}
</style>
