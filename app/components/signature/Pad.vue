<script setup lang="ts">
/**
 * Lienzo para firmar con el ratón, el dedo o un lápiz. El trazo cambia de grosor como la tinta: más fino
 * cuanto más rápido (o según la presión del lápiz) y suavizado con curvas. Siempre sobre papel blanco,
 * también en el tema oscuro: la firma acaba sobre documentos blancos.
 */
interface Pt { x: number, y: number, w: number }
interface Stroke { points: Pt[] }

const props = withDefaults(defineProps<{ color: string, thickness?: number }>(), { thickness: 1 })
const emit = defineEmits<{ change: [strokes: number] }>()

const box = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const strokes = shallowRef<Stroke[]>([])
const drawing = ref(false)
const size = reactive({ w: 0, h: 0 })
let ratio = 2

const BASE = 2.6
const inked = computed(() => strokes.value.length > 0)

function ctx2d() {
  return canvas.value?.getContext('2d') ?? null
}

/** Curva cuadrática de a a b con control c, rellenada con círculos de grosor interpolado */
function curve(ctx: CanvasRenderingContext2D, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w0: number, w1: number, k: number) {
  const len = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy)
  const steps = Math.max(1, Math.ceil(len / 0.6))
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1
    const r = ((w0 + (w1 - w0) * t) * k) / 2
    ctx.moveTo(x + r, y)
    ctx.arc(x, y, r, 0, Math.PI * 2)
  }
  ctx.fill()
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2 })

/** Tramo nuevo de un trazo: del punto medio anterior al siguiente, con el penúltimo punto de control */
function drawTail(ctx: CanvasRenderingContext2D, pts: Pt[], k: number, final = false) {
  const n = pts.length
  if (n === 1) {
    if (final) curve(ctx, pts[0]!.x, pts[0]!.y, pts[0]!.x, pts[0]!.y, pts[0]!.x, pts[0]!.y, pts[0]!.w * 1.1, pts[0]!.w * 1.1, k)
    return
  }
  if (n === 2) {
    const m = mid(pts[0]!, pts[1]!)
    curve(ctx, pts[0]!.x, pts[0]!.y, pts[0]!.x, pts[0]!.y, m.x, m.y, pts[0]!.w, m.w, k)
  }
  else {
    const a = mid(pts[n - 3]!, pts[n - 2]!)
    const c = pts[n - 2]!
    const b = mid(pts[n - 2]!, pts[n - 1]!)
    curve(ctx, a.x, a.y, c.x, c.y, b.x, b.y, a.w, b.w, k)
  }
  if (final) {
    const m = mid(pts[n - 2]!, pts[n - 1]!)
    const last = pts[n - 1]!
    curve(ctx, m.x, m.y, m.x, m.y, last.x, last.y, m.w, last.w, k)
  }
}

function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, k: number) {
  for (let i = 1; i <= s.points.length; i++) drawTail(ctx, s.points.slice(0, i), k, i === s.points.length)
}

function redraw() {
  const ctx = ctx2d()
  if (!ctx || !canvas.value) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.fillStyle = props.color
  for (const s of strokes.value) paintStroke(ctx, s, props.thickness)
}

function resize() {
  const el = box.value
  const c = canvas.value
  if (!el || !c) return
  size.w = el.clientWidth
  size.h = el.clientHeight
  ratio = Math.min(3, Math.max(2, window.devicePixelRatio || 1))
  c.width = Math.round(size.w * ratio)
  c.height = Math.round(size.h * ratio)
  redraw()
}

// ─── Trazo ───
let current: Stroke | null = null
let last: { x: number, y: number, t: number, v: number, w: number } | null = null
let pointerId: number | null = null

function pointFrom(e: PointerEvent): Pt {
  const r = canvas.value!.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  const t = e.timeStamp
  let w: number
  if (e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5) {
    w = BASE * (0.35 + e.pressure * 1.05)
  }
  else {
    // Velocidad suavizada (px/ms): rápido = más fino, como una pluma
    const dt = last ? Math.max(1, t - last.t) : 16
    const dist = last ? Math.hypot(x - last.x, y - last.y) : 0
    const v = last ? last.v * 0.6 + (dist / dt) * 0.4 : 0
    const target = BASE * Math.min(1.3, Math.max(0.42, 1.3 - v * 0.42))
    w = last ? last.w * 0.55 + target * 0.45 : BASE * 1.05
    last = { x, y, t, v, w }
    return { x, y, w }
  }
  last = { x, y, t, v: 0, w }
  return { x, y, w }
}

function onDown(e: PointerEvent) {
  if (pointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return
  e.preventDefault()
  pointerId = e.pointerId
  canvas.value?.setPointerCapture(e.pointerId)
  last = null
  current = { points: [pointFrom(e)] }
  drawing.value = true
}

function onMove(e: PointerEvent) {
  if (!current || e.pointerId !== pointerId) return
  e.preventDefault()
  const ctx = ctx2d()
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.fillStyle = props.color
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e]
  for (const ev of events.length ? events : [e]) {
    const p = pointFrom(ev)
    const prev = current.points.at(-1)!
    // Puntos casi encima del anterior no aportan nada y ensucian la curva
    if (Math.hypot(p.x - prev.x, p.y - prev.y) < 0.8) continue
    current.points.push(p)
    drawTail(ctx, current.points, props.thickness)
  }
}

function onUp(e: PointerEvent) {
  if (!current || e.pointerId !== pointerId) return
  const ctx = ctx2d()
  if (ctx) {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = props.color
    drawTail(ctx, current.points, props.thickness, true)
  }
  strokes.value = [...strokes.value, current]
  current = null
  pointerId = null
  drawing.value = false
  emit('change', strokes.value.length)
}

function undo() {
  if (!strokes.value.length) return
  strokes.value = strokes.value.slice(0, -1)
  redraw()
  emit('change', strokes.value.length)
}

function clear() {
  strokes.value = []
  redraw()
  emit('change', 0)
}

/** PNG transparente recortado a la firma, a 3× para que se vea nítida al imprimir */
async function toCanvas() {
  if (!strokes.value.length) return null
  const k = 3
  const c = document.createElement('canvas')
  c.width = Math.round(size.w * k)
  c.height = Math.round(size.h * k)
  const ctx = c.getContext('2d')!
  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.fillStyle = props.color
  for (const s of strokes.value) paintStroke(ctx, s, props.thickness)
  const trimmed = trimInk(c, 12)
  return trimmed && fitCanvas(trimmed, SIGNATURE_MAX.w, SIGNATURE_MAX.h)
}

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && strokes.value.length) {
    e.preventDefault()
    e.stopPropagation()
    undo()
  }
}

watch(() => [props.color, props.thickness], redraw)

let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(resize)
  if (box.value) ro.observe(box.value)
})
onBeforeUnmount(() => ro?.disconnect())

defineExpose({ toCanvas, clear, undo, inked })
</script>

<template>
  <div ref="box" class="pad" :class="{ inked, drawing }" tabindex="0" aria-label="Zona de firma: dibuja tu firma con el ratón, el dedo o un lápiz" @keydown="onKey">
    <canvas
      ref="canvas"
      class="pad-canvas"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @lostpointercapture="onUp"
    />
    <div class="guide" aria-hidden="true">
      <span class="x">×</span>
      <span class="line" />
    </div>
    <Transition name="pad-hint">
      <p v-if="!inked && !drawing" class="hint" aria-hidden="true">
        <Icon name="ph:pen-nib" /> Firma aquí
      </p>
    </Transition>
    <div class="pad-tools">
      <button type="button" class="pad-btn" :disabled="!inked" title="Deshacer el último trazo (Ctrl+Z)" aria-label="Deshacer el último trazo" @click="undo">
        <Icon name="ph:arrow-counter-clockwise-bold" />
      </button>
      <button type="button" class="pad-btn" :disabled="!inked" aria-label="Borrar la firma" @click="clear">
        <Icon name="ph:eraser-bold" /><span>Borrar</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pad {
  position: relative;
  height: 230px;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 50% 0%, #fff 0%, #fbfbf8 70%),
    #fbfbf8;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: var(--r-lg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 2px rgba(15, 18, 30, 0.06);
  outline: none;
  cursor: crosshair;
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}

.pad:focus-visible {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.pad-canvas {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.guide {
  position: absolute;
  right: 28px;
  bottom: 52px;
  left: 28px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  color: #a3a8b4;
  pointer-events: none;
}

.x {
  font-size: 22px;
  font-weight: 300;
  line-height: 1;
  transform: translateY(5px);
}

.line {
  flex: 1;
  height: 0;
  border-bottom: 1.5px dashed #d3d6de;
}

.hint {
  position: absolute;
  top: 50%;
  left: 50%;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  color: #9aa0ad;
  white-space: nowrap;
  transform: translate(-50%, -75%);
  pointer-events: none;
}

.hint :deep(svg) {
  font-size: 18px;
}

.pad-hint-enter-active,
.pad-hint-leave-active {
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
}

.pad-hint-enter-from,
.pad-hint-leave-to {
  opacity: 0;
  transform: translate(-50%, -60%);
}

.pad-tools {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--t-fast);
}

.pad.inked:not(.drawing) .pad-tools {
  opacity: 1;
}

.pad-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 9px;
  font-size: 12.5px;
  font-weight: 600;
  color: #4a5060;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #e3e5ea;
  border-radius: 999px;
  box-shadow: 0 1px 3px rgba(15, 18, 30, 0.08);
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.pad-btn:hover:not(:disabled) {
  color: #16181d;
  background: #fff;
}

.pad-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.pad-btn :deep(svg) {
  font-size: 14px;
}

@media (hover: none) {
  .pad-tools {
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .pad {
    height: 200px;
  }

  .guide {
    right: 18px;
    bottom: 44px;
    left: 18px;
  }
}
</style>
