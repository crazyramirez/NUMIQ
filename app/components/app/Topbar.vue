<script setup lang="ts">
import type { MenuItem } from '~/components/ui/Menu.vue'

const { navOpen } = useSidebar()
// Punto en el menú si hay importaciones por confirmar en Documentos
const inbox = useInboxCount()
const palette = useState('paletteOpen', () => false)
const { isDark, toggle: toggleTheme } = useTheme()
const { open: openScan } = useScan()
const { me } = useMe()
// El gestor entra en modo consulta: sin crear ni escanear
const readOnly = computed(() => me.value?.company?.role === 'advisor')
const isMac = computed(() => import.meta.client && /Mac|iPhone|iPad/.test(navigator.platform))

const createItems: MenuItem[] = CREATE_ACTIONS.map(a => ({ label: a.label, icon: a.icon, to: a.to }))
</script>

<template>
  <header class="topbar">
    <span class="burger">
      <UiButton variant="ghost" square icon="ph:list" :aria-label="inbox.count.value ? 'Abrir menú: hay documentos por revisar' : 'Abrir menú'" @click="navOpen = true" />
      <span v-if="inbox.count.value" class="burger-dot" aria-hidden="true" />
    </span>
    <!-- Móvil: menú y marca a la izquierda; crear está en la barra inferior y la apariencia en el menú -->
    <NuxtLink to="/" class="m-brand" aria-label="NUMIQ, inicio"><AppLogo :size="30" :wordmark="false" /></NuxtLink>

    <button type="button" class="search" @click="palette = true">
      <Icon name="ph:magnifying-glass" class="s-ic" aria-hidden="true" />
      <span class="grow s-txt">Buscar o ir a…</span>
      <span class="keys" aria-hidden="true"><kbd class="kbd">{{ isMac ? '⌘' : 'Ctrl' }}</kbd><kbd class="kbd">K</kbd></span>
    </button>

    <div class="right">
      <UiButton class="theme-btn" variant="ghost" square :icon="isDark ? 'ph:sun' : 'ph:moon'" :aria-label="isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'" :title="isDark ? 'Tema claro' : 'Tema oscuro'" @click="toggleTheme" />
      <UiBadge v-if="readOnly" tone="ai" icon="ph:eye" class="ro">Modo consulta</UiBadge>
      <UiButton v-if="!readOnly" class="scan-btn" variant="secondary" icon="ph:scan" aria-label="Escanear factura o ticket" title="Escanear factura o ticket" @click="openScan()">
        Escanear
      </UiButton>
      <UiMenu v-if="!readOnly" :items="createItems" :width="236">
        <template #default="{ toggle }">
          <UiButton class="new-btn" variant="primary" icon="ph:plus-bold" aria-label="Nuevo" @click="toggle">
            Nuevo
          </UiButton>
        </template>
      </UiMenu>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  gap: var(--s-3);
  height: var(--topbar-h);
  padding: 0 var(--s-7);
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  backdrop-filter: saturate(1.6) blur(14px);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}

.burger {
  position: relative;
  display: none;
  flex: none;
}

.burger-dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 9px;
  height: 9px;
  background: var(--danger-solid);
  border: 2px solid var(--bg);
  border-radius: 50%;
  pointer-events: none;
}

.search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  max-width: 420px;
  height: 38px;
  padding: 0 8px 0 12px;
  color: var(--text-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xs);
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}

.search:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.s-ic {
  width: 16px;
  height: 16px;
}

.s-txt {
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.keys {
  display: flex;
  gap: 3px;
}

.right {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-left: auto;
}

.m-brand {
  display: none;
  flex: none;
}

@media (max-width: 1023px) {
  .topbar {
    padding: 0 var(--s-4);
  }

  .burger {
    display: inline-flex;
  }
}

.scan-btn :deep(.btn-icon) {
  color: var(--ai-1);
}

@media (max-width: 1180px) {
  .scan-btn :deep(.btn-label) {
    display: none;
  }

  .scan-btn {
    width: 38px;
    padding-inline: 0;
  }
}

@media (max-width: 767px) {
  .topbar {
    gap: var(--s-2);
    padding: 0 var(--s-3);
  }

  /* La apariencia se cambia desde el menú (Claro / Oscuro / Auto) */
  .keys,
  .right > :not(.ro) {
    display: none;
  }

  .m-brand {
    display: inline-flex;
    margin-right: 2px;
  }

  .search {
    max-width: none;
    height: 40px;
  }

  /* Botón de 40 px: cómodo para el dedo */
  .topbar .burger :deep(.btn) {
    width: 40px;
    height: 40px;
  }

  .topbar .burger :deep(.btn) {
    color: var(--text);
  }

  .topbar .burger :deep(.btn-icon) {
    width: 22px;
    height: 22px;
  }
}
</style>
