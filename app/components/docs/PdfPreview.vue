<script setup lang="ts">
import * as pdfjsLib from 'pdfjs-dist'

const props = defineProps<{
  data?: ArrayBuffer | Uint8Array | null
  url?: string | null
  label?: string
}>()

const emit = defineEmits<{
  error: []
  loaded: [pages: number]
}>()

const containerRef = ref<HTMLElement | null>(null)
const pagesWrapRef = ref<HTMLElement | null>(null)
const loading = ref(true)
const pageCount = ref(1)
const currentPage = ref(1)

let activeDoc: any = null
let renderTicket = 0
let resizeObserver: ResizeObserver | null = null
let lastContainerWidth = 0
let lastContainerHeight = 0

const canvasRefs = new Map<number, HTMLCanvasElement>()
const pageRefs = new Map<number, HTMLElement>()

function setCanvasRef(el: any, num: number) {
  if (el) canvasRefs.set(num, el as HTMLCanvasElement)
  else canvasRefs.delete(num)
}

function setPageRef(el: any, num: number) {
  if (el) pageRefs.set(num, el as HTMLElement)
  else pageRefs.delete(num)
}

// Inicializar el worker una sola vez
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
}

async function loadAndRender() {
  const ticket = ++renderTicket
  if (!activeDoc) {
    loading.value = true
  }

  // Liberar documento previo
  if (activeDoc) {
    try {
      activeDoc.destroy()
    }
    catch {}
    activeDoc = null
  }

  if (!props.data && !props.url) {
    loading.value = false
    return
  }

  try {
    const loadingTask = pdfjsLib.getDocument(
      props.data
        ? { data: props.data, cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/', cMapPacked: true }
        : { url: props.url!, cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/cmaps/', cMapPacked: true },
    )

    const doc = await loadingTask.promise
    if (ticket !== renderTicket) return

    activeDoc = doc
    pageCount.value = doc.numPages
    currentPage.value = 1
    emit('loaded', doc.numPages)

    // Esperar a que el DOM monte los contenedores de páginas
    await nextTick()
    if (ticket !== renderTicket) return

    await renderPages(ticket)
  }
  catch (err) {
    if (ticket === renderTicket) {
      console.error('Error cargando PDF:', err)
      emit('error')
    }
  }
  finally {
    if (ticket === renderTicket) {
      loading.value = false
    }
  }
}

async function renderPages(ticket: number) {
  if (!activeDoc || !containerRef.value) return

  const container = containerRef.value
  const cw = container.clientWidth
  const ch = container.clientHeight
  lastContainerWidth = cw
  lastContainerHeight = ch

  if (cw <= 0 || ch <= 0) return

  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2.5)

  // Tomar la primera página como referencia de escala
  const firstPage = await activeDoc.getPage(1)
  if (ticket !== renderTicket) return
  const unscaled = firstPage.getViewport({ scale: 1 })

  let targetScale = 1
  if (pageCount.value <= 1) {
    // 1 sola página: DEBE verse completa sin scrollbar, un poco más pequeña con margen cómodo
    const padX = 40
    const padY = 40
    const availW = Math.max(80, cw - padX)
    const availH = Math.max(80, ch - padY)
    const fitScale = Math.min(availW / unscaled.width, availH / unscaled.height)
    // Reducir al 90% para que entre holgadamente en el diseño de la app, con aire alrededor y sin scrollbar
    targetScale = Math.max(0.15, fitScale * 0.90)
  }
  else {
    // Múltiples páginas: encajar al ancho para permitir lectura cómoda con scroll vertical
    const padX = 32
    const availW = Math.max(80, cw - padX)
    targetScale = (availW / unscaled.width) * 0.96
  }

  // Renderizar secuencialmente cada página
  for (let i = 1; i <= pageCount.value; i++) {
    if (ticket !== renderTicket) break
    const canvas = canvasRefs.get(i)
    if (!canvas) continue

    const page = i === 1 ? firstPage : await activeDoc.getPage(i)
    if (ticket !== renderTicket) break

    const viewport = page.getViewport({ scale: targetScale })
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) continue
    ctx.scale(dpr, dpr)

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise
  }
}

function onScroll() {
  if (pageCount.value <= 1 || !containerRef.value) return
  const cRect = containerRef.value.getBoundingClientRect()
  const midY = cRect.top + cRect.height / 2

  let closest = 1
  let minDiff = Infinity

  for (const [num, el] of pageRefs.entries()) {
    const r = el.getBoundingClientRect()
    const pageMid = r.top + r.height / 2
    const diff = Math.abs(pageMid - midY)
    if (diff < minDiff) {
      minDiff = diff
      closest = num
    }
  }
  currentPage.value = closest
}

function scrollToPage(p: number) {
  const target = Math.max(1, Math.min(pageCount.value, p))
  currentPage.value = target
  const el = pageRefs.get(target)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined
function onContainerResize() {
  if (!containerRef.value || loading.value) return
  const cw = containerRef.value.clientWidth
  const ch = containerRef.value.clientHeight
  // Solo re-renderizar si hubo un cambio apreciable (> 6px) para evitar jitter
  if (Math.abs(cw - lastContainerWidth) > 6 || Math.abs(ch - lastContainerHeight) > 6) {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      renderPages(renderTicket)
    }, 150)
  }
}

watch(() => [props.data, props.url] as const, () => {
  loadAndRender()
}, { immediate: true })

onMounted(() => {
  if (containerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(onContainerResize)
    resizeObserver.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  renderTicket++
  clearTimeout(resizeTimer)
  resizeObserver?.disconnect()
  if (activeDoc) {
    try {
      activeDoc.destroy()
    }
    catch {}
    activeDoc = null
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="pdf-viewer"
    :class="{ 'is-single': pageCount <= 1, 'is-multi': pageCount > 1 }"
    :aria-label="label ?? 'Documento PDF'"
    @scroll.passive="onScroll"
  >
    <div v-if="loading" class="pdf-loading">
      <div class="skeleton-shimmer" />
    </div>

    <div
      v-show="!loading"
      ref="pagesWrapRef"
      class="pages-wrap"
      :class="{ 'is-single': pageCount <= 1 }"
    >
      <div
        v-for="pageIndex in pageCount"
        :key="pageIndex"
        :ref="(el) => setPageRef(el, pageIndex)"
        class="page-card"
        :data-page="pageIndex"
      >
        <canvas :ref="(el) => setCanvasRef(el, pageIndex)" class="page-canvas" />
      </div>
    </div>

    <!-- Navegación discreta flotante: SOLO cuando hay más de una página -->
    <Transition name="pill-fade">
      <div v-if="!loading && pageCount > 1" class="pdf-nav-pill">
        <button
          type="button"
          class="p-btn"
          :disabled="currentPage <= 1"
          title="Página anterior"
          aria-label="Página anterior"
          @click="scrollToPage(currentPage - 1)"
        >
          <Icon name="ph:caret-left-bold" />
        </button>
        <span class="p-num">{{ currentPage }} / {{ pageCount }}</span>
        <button
          type="button"
          class="p-btn"
          :disabled="currentPage >= pageCount"
          title="Página siguiente"
          aria-label="Página siguiente"
          @click="scrollToPage(currentPage + 1)"
        >
          <Icon name="ph:caret-right-bold" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.pdf-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: var(--surface-2);
  user-select: none;
}

/* 1 SOLA PÁGINA: Sin scrollbar bajo ningún concepto, centrada con aire */
.pdf-viewer.is-single {
  overflow: hidden !important;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pdf-viewer.is-single .pages-wrap {
  width: 100%;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  max-width: 100%;
  padding: 12px;
  overflow: hidden !important;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* MÁS DE 1 PÁGINA: Scroll vertical suave con scrollbar muy discreta */
.pdf-viewer.is-multi {
  overflow-y: auto !important;
  overflow-x: hidden;
  /* Scrollbar nativa discreta para Firefox */
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--text-3) 30%, transparent) transparent;
}

/* Scrollbar personalizada y discreta para Chromium / Webkit */
.pdf-viewer.is-multi::-webkit-scrollbar {
  width: 6px;
}

.pdf-viewer.is-multi::-webkit-scrollbar-track {
  background: transparent;
}

.pdf-viewer.is-multi::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text-3) 25%, transparent);
  border-radius: 999px;
  transition: background var(--t-fast);
}

.pdf-viewer.is-multi::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-3) 55%, transparent);
}

.pdf-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
}

.skeleton-shimmer {
  width: 75%;
  height: 85%;
  background: var(--surface-3);
  border-radius: var(--r-md);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 0.3; }
}

.pages-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 16px 12px 28px;
  width: 100%;
  min-height: 100%;
}

.pages-wrap.is-single {
  padding: 12px;
  justify-content: center;
  align-items: center;
  min-height: 100%;
  height: 100%;
  max-height: 100%;
  overflow: hidden !important;
}

.page-card {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border-radius: var(--r-sm);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 8px 24px -4px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  line-height: 0;
  transition: transform var(--t-fast);
  flex-shrink: 0;
}

.page-canvas {
  display: block;
}

/* Píldora de navegación flotante discreta */
.pdf-nav-pill {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  box-shadow: var(--shadow-md);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-2);
  user-select: none;
}

.p-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 13px;
  color: var(--text-2);
  background: transparent;
  border: 0;
  border-radius: var(--r-full);
  cursor: pointer;
  transition: all var(--t-fast);
}

.p-btn:hover:not(:disabled) {
  color: var(--brand-text);
  background: var(--surface-hover);
}

.p-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.p-num {
  padding: 0 4px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.pill-fade-enter-active,
.pill-fade-leave-active {
  transition: all 180ms var(--ease-out);
}

.pill-fade-enter-from,
.pill-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 6px);
}
</style>
