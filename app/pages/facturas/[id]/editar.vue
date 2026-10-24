<script setup lang="ts">
const route = useRoute()
</script>

<template>
  <SalesEditor kind="invoice" :id="Number(route.params.id)" />
</template>
