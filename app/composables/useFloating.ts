import type { CSSProperties, MaybeRefOrGetter, Ref } from 'vue'
import { useEventListener } from '@vueuse/core'

export interface FloatingOptions {
  /** Borde del ancla con el que se alinea el panel */
  align?: MaybeRefOrGetter<'start' | 'end' | undefined>
  /** Ancho del panel; sin él, el del ancla */
  width?: MaybeRefOrGetter<number | undefined>
  /** Preferir abrir hacia arriba (p. ej. el menú de usuario al pie de la barra lateral) */
  up?: MaybeRefOrGetter<boolean | undefined>
  /** Separación con el ancla */
  gap?: number
}

/**
 * Panel flotante (menú, desplegable) pegado a su ancla con posición fija; el componente lo lleva a
 * <body> con Teleport. Así no lo tapa una tarjeta animada que viene después, no lo recorta el scroll
 * de un modal y queda por encima de los modales. Se abre hacia arriba si abajo no cabe y nunca se
 * sale de la pantalla. `--float-max` es el alto disponible (para limitar el panel con scroll).
 */
export function useFloating(anchor: Ref<HTMLElement | undefined>, panel: Ref<HTMLElement | undefined>, open: Ref<boolean>, opts: FloatingOptions = {}) {
  const style = ref<CSSProperties>({})
  const placedUp = ref(false)
  const MARGIN = 8
  let tokens: Record<string, string> = {}

  // Colores propios del sitio del ancla (p. ej. la hoja de la factura, siempre clara): en <body> se perderían
  function localTokens() {
    const el = anchor.value
    if (!el) return {}
    const local = getComputedStyle(el)
    const global = getComputedStyle(document.documentElement)
    const out: Record<string, string> = {}
    for (const t of TOKENS) {
      const v = local.getPropertyValue(t)
      if (v && v !== global.getPropertyValue(t)) out[t] = v
    }
    if (local.colorScheme !== global.colorScheme) out.colorScheme = local.colorScheme
    return out
  }

  function update() {
    const a = anchor.value?.getBoundingClientRect()
    if (!a) return
    const gap = opts.gap ?? 6
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const width = Math.min(toValue(opts.width) ?? a.width, vw - MARGIN * 2)
    const height = panel.value?.offsetHeight ?? 0
    const below = vh - a.bottom - gap - MARGIN
    const above = a.top - gap - MARGIN
    const up = toValue(opts.up) ? above >= height || above > below : height > below && above > below
    const left = Math.max(MARGIN, Math.min(toValue(opts.align) === 'end' ? a.right - width : a.left, vw - width - MARGIN))
    placedUp.value = up
    style.value = {
      ...tokens,
      position: 'fixed',
      left: `${Math.round(left)}px`,
      width: `${Math.round(width)}px`,
      '--float-max': `${Math.max(140, Math.floor(up ? above : below))}px`,
      ...(up ? { top: 'auto', bottom: `${Math.round(vh - a.top + gap)}px` } : { top: `${Math.round(a.bottom + gap)}px`, bottom: 'auto' }),
    } as CSSProperties
  }

  // Al abrir: primero junto al ancla y, ya pintado, con su alto real (para decidir si va arriba)
  watch(open, async (v) => {
    if (!v) return
    tokens = localTokens()
    update()
    await nextTick()
    update()
  }, { flush: 'post' })

  let frame = 0
  function follow() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(update)
  }
  // Solo mientras está abierto: el scroll de cualquier contenedor (captura) y el tamaño de la ventana
  useEventListener(() => (open.value ? window : null), 'scroll', follow, { capture: true, passive: true })
  useEventListener(() => (open.value ? window : null), 'resize', follow, { passive: true })

  return { style, placedUp, update }
}

const TOKENS = Object.freeze(['--surface', '--surface-2', '--surface-hover', '--surface-active', '--border', '--border-subtle', '--border-strong', '--text', '--text-2', '--text-3', '--text-4', '--brand-text', '--brand-soft'])
