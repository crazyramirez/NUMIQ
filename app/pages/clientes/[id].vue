<script setup lang="ts">
const route = useRoute()
const id = computed(() => Number(route.params.id))
</script>

<template>
  <ContactDetail :key="id" role="client" :id="id" />
</template>
