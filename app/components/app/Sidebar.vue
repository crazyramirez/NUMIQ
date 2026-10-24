<script setup lang="ts">
import type { MenuItem } from '~/components/ui/Menu.vue'

const { me, companyName, switchCompany } = useMe()
const { clear } = useUserSession()
const { mode: colorMode } = useTheme()
const { collapsed, mini, navOpen } = useSidebar()
const route = useRoute()

watch(() => route.fullPath, () => (navOpen.value = false))

const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`))
// Área de la pantalla actual: Ventas sigue marcada en Presupuestos, Impuestos en Gestoría…
const activeArea = computed(() => areaOf(route.path).area?.key ?? null)
// Contador de Documentos: importaciones leídas por la IA que esperan confirmación
const inbox = useInboxCount()
watch(() => route.path, () => inbox.refresh(), { immediate: true })

const companyItems = computed<MenuItem[]>(() => [
  { heading: 'Tus empresas' },
  ...(me.value?.companies ?? []).map(c => ({
    label: c.tradeName || c.legalName,
    icon: c.kind === 'autonomo' ? 'ph:user-circle' : 'ph:buildings',
    active: c.id === me.value?.company?.id,
    onClick: () => c.id !== me.value?.company?.id && switchCompany(c.id),
  })),
  { divider: true },
  { label: 'Añadir empresa', icon: 'ph:plus-circle', to: '/bienvenida?nueva=1' },
  { label: 'Datos de la empresa', icon: 'ph:gear-six', to: '/ajustes' },
])

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await clear()
  me.value = null
  await navigateTo('/login')
}

const pwa = usePwa()

const userItems = computed<MenuItem[]>(() => [
  { heading: 'Apariencia' },
  { label: 'Claro', icon: 'ph:sun', active: colorMode.store.value === 'light', onClick: () => (colorMode.value = 'light') },
  { label: 'Oscuro', icon: 'ph:moon', active: colorMode.store.value === 'dark', onClick: () => (colorMode.value = 'dark') },
  { label: 'Automático', icon: 'ph:circle-half', active: colorMode.store.value === 'auto', onClick: () => (colorMode.value = 'auto') },
  { divider: true },
  ...(pwa.canInstall.value ? [{ label: 'Instalar la app', icon: 'ph:device-mobile', onClick: pwa.install }] : []),
  { label: 'Tu cuenta', icon: 'ph:user-circle', to: '/ajustes?s=cuenta' },
  { label: 'Cerrar sesión', icon: 'ph:sign-out', danger: true, onClick: logout },
])
</script>

<template>
  <div>
    <Transition name="fade">
      <div v-if="navOpen" class="scrim" aria-hidden="true" @click="navOpen = false" />
    </Transition>
    <aside class="sidebar" :class="{ collapsed: mini, open: navOpen }" aria-label="Navegación principal">
      <div class="top">
        <NuxtLink to="/" class="brand" aria-label="NUMIQ, inicio">
          <AppLogo :size="28" :wordmark="!mini" />
        </NuxtLink>
        <button class="collapse" type="button" :aria-label="mini ? 'Expandir menú' : 'Contraer menú'" @click="collapsed = !collapsed">
          <Icon name="ph:sidebar-simple" />
        </button>
      </div>

      <UiMenu :items="companyItems" align="start" :width="252" class="company-menu">
        <template #default="{ toggle }">
          <button type="button" class="company" :title="companyName" @click="toggle">
            <UiAvatar :name="companyName || '?'" :size="30" square />
            <span v-if="!mini" class="company-text">
              <span class="name truncate">{{ companyName }}</span>
              <span class="nif">{{ me?.company?.nif }}</span>
            </span>
            <Icon v-if="!mini" name="ph:caret-up-down" class="caret" />
          </button>
        </template>
      </UiMenu>

      <nav class="nav">
        <div v-for="(group, gi) in NAV" :key="gi" class="section">
          <hr v-if="gi > 0" class="divider sep">
          <NuxtLink
            v-for="item in group"
            :key="item.key"
            :to="item.to"
            class="item"
            :class="{ active: activeArea === item.key, ai: item.key === 'asistente' }"
            :title="mini ? item.label : undefined"
            :aria-current="activeArea === item.key ? 'page' : undefined"
          >
            <Icon :name="activeArea === item.key ? `${item.icon}-fill` : item.icon" class="ic" aria-hidden="true" />
            <span v-if="!mini" class="grow truncate">{{ item.label }}</span>
            <span v-if="item.key === 'documentos' && inbox.count.value" class="badge-n num" :aria-label="`${inbox.count.value} por revisar`">{{ inbox.count.value > 99 ? '99+' : inbox.count.value }}</span>
            <span v-if="!mini && item.soon" class="soon">Pronto</span>
          </NuxtLink>
        </div>
      </nav>

      <div class="bottom">
        <NuxtLink :to="SETTINGS_NAV.to" class="item" :class="{ active: isActive(SETTINGS_NAV.to) }" :title="mini ? SETTINGS_NAV.label : undefined">
          <Icon :name="isActive(SETTINGS_NAV.to) ? `${SETTINGS_NAV.icon}-fill` : SETTINGS_NAV.icon" class="ic" aria-hidden="true" />
          <span v-if="!mini" class="grow">{{ SETTINGS_NAV.label }}</span>
        </NuxtLink>
        <UiMenu :items="userItems" align="start" up :width="230">
          <template #default="{ toggle }">
            <button type="button" class="user" @click="toggle">
              <UiAvatar :name="me?.user.name ?? ''" :size="30" :src="me?.user.avatarUrl" />
              <span v-if="!mini" class="company-text">
                <span class="name truncate">{{ me?.user.name }}</span>
                <span class="nif truncate">{{ me?.user.email }}</span>
              </span>
              <Icon v-if="!mini" name="ph:dots-three" class="caret" />
            </button>
          </template>
        </UiMenu>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: var(--z-sidebar);
  display: flex;
  flex-direction: column;
  width: var(--sidebar-w);
  padding: 14px 12px 12px;
  background: color-mix(in srgb, var(--surface) 82%, var(--bg));
  border-right: 1px solid var(--border);
  transition: width var(--t-slow) var(--ease-out), transform var(--t-slow) var(--ease-out);
}

.collapsed {
  width: var(--sidebar-w-collapsed);
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 6px;
  margin-bottom: 14px;
}

.collapsed .top {
  flex-direction: column;
  height: auto;
  gap: 10px;
}

.collapse {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--text-4);
  border-radius: var(--r-sm);
  transition: color var(--t-fast), background var(--t-fast);
}

.collapse:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.company-menu {
  display: flex;
}

.company,
.user {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px;
  text-align: left;
  border-radius: var(--r-lg);
  transition: background var(--t-fast);
}

.company {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-xs);
}

.company:hover,
.user:hover {
  background: var(--surface-hover);
}

.collapsed .company {
  justify-content: center;
  padding: 5px;
}

.company-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  line-height: 1.25;
}

.name {
  font-weight: 600;
  font-size: var(--text-sm);
}

.nif {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.caret {
  width: 15px;
  height: 15px;
  color: var(--text-3);
  flex-shrink: 0;
}

.nav {
  flex: 1;
  overflow-y: auto;
  margin: 14px -4px 0;
  padding: 0 4px;
}

.sep {
  margin: 10px 8px;
}

.item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  margin-bottom: 1px;
  font-weight: 520;
  color: var(--text-2);
  border-radius: var(--r-md);
  transition: background var(--t-fast), color var(--t-fast);
}

.collapsed .item {
  justify-content: center;
  padding: 0;
}

.item:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.item.active {
  color: var(--text);
  font-weight: 600;
  background: var(--surface);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border-subtle);
}

.item.active .ic {
  color: var(--brand);
}

.item.ai .ic {
  color: var(--ai-1);
}

.ic {
  width: 19px;
  height: 19px;
  flex-shrink: 0;
  color: var(--text-3);
  transition: color var(--t-fast);
}

.badge-n {
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--on-brand);
  background: var(--brand);
  border-radius: var(--r-full);
}

.collapsed .badge-n {
  position: absolute;
  top: 2px;
  right: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 10px;
}

.soon {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  color: var(--text-3);
  background: var(--surface-active);
  border-radius: var(--r-full);
}

.bottom {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}

.bottom :deep(.menu) {
  display: flex;
}

.collapsed .user {
  justify-content: center;
}

.scrim {
  display: none;
}

@media (max-width: 1023px) {
  .sidebar {
    width: 280px;
    transform: translateX(-100%);
    box-shadow: var(--shadow-xl);
    background: var(--surface);
  }

  .sidebar.collapsed {
    width: 280px;
  }

  .sidebar.open {
    transform: none;
  }

  .collapse {
    display: none;
  }

  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: var(--z-sidebar);
    background: var(--overlay);
  }
}
</style>
