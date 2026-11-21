/** NUMIQ de escritorio: el menú de la app y los avisos del sistema abren pantallas sin recargar */
export default defineNuxtPlugin(() => {
  const { bridge } = useDesktop()
  if (!bridge) return
  document.documentElement.classList.add('is-desktop')
  bridge.onNavigate(url => void navigateTo(url))
})
