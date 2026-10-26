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
const { me, readOnly } = useMe()
const { collapsed, desktop } = useSidebar()
const { mode: colorMode } = useTheme()
const palette = useState('paletteOpen', () => false)
function pageMenu(e: MouseEvent): CtxSpec | null {
  if ((e.target as Element).closest('a[href], img, video, canvas, iframe, [data-native-ctx]')) return null
  const theme = colorMode.store.value
  return {
    footer: 'Mayús + clic derecho: menú del navegador',
    items: [
      { label: 'Atrás', icon: 'ph:arrow-left', keys: ['Alt', '←'], disabled: !window.history.state?.back, onClick: () => router.back() },
      { label: 'Recargar', icon: 'ph:arrow-clockwise', keys: ['F5'], onClick: () => window.location.reload() },
      { divider: true },
      ...(readOnly.value
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

// Aviso de la actualización: la clave de OpenAI pasa del .env a cada usuario. Una vez por usuario y dispositivo,
// solo a quien aún no ha pegado la suya
const toast = useToast()
onMounted(() => {
  let checked = false
  watch(() => me.value?.company?.id, async (companyId) => {
    // En Ajustes → IA ya se ve el formulario: el aviso sobra
    if (!companyId || checked || (route.path === '/ajustes' && route.query.s === 'ia')) return
    checked = true
    const seenKey = `numiq-ai-key-notice-${me.value!.user.id}`
    try {
      if (localStorage.getItem(seenKey)) return
    }
    catch {
      return
    }
    const ai = await $fetch('/api/ai/status').catch(() => null)
    // El gestor usa la clave de la empresa que lo invitó: no tiene nada que hacer
    if (!ai || ai.own || (ai.advisor && ai.configured)) return
    try {
      localStorage.setItem(seenKey, '1')
    }
    catch {}
    toast.push({
      tone: 'info',
      title: 'La IA ahora usa tu propia clave de OpenAI',
      body: ai.source === 'owner'
        ? `Ya no va en el .env del servidor: cada usuario puede usar la suya. Ahora usas la de ${ai.ownerName}; si prefieres la tuya, añádela en Ajustes → Inteligencia artificial. Se guarda cifrada.`
        : 'Para usar la IA, añade tu clave en Ajustes → Inteligencia artificial: ya no va en el .env del servidor y cada usuario usa la suya. Se guarda cifrada.',
      action: { label: 'Añadir clave', run: () => navigateTo('/ajustes?s=ia') },
    }, 0)
  }, { immediate: true })
})
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
