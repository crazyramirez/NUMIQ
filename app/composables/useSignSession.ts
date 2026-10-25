import type { InjectionKey, Ref } from 'vue'

/** Firma, sello o imagen que se puede colocar en el documento */
export interface StampSource {
  key: string
  /** URL de la imagen (de la firma guardada o un blob local) */
  src: string
  /** Alto / ancho */
  ratio: number
  label: string
  /** Ancho inicial como fracción de la página */
  width?: number
}

export interface Placement {
  id: number
  key: string
  src: string
  ratio: number
  label: string
  page: number
  x: number
  y: number
  w: number
}

const MIN_PX = 28

/**
 * Firmas colocadas sobre el documento abierto en el visor. Las posiciones son fracciones de cada página
 * (sobreviven al zoom). Arrastrar lleva la firma también a otra página; las esquinas cambian el tamaño
 * sin deformarla; todo se puede deshacer.
 */
export function createSignSession(root: Ref<HTMLElement | undefined>) {
  const placements = ref<Placement[]>([])
  const selected = ref<number | null>(null)
  const active = ref<'move' | 'resize' | null>(null)
  const past: Placement[][] = []
  const future: Placement[][] = []
  const canUndo = ref(false)
  const canRedo = ref(false)
  let seq = 0

  const snapshot = () => placements.value.map(p => ({ ...p }))
  function remember() {
    past.push(snapshot())
    if (past.length > 80) past.shift()
    future.length = 0
    canUndo.value = true
    canRedo.value = false
  }
  function undo() {
    const prev = past.pop()
    if (!prev) return
    future.push(snapshot())
    placements.value = prev
    if (!prev.some(p => p.id === selected.value)) selected.value = null
    canUndo.value = past.length > 0
    canRedo.value = true
  }
  function redo() {
    const next = future.pop()
    if (!next) return
    past.push(snapshot())
    placements.value = next
    canUndo.value = true
    canRedo.value = future.length > 0
  }

  const layer = (page: number) => root.value?.querySelector<HTMLElement>(`[data-sign-page="${page}"]`) ?? null
  const layers = () => [...(root.value?.querySelectorAll<HTMLElement>('[data-sign-page]') ?? [])]
  const pageCount = () => layers().length

  /** Alto de la firma como fracción de la página (depende de la forma de cada página) */
  function heightFrac(p: Pick<Placement, 'w' | 'ratio' | 'page'>) {
    const el = layer(p.page)
    if (!el || !el.clientHeight) return p.w * p.ratio
    return (p.w * el.clientWidth * p.ratio) / el.clientHeight
  }

  /** Dentro de su página: ni más grande que ella ni asomando por los bordes */
  function clampInto(p: Placement) {
    // Alto (en fracción de página) por cada unidad de ancho
    const k = heightFrac({ w: 1, ratio: p.ratio, page: p.page })
    p.w = Math.min(p.w, 1, k > 0 ? 1 / k : 1)
    p.x = Math.min(Math.max(0, p.x), Math.max(0, 1 - p.w))
    p.y = Math.min(Math.max(0, p.y), Math.max(0, 1 - p.w * k))
  }

  /**
   * Coloca una firma centrada en un punto de la pantalla (soltada desde la bandeja) o, sin punto, en el
   * centro de lo que se ve de la página indicada. Las siguientes en el mismo sitio se escalonan.
   */
  function add(source: StampSource, page: number, at?: { x: number, y: number }) {
    const el = layer(page)
    if (!el) return null
    const r = el.getBoundingClientRect()
    // Ancho de partida: un 30 % de la página, sin bajar de un tamaño que se pueda agarrar con el dedo
    const w = Math.min(1, Math.max(source.width ?? (source.ratio > 0.5 ? 0.3 * 0.5 / source.ratio : 0.3), 96 / r.width))
    const wPx = w * r.width
    const hPx = wPx * source.ratio
    let cx: number
    let cy: number
    if (at) {
      cx = at.x
      cy = at.y
    }
    else {
      const view = (root.value?.querySelector('.fv-body') ?? el).getBoundingClientRect()
      const top = Math.max(r.top, view.top)
      const bottom = Math.min(r.bottom, view.bottom)
      cx = (Math.max(r.left, view.left) + Math.min(r.right, view.right)) / 2
      cy = bottom > top ? (top + bottom) / 2 : r.top + r.height / 2
    }
    const p: Placement = {
      id: ++seq,
      key: source.key,
      src: source.src,
      ratio: source.ratio,
      label: source.label,
      page,
      x: (cx - r.left - wPx / 2) / r.width,
      y: (cy - r.top - hPx / 2) / r.height,
      w,
    }
    if (!at) {
      for (let i = 0; i < 8 && placements.value.some(q => q.page === p.page && Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01); i++) {
        p.x += 0.03
        p.y += 0.03
      }
    }
    clampInto(p)
    remember()
    placements.value = [...placements.value, p]
    selected.value = p.id
    return p
  }

  function remove(id: number | null = selected.value) {
    if (id == null) return
    remember()
    placements.value = placements.value.filter(p => p.id !== id)
    if (selected.value === id) selected.value = null
  }

  function duplicate(id: number | null = selected.value) {
    const src = placements.value.find(p => p.id === id)
    if (!src) return
    const copy: Placement = { ...src, id: ++seq, x: src.x + 0.03, y: src.y + 0.03 }
    clampInto(copy)
    remember()
    placements.value = [...placements.value, copy]
    selected.value = copy.id
  }

  /** La misma firma, en el mismo sitio, en todas las páginas (iniciales en cada hoja de un contrato) */
  function everyPage(id: number | null = selected.value) {
    const src = placements.value.find(p => p.id === id)
    const n = pageCount()
    if (!src || n < 2) return 0
    const others: Placement[] = []
    for (let page = 0; page < n; page++) {
      if (page === src.page || placements.value.some(p => p.page === page && p.key === src.key && Math.abs(p.x - src.x) < 0.005 && Math.abs(p.y - src.y) < 0.005)) continue
      const p = { ...src, id: ++seq, page }
      clampInto(p)
      others.push(p)
    }
    if (!others.length) return 0
    remember()
    placements.value = [...placements.value, ...others]
    return others.length
  }

  function nudge(dx: number, dy: number) {
    const p = placements.value.find(q => q.id === selected.value)
    const el = p ? layer(p.page) : null
    if (!p || !el) return
    remember()
    const next = { ...p, x: p.x + dx / el.clientWidth, y: p.y + dy / el.clientHeight }
    clampInto(next)
    placements.value = placements.value.map(q => (q.id === p.id ? next : q))
  }

  function clear() {
    placements.value = []
    selected.value = null
    past.length = 0
    future.length = 0
    canUndo.value = false
    canRedo.value = false
  }

  // ─── Mover y redimensionar (escucha en window: la firma puede cambiar de página a mitad del gesto) ───
  type Corner = 'nw' | 'ne' | 'sw' | 'se'
  let gesture: {
    id: number
    pointer: number
    kind: 'move' | 'resize'
    grabX: number
    grabY: number
    startX: number
    startY: number
    corner?: Corner
    anchorX: number
    anchorY: number
    moved: boolean
    before: Placement[]
  } | null = null

  function start(e: PointerEvent, id: number, corner?: Corner) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const p = placements.value.find(q => q.id === id)
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-placement]')
    if (!p || !el) return
    selected.value = id
    const r = el.getBoundingClientRect()
    gesture = {
      id,
      pointer: e.pointerId,
      kind: corner ? 'resize' : 'move',
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
      startX: e.clientX,
      startY: e.clientY,
      corner,
      // Esquina contraria: queda fija al cambiar el tamaño
      anchorX: corner === 'nw' || corner === 'sw' ? r.right : r.left,
      anchorY: corner === 'nw' || corner === 'ne' ? r.bottom : r.top,
      moved: false,
      before: snapshot(),
    }
    active.value = gesture.kind
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }

  function pageAt(x: number, y: number) {
    for (const el of document.elementsFromPoint(x, y)) {
      const page = (el as HTMLElement).dataset?.signPage
      if (page != null) return Number(page)
    }
    return null
  }

  function onMove(e: PointerEvent) {
    const g = gesture
    if (!g || e.pointerId !== g.pointer) return
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 3) return
    g.moved = true
    const p = placements.value.find(q => q.id === g.id)
    if (!p) return
    const next = { ...p }
    if (g.kind === 'move') {
      const page = pageAt(e.clientX, e.clientY) ?? p.page
      const el = layer(page)
      if (!el) return
      const r = el.getBoundingClientRect()
      next.page = page
      next.x = (e.clientX - g.grabX - r.left) / r.width
      next.y = (e.clientY - g.grabY - r.top) / r.height
    }
    else {
      const el = layer(p.page)
      if (!el) return
      const r = el.getBoundingClientRect()
      const dx = Math.abs(e.clientX - g.anchorX)
      const dy = Math.abs(e.clientY - g.anchorY)
      // El tamaño lo marca el eje en el que más se ha estirado, sin deformar la firma
      let wPx = Math.max(MIN_PX, dx, dy / p.ratio)
      const maxW = g.corner === 'nw' || g.corner === 'sw' ? g.anchorX - r.left : r.right - g.anchorX
      const maxH = g.corner === 'nw' || g.corner === 'ne' ? g.anchorY - r.top : r.bottom - g.anchorY
      wPx = Math.min(wPx, maxW, maxH / p.ratio)
      const hPx = wPx * p.ratio
      const left = g.corner === 'nw' || g.corner === 'sw' ? g.anchorX - wPx : g.anchorX
      const top = g.corner === 'nw' || g.corner === 'ne' ? g.anchorY - hPx : g.anchorY
      next.w = wPx / r.width
      next.x = (left - r.left) / r.width
      next.y = (top - r.top) / r.height
    }
    clampInto(next)
    placements.value = placements.value.map(q => (q.id === g.id ? next : q))
  }

  function onUp(e: PointerEvent) {
    const g = gesture
    if (!g || e.pointerId !== g.pointer) return
    gesture = null
    active.value = null
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
    if (g.moved) {
      past.push(g.before)
      future.length = 0
      canUndo.value = true
      canRedo.value = false
    }
  }

  function dispose() {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
    gesture = null
  }

  return { placements, selected, active, canUndo, canRedo, add, remove, duplicate, everyPage, nudge, undo, redo, clear, start, heightFrac, pageCount, dispose }
}

export type SignSession = ReturnType<typeof createSignSession>
export const SIGN_SESSION: InjectionKey<SignSession> = Symbol('sign-session')
