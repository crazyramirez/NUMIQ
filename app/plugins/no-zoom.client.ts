/**
 * Interfaz de app, no de página: sin zoom con pellizco, doble toque, Ctrl + rueda o Ctrl +/−.
 * El viewport (maximum-scale=1, user-scalable=no) lo frena en Android; Safari en iOS lo ignora
 * desde iOS 10, así que ahí se cortan los gestos a mano. El doble toque lo quita touch-action en base.css.
 */
export default defineNuxtPlugin(() => {
  const stop = (e: Event) => e.preventDefault()

  // Safari (iOS y trackpad de macOS): eventos propios del pellizco
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, stop, { passive: false })
  }

  // Pellizco con dos dedos en cualquier navegador táctil
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault()
  }, { passive: false })

  // Escritorio: Ctrl + rueda y pellizco del trackpad (llega como rueda con ctrlKey)
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault()
  }, { passive: false })

  // Escritorio: Ctrl/⌘ con + − 0
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (['+', '-', '=', '0', '_'].includes(e.key) || ['NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(e.code)) {
      e.preventDefault()
    }
  })
})
