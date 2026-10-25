import type { Directive } from 'vue'
import type { CtxItem, CtxSource, CtxSpec } from '~/composables/useContextMenu'

/**
 * `v-ctx="() => opciones"`: menú contextual propio con el clic derecho, la tecla Menú (o Mayús+F10)
 * y, en pantallas táctiles, la pulsación larga (hoja inferior). El elemento más interior gana:
 * una fila dentro de una tabla con su propio menú abre el de la fila.
 * Se respeta el menú del navegador en campos de texto, con Mayús + clic derecho y cuando la función
 * devuelve null. Si hay texto seleccionado dentro, la primera opción es copiarlo.
 */

interface Bound {
  source: CtxSource
  timer?: ReturnType<typeof setTimeout>
  pressTimer?: ReturnType<typeof setTimeout>
  start?: { x: number, y: number }
  off: () => void
}

const LONG_PRESS = 460
const MOVE_TOLERANCE = 10
const bound = new WeakMap<HTMLElement, Bound>()
// Última pulsación larga que abrió un menú: Android dispara además su propio contextmenu poco después
let pressOpenedAt = 0
let lastTouch = 0
// Tras la pulsación larga, el «clic» que llega al soltar no abre la fila ni cierra la hoja recién abierta
let suppressClickUntil = 0

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

function resolve(source: CtxSource, e: MouseEvent): CtxSpec | null {
  const v = typeof source === 'function' ? source(e) : source
  if (!v) return null
  return Array.isArray(v) ? { items: v } : v
}

function selectedText(el: HTMLElement) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return ''
  const node = sel.anchorNode
  return node && el.contains(node) ? sel.toString().trim() : ''
}

function open(el: HTMLElement, e: MouseEvent, mode: { sheet: boolean, keyboard: boolean, x?: number, y?: number }) {
  const b = bound.get(el)
  if (!b) return false
  const spec = resolve(b.source, e)
  if (!spec) return false
  let items: CtxItem[] = spec.items
  const text = mode.sheet ? '' : selectedText(el)
  if (text) {
    const short = text.replace(/\s+/g, ' ')
    items = [
      { label: 'Copiar', sub: `«${short.length > 34 ? `${short.slice(0, 34)}…` : short}»`, icon: 'ph:copy', keys: [modKey(), 'C'], onClick: () => copyText(text, 'Texto') },
      { divider: true },
      ...items,
    ]
  }
  let x = mode.x ?? e.clientX
  let y = mode.y ?? e.clientY
  if (mode.keyboard) {
    // Con el teclado no hay puntero: el menú sale bajo el elemento enfocado (o el de la directiva)
    const focus = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement : el
    const r = focus.getBoundingClientRect()
    x = r.left + Math.min(32, r.width / 2)
    y = Math.min(r.bottom, window.innerHeight - 40)
  }
  tipSeen()
  return useContextMenu().openAt({ clientX: x, clientY: y }, { ...spec, items }, { sheet: mode.sheet, keyboard: mode.keyboard, target: el })
}

// Consejo una sola vez por dispositivo, la primera vez que aparece algo con menú propio (filas, tarjetas…)
const TIP_KEY = 'numiq-ctx-tip'
let tipTimer: ReturnType<typeof setTimeout> | undefined
function tipSeen() {
  try {
    localStorage.setItem(TIP_KEY, '1')
  }
  catch {}
  clearTimeout(tipTimer)
}
function scheduleTip() {
  try {
    if (tipTimer || localStorage.getItem(TIP_KEY)) return
  }
  catch {
    return
  }
  tipTimer = setTimeout(() => {
    const touch = window.matchMedia('(hover: none)').matches
    useToast().push({
      tone: 'info',
      title: touch ? 'Mantén pulsado para ver más' : 'Nuevo: clic derecho',
      body: touch
        ? 'Deja el dedo sobre una factura, un gasto, un contacto o un día del calendario y verás todas sus acciones.'
        : 'Haz clic derecho sobre una factura, un gasto, un contacto, un día del calendario o un documento y verás sus acciones al momento.',
    }, 9000)
    tipSeen()
  }, 2500)
}

function bind(el: HTMLElement, source: CtxSource) {
  const b: Bound = { source, off: () => {} }

  const onContext = (e: MouseEvent) => {
    if (e.defaultPrevented || e.shiftKey) return
    if ((e.target as Element | null)?.closest?.(EDITABLE)) return
    const pointer = (e as PointerEvent).pointerType
    const touch = pointer === 'touch' || pointer === 'pen' || Date.now() - lastTouch < 900
    // La pulsación larga ya abrió el menú: solo se calla el del navegador
    if (touch && Date.now() - pressOpenedAt < 900) {
      e.preventDefault()
      return
    }
    const keyboard = !touch && (pointer === '' || (pointer === undefined && e.button !== 2))
    if (open(el, e, { sheet: touch, keyboard })) e.preventDefault()
  }

  const cancelPress = () => {
    clearTimeout(b.timer)
    clearTimeout(b.pressTimer)
    b.start = undefined
    el.classList.remove('ctx-press')
  }

  const onTouchStart = (e: TouchEvent) => {
    lastTouch = Date.now()
    // Un elemento interior con su propio menú ya se ha quedado este toque
    const ev = e as TouchEvent & { ctxClaimed?: boolean }
    if (ev.ctxClaimed || e.touches.length > 1) return cancelPress()
    if ((e.target as Element | null)?.closest?.(EDITABLE)) return
    ev.ctxClaimed = true
    const t = e.touches[0]!
    b.start = { x: t.clientX, y: t.clientY }
    b.pressTimer = setTimeout(() => el.classList.add('ctx-press'), 140)
    b.timer = setTimeout(() => {
      const start = b.start
      cancelPress()
      if (!start) return
      const fake = new MouseEvent('contextmenu', { clientX: start.x, clientY: start.y })
      if (open(el, fake, { sheet: true, keyboard: false, x: start.x, y: start.y })) {
        pressOpenedAt = Date.now()
        // Hasta que se levante el dedo (y un instante después) no cuenta ningún clic
        suppressClickUntil = Number.POSITIVE_INFINITY
        navigator.vibrate?.(8)
      }
    }, LONG_PRESS)
  }

  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0]
    if (!b.start || !t) return
    if (Math.hypot(t.clientX - b.start.x, t.clientY - b.start.y) > MOVE_TOLERANCE) cancelPress()
  }

  el.addEventListener('contextmenu', onContext)
  el.addEventListener('touchstart', onTouchStart, { passive: true })
  el.addEventListener('touchmove', onTouchMove, { passive: true })
  el.addEventListener('touchend', cancelPress)
  el.addEventListener('touchcancel', cancelPress)
  el.classList.add('has-ctx')
  if (el.id !== 'main') scheduleTip()
  b.off = () => {
    cancelPress()
    el.removeEventListener('contextmenu', onContext)
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', cancelPress)
    el.removeEventListener('touchcancel', cancelPress)
    el.classList.remove('has-ctx', 'ctx-press', 'ctx-target')
  }
  bound.set(el, b)
}

const ctx: Directive<HTMLElement, CtxSource> = {
  mounted: (el, { value }) => bind(el, value),
  updated: (el, { value }) => {
    const b = bound.get(el)
    if (b) b.source = value
  },
  beforeUnmount: (el) => {
    bound.get(el)?.off()
    bound.delete(el)
  },
  getSSRProps: () => ({}),
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('ctx', ctx)
  if (import.meta.server) return
  window.addEventListener('touchend', () => {
    if (suppressClickUntil === Number.POSITIVE_INFINITY) suppressClickUntil = Date.now() + 450
  }, true)
  window.addEventListener('click', (e) => {
    if (Date.now() > suppressClickUntil) return
    e.preventDefault()
    e.stopImmediatePropagation()
    suppressClickUntil = 0
  }, true)
})
