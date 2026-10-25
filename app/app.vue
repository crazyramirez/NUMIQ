<script setup lang="ts">
const { state: viewer } = useFileViewer()
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <AppToasts />
  <AppConfirm />
  <LazyAppFileViewer v-if="viewer.mounted" />
</template>
