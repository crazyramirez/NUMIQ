/**
 * Barra de estado del móvil (theme-color) con el tema elegido en la app, no el del sistema: al cambiar
 * la apariencia, iOS y Android la repintan al momento. Colores = --bg de tokens.css.
 * Se sustituye la etiqueta entera: la app instalada en iOS no siempre repinta si solo cambia el atributo.
 */
export default defineNuxtPlugin(() => {
  const { isDark } = useTheme()

  watch(isDark, (dark) => {
    const color = dark ? '#0a0c10' : '#f5f6f8'
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    if (metas.length === 1 && metas[0]!.content === color) return
    metas.forEach(m => m.remove())
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = color
    document.head.appendChild(meta)
  }, { immediate: true })
})
