<script setup lang="ts">
import type { CtxSpec } from '~/composables/useContextMenu'

const { mini } = useSidebar()
const route = useRoute()
const router = useRouter()
const { open: openScan } = useScan()

// Barra inferior del móvil en todas las pantallas salvo los editores (tienen su propia barra de guardar)
const bottomNav = computed(() => !/^\/(facturas|presupuestos)\/(nueva|nuevo|\d+\/editar)$/.test(route.path))
// En los editores la barra de abajo es la de guardar: lo fijo (botón de subir, avisos) se coloca encima de ella
useHead({ htmlAttrs: { class: computed(() => (bottomNav.value ? 'bnav' : 'edbar')) } })

// ?escanear=1 en cualquier página abre el escaneo rápido (paleta, menú Nuevo, enlaces)
watch(() => route.query.escanear, (v) => {
  if (!v) return
  openScan(v === 'emitida' ? 'issued' : v === 'gasto' ? 'received' : 'auto')
  const { escanear: _, ...query } = route.query
  router.replace({ query })
}, { immediate: true })

// Clic derecho en una zona sin menú propio: crear, buscar, escanear, tema… (enlaces e imágenes, el del navegador)
const { me } = useMe()
const { collapsed, desktop } = useSidebar()
const { mode: colorMode } = useTheme()
const palette = useState('paletteOpen', () => false)
function pageMenu(e: MouseEvent): CtxSpec | null {
  if ((e.target as Element).closest('a[href], img, video, canvas, iframe, [data-native-ctx]')) return null
  const readOnly = me.value?.company?.role === 'advisor'
  const theme = colorMode.store.value
  return {
    footer: 'Mayús + clic derecho: menú del navegador',
    items: [
      { label: 'Atrás', icon: 'ph:arrow-left', keys: ['Alt', '←'], disabled: !window.history.state?.back, onClick: () => router.back() },
      { label: 'Recargar', icon: 'ph:arrow-clockwise', keys: ['F5'], onClick: () => window.location.reload() },
      { divider: true },
      ...(readOnly
        ? []
        : [
            { label: 'Crear', icon: 'ph:plus-circle', children: CREATE_ACTIONS.filter(a => !a.to.includes('escanear')).map(a => ({ label: a.label, icon: a.icon, to: a.to })) },
            { label: 'Escanear documento', icon: 'ph:scan', onClick: () => openScan('auto') },
          ]),
      { label: 'Buscar…', icon: 'ph:magnifying-glass', keys: [modKey(), 'K'], onClick: () => (palette.value = true) },
      { divider: true },
      { label: 'Copiar enlace de esta página', icon: 'ph:link', onClick: () => copyText(window.location.href, 'Enlace') },
      {
        label: 'Apariencia',
        icon: theme === 'dark' ? 'ph:moon' : theme === 'light' ? 'ph:sun' : 'ph:circle-half',
        children: ([['light', 'Claro', 'ph:sun'], ['dark', 'Oscuro', 'ph:moon'], ['auto', 'Automático', 'ph:circle-half']] as const)
          .map(([value, label, icon]) => ({ label, icon, active: theme === value, onClick: () => (colorMode.value = value) })),
      },
      ...(desktop.value ? [{ label: collapsed.value ? 'Expandir barra lateral' : 'Contraer barra lateral', icon: collapsed.value ? 'ph:sidebar-simple-fill' : 'ph:sidebar-simple', onClick: () => (collapsed.value = !collapsed.value) }] : []),
    ],
  }
}
</script>

<template>
  <div class="shell" :class="{ mini }">
    <a href="#main" class="skip">Saltar al contenido</a>
    <AppSidebar />
    <div class="main-col">
      <AppTopbar />
      <main id="main" v-ctx="pageMenu" tabindex="-1">
        <AppAreaTabs />
        <slot />
      </main>
    </div>
    <AppCommandPalette />
    <AppScanModal />
    <AppScrollTop />
    <AppBottomNav v-if="bottomNav" />
    <AppPasskeyOffer />
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
