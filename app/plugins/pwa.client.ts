/** Escucha desde el arranque el aviso de instalación del navegador (sin service worker: no cachea nada) */
export default defineNuxtPlugin(() => {
  listenInstallPrompt()
  sizeFirstLaunch()
})

/**
 * App instalada en escritorio: el manifiesto no permite fijar el tamaño de la ventana, así que la
 * primera vez se abre a 1280×720 centrada. Después Chrome/Edge recuerdan el tamaño que deje el usuario.
 */
function sizeFirstLaunch() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches
  const desktop = window.matchMedia('(pointer: fine)').matches && !/android|iphone|ipad|ipod/i.test(navigator.userAgent)
  if (!standalone || !desktop) return
  try {
    if (localStorage.getItem('numiq-pwa-window')) return
    localStorage.setItem('numiq-pwa-window', '1')
  }
  catch {
    return
  }
  const s: Screen & { availLeft?: number, availTop?: number } = screen
  const w = Math.min(1280, s.availWidth)
  const h = Math.min(720, s.availHeight)
  try {
    window.resizeTo(w, h)
    window.moveTo((s.availLeft ?? 0) + Math.round((s.availWidth - w) / 2), (s.availTop ?? 0) + Math.round((s.availHeight - h) / 2))
  }
  catch {
    // El navegador no deja cambiar el tamaño: se queda como lo abra
  }
}
