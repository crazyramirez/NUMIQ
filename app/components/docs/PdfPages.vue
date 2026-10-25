<script setup lang="ts">
import * as pdfjsLib from 'pdfjs-dist'

/**
 * PDF del visor: páginas a tamaño real con zoom, texto seleccionable y pintado solo de lo que se ve.
 * Una página se ajusta entera a la pantalla; varias, al ancho (con un máximo cómodo de lectura).
 */
const props = defineProps<{ data: ArrayBuffer, label?: string }>()
const emit = defineEmits<{ loaded: [pages: number], page: [page: number], error: [] }>()
const zoom = defineModel<number>('zoom', { default: 1 })

if (import.meta.client && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

const stage = ref<HTMLElement>()
const wrap = ref<HTMLElement>()
const loading = ref(true)
const sizes = shallowRef<{ w: number, h: number }[]>([])
const box = reactive({ w: 0, h: 0 })
const current = ref(1)

const { pinching } = useZoomStage(stage, wrap, zoom, { min: 0.25, max: 5, wheel: 'ctrl' })

const base = computed(() => {
  const first = sizes.value[0]
  if (!first || !box.w) return 1
  const pad = box.w < 640 ? 20 : 64
  if (sizes.value.length === 1) return Math.max(0.1, Math.min((box.w - pad) / first.w, (box.h - pad) / first.h))
  const widest = Math.max(...sizes.value.map(s => s.w))
  return Math.max(0.1, Math.min((box.w - pad) / widest, 940 / widest))
})
const scale = computed(() => base.value * zoom.value)

let doc: any = null
// pdf.js 6: se libera con la tarea de carga (el documento ya no tiene destroy)
let loadingTask: { destroy: () => Promise<void> } | null = null
let ticket = 0
const pageEls: HTMLElement[] = []
const rendered = new Map<number, { scale: number, pending?: number, task?: any }>()
const visible = new Set<number>()
let io: IntersectionObserver | null = null
let ro: ResizeObserver | null = null

function setPageEl(el: unknown, i: number) {
  if (el) pageEls[i] = el as HTMLElement
}

async function load() {
  const t = ++ticket
  loading.value = true
  rendered.forEach(r => r.task?.cancel?.())
  rendered.clear()
  visible.clear()
  sizes.value = []
  loadingTask?.destroy().catch(() => {})
  loadingTask = null
  doc = null
  try {
    // pdf.js se queda con el búfer: se le pasa una copia para poder volver a abrir el mismo archivo
    const task = pdfjsLib.getDocument({
      data: new Uint8Array(props.data.slice(0)),
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/',
      cMapPacked: true,
    })
    loadingTask = task
    const d = await task.promise
    if (t !== ticket) return
    doc = d
    const list: { w: number, h: number }[] = []
    for (let i = 1; i <= d.numPages; i++) {
      const vp = (await d.getPage(i)).getViewport({ scale: 1 })
      if (t !== ticket) return
      list.push({ w: vp.width, h: vp.height })
    }
    sizes.value = list
    current.value = 1
    emit('loaded', d.numPages)
    emit('page', 1)
    loading.value = false
    await nextTick()
    observe()
  }
  catch {
    if (t === ticket) emit('error')
  }
}

function observe() {
  io?.disconnect()
  if (!stage.value) return
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const i = Number((e.target as HTMLElement).dataset.i)
      if (e.isIntersecting) {
        visible.add(i)
        paint(i)
      }
      else visible.delete(i)
    }
  }, { root: stage.value, rootMargin: '900px 0px' })
  pageEls.slice(0, sizes.value.length).forEach(el => el && io!.observe(el))
}

async function paint(i: number) {
  const s = scale.value
  const state = rendered.get(i)
  if (!doc || state?.scale === s || state?.pending === s) return
  state?.task?.cancel?.()
  const t = ticket
  const entry: { scale: number, pending?: number, task?: any } = { scale: state?.scale ?? -1, pending: s }
  rendered.set(i, entry)
  try {
    const page = await doc.getPage(i + 1)
    if (t !== ticket || scale.value !== s) return
    const vp = page.getViewport({ scale: s })
    // Lienzo nuevo fuera de pantalla: el anterior se queda (estirado) hasta que el nuevo está listo
    const canvas = document.createElement('canvas')
    let ratio = Math.min(window.devicePixelRatio || 1, 2)
    const maxPx = 14_000_000
    if (vp.width * vp.height * ratio * ratio > maxPx) ratio = Math.sqrt(maxPx / (vp.width * vp.height))
    canvas.width = Math.floor(vp.width * ratio)
    canvas.height = Math.floor(vp.height * ratio)
    entry.task = page.render({ canvas, viewport: vp, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
    await entry.task.promise
    if (t !== ticket || scale.value !== s) return
    const host = pageEls[i]
    if (!host) return
    const old = host.querySelector('canvas')
    if (old) old.replaceWith(canvas)
    else host.prepend(canvas)
    entry.scale = s
    entry.pending = undefined

    const text = host.querySelector<HTMLElement>('.textLayer')
    if (text) {
      text.replaceChildren()
      text.style.setProperty('--total-scale-factor', String(s))
      await new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: vp }).render()
    }
  }
  catch {
    // Pintado cancelado por un zoom o un cambio de documento
    if (entry.pending === s) entry.pending = undefined
  }
}

// Zoom o tamaño nuevo: se repintan las páginas a la vista (el resto al acercarse a ellas)
let repaintTimer: ReturnType<typeof setTimeout> | undefined
watch(scale, () => {
  clearTimeout(repaintTimer)
  repaintTimer = setTimeout(() => visible.forEach(i => paint(i)), 90)
})

function onScroll() {
  const el = stage.value
  if (!el || sizes.value.length < 2) return
  const mid = el.getBoundingClientRect().top + el.clientHeight / 2
  let best = 1
  let bestDiff = Infinity
  for (let i = 0; i < sizes.value.length; i++) {
    const r = pageEls[i]?.getBoundingClientRect()
    if (!r) continue
    const diff = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid))
    if (diff < bestDiff) {
      bestDiff = diff
      best = i + 1
    }
  }
  if (best !== current.value) {
    current.value = best
    emit('page', best)
  }
}

function goTo(page: number) {
  const n = Math.max(1, Math.min(sizes.value.length, page))
  const el = pageEls[n - 1]
  if (!el || !stage.value) return
  stage.value.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' })
}

defineExpose({ goTo })

watch(() => props.data, load, { immediate: true })

onMounted(() => {
  ro = new ResizeObserver(() => {
    if (!stage.value) return
    box.w = stage.value.clientWidth
    box.h = stage.value.clientHeight
  })
  if (stage.value) ro.observe(stage.value)
})

onBeforeUnmount(() => {
  ticket++
  clearTimeout(repaintTimer)
  io?.disconnect()
  ro?.disconnect()
  rendered.forEach(r => r.task?.cancel?.())
  loadingTask?.destroy().catch(() => {})
  loadingTask = null
  doc = null
})
</script>

<template>
  <div ref="stage" class="pdf-stage" :class="{ single: sizes.length === 1 }" :aria-label="label ?? 'Documento PDF'" @scroll.passive="onScroll">
    <div v-if="loading" class="pdf-wait" aria-hidden="true">
      <div class="ghost-page"><span v-for="n in 7" :key="n" class="ghost-line" :style="{ width: `${[72, 54, 88, 64, 80, 40, 70][n - 1]}%` }" /></div>
    </div>
    <div v-else ref="wrap" class="pdf-wrap" :class="{ pinching }">
      <div
        v-for="(s, i) in sizes"
        :key="i"
        :ref="el => setPageEl(el, i)"
        class="pg"
        :data-i="i"
        :style="{ width: `${Math.floor(s.w * scale)}px`, height: `${Math.floor(s.h * scale)}px` }"
      >
        <div class="textLayer" />
        <slot name="page" :index="i" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-stage {
  position: absolute;
  inset: 0;
  display: flex;
  overflow: auto;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
}

.pdf-stage::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.pdf-stage::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.pdf-stage::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.36);
}

.pdf-stage::-webkit-scrollbar-track,
.pdf-stage::-webkit-scrollbar-corner {
  background: transparent;
}

/* margin auto: centrado si cabe y scroll completo (sin recortes) cuando es más grande */
.pdf-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  margin: auto;
  padding: 32px 32px 88px;
  transform-origin: 0 0;
}

.single .pdf-wrap {
  padding-bottom: 32px;
}

.pdf-wrap.pinching {
  will-change: transform;
}

.pg {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  background: #fff;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.18), 0 18px 48px -12px rgba(0, 0, 0, 0.55);
}

.pg :deep(canvas) {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.pdf-wait {
  display: grid;
  place-items: center;
  width: 100%;
  padding: 32px;
}

.ghost-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(560px, 82vw);
  aspect-ratio: 1 / 1.414;
  max-height: 78vh;
  padding: 9% 8%;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  animation: ghost 1.4s ease-in-out infinite;
}

.ghost-line {
  height: 10px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
}

.ghost-line:first-child {
  height: 18px;
  margin-bottom: 18px;
}

@keyframes ghost {
  50% { opacity: 0.55; }
}

@media (max-width: 640px) {
  .pdf-wrap {
    gap: 12px;
    padding: 12px 10px 84px;
  }
}

/* Capa de texto de pdf.js (selección y copia); estilos mínimos de pdf_viewer.css */
.pg :deep(.textLayer) {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: clip;
  line-height: 1;
  text-align: initial;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}

.pg :deep(.textLayer :is(span, br)) {
  position: absolute;
  color: transparent;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}

.pg :deep(.textLayer > :not(.markedContent)),
.pg :deep(.textLayer .markedContent span:not(.markedContent)) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}

.pg :deep(.textLayer .markedContent) {
  display: contents;
}

.pg :deep(.textLayer ::selection) {
  color: transparent;
  background: color-mix(in srgb, var(--brand) 32%, transparent);
}

.pg :deep(.textLayer br::selection) {
  background: transparent;
}

.pg :deep(.textLayer .endOfContent) {
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  display: block;
  cursor: default;
  user-select: none;
}

.pg :deep(.textLayer.selecting .endOfContent) {
  top: 0;
}
</style>
