<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <SalesEditor kind="quote" :id="Number(route.params.id)" />
</template>
