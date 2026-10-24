<script setup lang="ts">
// El correo con facturas ya no tiene pantalla: los enlaces antiguos van a Documentos
await navigateTo('/documentos/archivo', { replace: true })
</script>
