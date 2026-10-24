<script setup lang="ts">
// La Bandeja ya no existe: sus enlaces antiguos van a Documentos
await navigateTo('/documentos/archivo', { replace: true })
</script>
