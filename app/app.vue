<script setup lang="ts">
const { state: viewer } = useFileViewer()
// Abierta con la sesión bloqueada: nada de la app se monta (ni pide datos) hasta desbloquear
const { state: lock } = useAppLock()
</script>

<template>
  <NuxtLayout v-if="!lock.locked || lock.revealed">
    <NuxtPage />
  </NuxtLayout>
  <AppToasts />
  <AppConfirm />
  <AppContextMenu />
  <LazyAppFileViewer v-if="viewer.mounted" />
  <AppLock />
</template>
