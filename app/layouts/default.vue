<script setup lang="ts">
const { mini } = useSidebar()
const route = useRoute()
const router = useRouter()
const { open: openScan } = useScan()

// ?escanear=1 en cualquier página abre el escaneo rápido (paleta, menú Nuevo, enlaces)
watch(() => route.query.escanear, (v) => {
  if (!v) return
  openScan(v === 'emitida' ? 'issued' : v === 'gasto' ? 'received' : 'auto')
  const { escanear: _, ...query } = route.query
  router.replace({ query })
}, { immediate: true })
</script>

<template>
  <div class="shell" :class="{ mini }">
    <a href="#main" class="skip">Saltar al contenido</a>
    <AppSidebar />
    <div class="main-col">
      <AppTopbar />
      <main id="main" tabindex="-1">
        <slot />
      </main>
    </div>
    <AppCommandPalette />
    <AppScanModal />
    <AppScrollTop />
  </div>
</template>

<style scoped>
.main-col {
  min-height: 100dvh;
  margin-left: var(--sidebar-w);
  transition: margin-left var(--t-slow) var(--ease-out);
}

.mini .main-col {
  margin-left: var(--sidebar-w-collapsed);
}

main {
  outline: none;
}

.skip {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: var(--z-toast);
  padding: 8px 14px;
  background: var(--surface);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lg);
  transform: translateY(-200%);
}

.skip:focus {
  transform: none;
}

@media (max-width: 1023px) {
  .main-col,
  .mini .main-col {
    margin-left: 0;
  }
}
</style>
