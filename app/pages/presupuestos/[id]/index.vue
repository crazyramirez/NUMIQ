<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <SalesView :key="Number(route.params.id)" :id="Number(route.params.id)" />
</template>
