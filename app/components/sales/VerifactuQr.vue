<script setup lang="ts">
import QRCode from 'qrcode'

/** QR de cotejo de la AEAT (nivel de corrección M, como pide la especificación VeriFactu) */
const props = withDefaults(defineProps<{ url: string, size?: number }>(), { size: 92 })
const svg = ref('')

watchEffect(async () => {
  svg.value = await QRCode.toString(props.url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#11141b', light: '#ffffff' } })
})
</script>

<template>
  <a :href="url" target="_blank" rel="noopener" class="qr" :style="{ width: `${size}px`, height: `${size}px` }" aria-label="Cotejar la factura en la sede de la AEAT" v-html="svg" />
</template>

<style scoped>
.qr {
  display: block;
  flex-shrink: 0;
}

.qr :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
