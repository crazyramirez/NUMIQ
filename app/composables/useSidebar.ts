import { createSharedComposable } from '@vueuse/core'

/** Estado del menú lateral: contraído (solo escritorio, se recuerda) y abierto (móvil) */
export const useSidebar = createSharedComposable(() => {
  const collapsed = useLocalStorage('numiq-sidebar-collapsed', false)
  const desktop = useMediaQuery('(min-width: 1024px)')
  const mini = computed(() => collapsed.value && desktop.value)
  const navOpen = useState('navOpen', () => false)
  return { collapsed, desktop, mini, navOpen }
})
