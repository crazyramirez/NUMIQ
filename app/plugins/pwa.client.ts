/** Escucha desde el arranque el aviso de instalación del navegador (sin service worker: no cachea nada) */
export default defineNuxtPlugin(() => {
  listenInstallPrompt()
  sizeFirstLaunch()
})

const WINDOW_KEY = 'numiq-pwa-window'
const WIDTH = 1280
const HEIGHT = 900

/**
 * App instalada en Windows o Mac: el manifiesto no permite fijar el tamaño de la ventana, así que la
 * primera vez se abre a 1280×720 centrada. Después Chrome/Edge recuerdan el tamaño que deje el usuario.
 * Al instalar, Chrome/Edge pasan la pestaña a ventana de app sin recargar: se escucha ese cambio.
 */
function sizeFirstLaunch() {
  const desktop = window.matchMedia('(pointer: fine)').matches && !/android|iphone|ipad|ipod/i.test(navigator.userAgent)
  if (!desktop) return
  try {
    if (localStorage.getItem(WINDOW_KEY)) return
  }
  catch {
    return
  }
  const modes = ['(display-mode: standalone)', '(display-mode: window-controls-overlay)'].map(q => window.matchMedia(q))
  const tryResize = () => {
    if (!modes.some(m => m.matches)) return
    modes.forEach(m => m.removeEventListener('change', tryResize))
    // Recién abierta la ventana el navegador puede ignorar el cambio: se espera a que pinte
    requestAnimationFrame(() => setTimeout(resizeCentered, 50))
  }
  modes.forEach(m => m.addEventListener('change', tryResize))
  tryResize()
}

function resizeCentered() {
  const s: Screen & { availLeft?: number, availTop?: number } = screen
  const w = Math.min(WIDTH, s.availWidth)
  const h = Math.min(HEIGHT, s.availHeight)
  try {
    window.resizeTo(w, h)
    window.moveTo((s.availLeft ?? 0) + Math.round((s.availWidth - w) / 2), (s.availTop ?? 0) + Math.round((s.availHeight - h) / 2))
  }
  catch {
    // El navegador no deja cambiar el tamaño: se queda como lo abra
  }
  // Solo se da por hecho si la ventana cambió de verdad; si no, se reintenta en el próximo arranque
  setTimeout(() => {
    if (Math.abs(window.outerWidth - w) > 16 || Math.abs(window.outerHeight - h) > 16) return
    try {
      localStorage.setItem(WINDOW_KEY, '1')
    }
    catch {
      // Sin almacenamiento: volverá a ajustarse al abrir, que es lo esperado igualmente
    }
  }, 300)
}
