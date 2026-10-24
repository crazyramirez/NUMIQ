import { createSharedComposable } from '@vueuse/core'

/** Tema claro/oscuro/automático en <html data-theme>; el script de nuxt.config lo aplica antes de pintar */
export const useTheme = createSharedComposable(() => {
  const mode = useColorMode({ attribute: 'data-theme', storageKey: 'numiq-theme' })
  const isDark = computed(() => mode.state.value === 'dark')
  return { mode, isDark, toggle: () => (mode.value = isDark.value ? 'light' : 'dark') }
})
