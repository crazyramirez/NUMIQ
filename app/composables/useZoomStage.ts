import type { Ref } from 'vue'

interface ZoomStageOptions {
  min?: number
  max?: number
  /** 'always': la rueda acerca y aleja (imágenes); 'ctrl': solo con Ctrl/⌘ o el pellizco del trackpad (PDF, que se desplaza) */
  wheel?: 'always' | 'ctrl'
  /** Arrastrar con el ratón mueve el contenido ampliado */
  pan?: () => boolean
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Zona con zoom del visor: el contenido se dibuja a su tamaño real dentro de un contenedor con scroll.
 * Al cambiar el zoom se conserva el punto bajo el cursor (o el centro); el pellizco en el móvil se ve en
 * vivo con una transformación y se aplica al soltar.
 */
export function useZoomStage(stage: Ref<HTMLElement | undefined>, content: Ref<HTMLElement | undefined>, zoom: Ref<number>, opts: ZoomStageOptions = {}) {
  const min = opts.min ?? 0.25
  const max = opts.max ?? 5
  const panning = ref(false)
  const pinching = ref(false)
  let anchor: { x: number, y: number } | null = null

  function zoomAt(value: number, x?: number, y?: number) {
    const next = clamp(Math.round(value * 1000) / 1000, min, max)
    if (next === zoom.value) return
    anchor = x != null && y != null ? { x, y } : null
    zoom.value = next
  }

  // Antes de pintar el nuevo tamaño: se mide dónde está el punto de referencia y luego se recoloca el scroll
  watch(zoom, (z, old) => {
    const el = stage.value
    const point = anchor
    anchor = null
    if (!el || !old) return
    const rect = el.getBoundingClientRect()
    const offX = (point?.x ?? rect.left + el.clientWidth / 2) - rect.left
    const offY = (point?.y ?? rect.top + el.clientHeight / 2) - rect.top
    const px = el.scrollLeft + offX
    const py = el.scrollTop + offY
    const k = z / old
    nextTick(() => {
      el.scrollLeft = px * k - offX
      el.scrollTop = py * k - offY
    })
  })

  function onWheel(e: WheelEvent) {
    const ctrl = e.ctrlKey || e.metaKey
    if (!ctrl && opts.wheel !== 'always') return
    e.preventDefault()
    const d = clamp(e.deltaY, -50, 50)
    zoomAt(zoom.value * Math.exp(-d * (ctrl ? 0.01 : 0.006)), e.clientX, e.clientY)
  }

  // Pellizco con dos dedos (eventos táctiles: el navegador ya está desplazando cuando llega el segundo dedo)
  let pinch: { d0: number, x: number, y: number, z0: number, scale: number } | null = null
  const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY)

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 2 || !content.value) return
    const x = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2
    const y = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2
    pinch = { d0: dist(e.touches), x, y, z0: zoom.value, scale: 1 }
    const r = content.value.getBoundingClientRect()
    content.value.style.transformOrigin = `${x - r.left}px ${y - r.top}px`
    pinching.value = true
  }

  function onTouchMove(e: TouchEvent) {
    if (!pinch || e.touches.length !== 2 || !content.value) return
    e.preventDefault()
    pinch.scale = clamp(pinch.z0 * dist(e.touches) / pinch.d0, min, max) / pinch.z0
    content.value.style.transform = `scale(${pinch.scale})`
  }

  function onTouchEnd(e: TouchEvent) {
    if (!pinch || e.touches.length >= 2) return
    const p = pinch
    pinch = null
    pinching.value = false
    if (content.value) {
      content.value.style.transform = ''
      content.value.style.transformOrigin = ''
    }
    zoomAt(p.z0 * p.scale, p.x, p.y)
  }

  // Arrastre con el ratón para mover una imagen ampliada
  let drag: { x: number, y: number, left: number, top: number, id: number } | null = null
  function onPointerDown(e: PointerEvent) {
    const el = stage.value
    if (!el || e.pointerType !== 'mouse' || e.button !== 0 || !opts.pan?.()) return
    if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return
    drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId }
    el.setPointerCapture(e.pointerId)
    panning.value = true
    e.preventDefault()
  }
  function onPointerMove(e: PointerEvent) {
    const el = stage.value
    if (!drag || !el || e.pointerId !== drag.id) return
    el.scrollLeft = drag.left - (e.clientX - drag.x)
    el.scrollTop = drag.top - (e.clientY - drag.y)
  }
  function onPointerUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return
    stage.value?.releasePointerCapture(e.pointerId)
    drag = null
    panning.value = false
  }

  // Safari: sin esto el pellizco amplía toda la página en lugar del documento
  const stopGesture = (e: Event) => e.preventDefault()

  watch(stage, (el, old) => {
    if (old) {
      old.removeEventListener('wheel', onWheel)
      old.removeEventListener('touchstart', onTouchStart)
      old.removeEventListener('touchmove', onTouchMove)
      old.removeEventListener('touchend', onTouchEnd)
      old.removeEventListener('touchcancel', onTouchEnd)
      old.removeEventListener('pointerdown', onPointerDown)
      old.removeEventListener('pointermove', onPointerMove)
      old.removeEventListener('pointerup', onPointerUp)
      old.removeEventListener('pointercancel', onPointerUp)
      old.removeEventListener('gesturestart', stopGesture)
    }
    if (el) {
      el.addEventListener('wheel', onWheel, { passive: false })
      el.addEventListener('touchstart', onTouchStart, { passive: true })
      el.addEventListener('touchmove', onTouchMove, { passive: false })
      el.addEventListener('touchend', onTouchEnd)
      el.addEventListener('touchcancel', onTouchEnd)
      el.addEventListener('pointerdown', onPointerDown)
      el.addEventListener('pointermove', onPointerMove)
      el.addEventListener('pointerup', onPointerUp)
      el.addEventListener('pointercancel', onPointerUp)
      el.addEventListener('gesturestart', stopGesture)
    }
  }, { immediate: true })

  return { zoomAt, panning, pinching }
}
