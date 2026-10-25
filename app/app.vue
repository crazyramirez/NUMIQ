<script setup lang="ts">
const { state: viewer } = useFileViewer()
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <AppToasts />
  <AppConfirm />
  <AppContextMenu />
  <LazyAppFileViewer v-if="viewer.mounted" />
</template>
