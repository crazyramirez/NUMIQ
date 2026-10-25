<script setup lang="ts">
import { filePreviewKind } from '#shared/utils/file-preview'
import type { ViewerFile } from '~/composables/useFileViewer'
import type { CtxItem, CtxSpec } from '~/composables/useContextMenu'
import type { StampSource } from '~/composables/useSignSession'

/**
 * Visor de documentos a pantalla completa: PDF (zoom, páginas, texto seleccionable), imágenes (zoom,
 * arrastre, giro), Word, hojas de cálculo y texto. Varios archivos se recorren con flechas, miniaturas o
 * deslizando. Descargar, imprimir y compartir sin salir de la app.
 */
type Kind = 'pdf' | 'image' | 'word' | 'sheet' | 'text' | 'other'
interface Loaded {
  blob: Blob
  objectUrl: string
  name: string
  mime: string
  kind: Kind
  pdf?: ArrayBuffer
  text?: string
}

const { state, close, replace } = useFileViewer()
const toast = useToast()

const root = ref<HTMLElement>()
const closeBtn = ref<HTMLButtonElement>()
const strip = ref<HTMLElement>()
const pdfRef = ref<{ goTo: (page: number) => void } | null>(null)
const imgRef = ref<{ actualSize: () => void } | null>(null)

// ─── Firmar: firmas sobre las páginas, guardadas como copia junto al original ───
const signing = ref(false)
const session = createSignSession(root)
provide(SIGN_SESSION, session)
const studio = ref<{
  handleKey: (e: KeyboardEvent) => boolean
  save: () => Promise<void>
  download: () => Promise<void>
  requestExit: () => void
  place: (s: StampSource, at?: { x: number, y: number }) => void
  busy: 'save' | 'download' | null
  count: number
  sources: StampSource[]
} | null>(null)
const signedFiles = useSignedFiles()

const items = computed(() => state.value.items)
const index = computed(() => state.value.index)
const item = computed<ViewerFile | undefined>(() => items.value[index.value])
const multi = computed(() => items.value.length > 1)

const status = ref<'loading' | 'ready' | 'error'>('loading')
const current = shallowRef<Loaded | null>(null)
const errorText = ref('')
const zoom = ref(1)
const rotation = ref(0)
const pages = ref(0)
const page = ref(1)
const dims = ref<{ w: number, h: number } | null>(null)
const direction = ref<'next' | 'prev'>('next')
const canShare = ref(false)

const cache = new Map<string, Promise<Loaded>>()
const urls = new Set<string>()

const TEXT_EXT = ['txt', 'xml', 'json', 'md', 'log']
function kindOf(name: string, mime: string): Kind {
  const k = filePreviewKind(name, mime)
  if (k !== 'other') return k
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (TEXT_EXT.includes(ext) || /^(text\/plain|text\/xml|application\/xml|application\/json)/.test(mime)) return 'text'
  return 'other'
}

function nameFromHeader(header: string | null) {
  if (!header) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1])
    }
    catch {}
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null
}

async function fetchFile(f: ViewerFile): Promise<Loaded> {
  const res = await $fetch.raw<Blob>(f.url, { responseType: 'blob' })
  const blob = res._data!
  const mime = f.mime || blob.type || res.headers.get('content-type') || ''
  const name = f.name || nameFromHeader(res.headers.get('content-disposition')) || 'Documento'
  const kind = kindOf(name, mime)
  const objectUrl = URL.createObjectURL(blob)
  urls.add(objectUrl)
  return {
    blob,
    objectUrl,
    name,
    mime,
    kind,
    pdf: kind === 'pdf' ? await blob.arrayBuffer() : undefined,
    text: kind === 'text' ? (await blob.slice(0, 2_000_000).text()) : undefined,
  }
}

function get(f: ViewerFile) {
  let p = cache.get(f.url)
  if (!p) {
    p = fetchFile(f)
    cache.set(f.url, p)
    p.catch(() => cache.delete(f.url))
  }
  return p
}

let ticket = 0
async function show() {
  const f = item.value
  if (!f) return
  const t = ++ticket
  zoom.value = 1
  rotation.value = 0
  pages.value = 0
  page.value = 1
  dims.value = null
  canShare.value = false
  status.value = 'loading'
  try {
    const loaded = await get(f)
    if (t !== ticket) return
    current.value = loaded
    status.value = 'ready'
    canShare.value = shareable(loaded)
    // Abierto con «Firmar…»: entra directo en el modo firma
    // (solo se apaga la marca: reasignar el estado volvería a abrir el documento)
    if (state.value.sign) {
      state.value.sign = false
      startSigning()
    }
    // Los vecinos se preparan para que pasar de uno a otro sea instantáneo
    for (const n of [index.value + 1, index.value - 1]) {
      const near = items.value[n]
      if (near && (near.size == null || near.size < 15 * 1024 * 1024)) get(near).catch(() => {})
    }
  }
  catch (err) {
    if (t !== ticket) return
    current.value = null
    errorText.value = errorMessage(err)
    status.value = 'error'
  }
}

function retry() {
  if (item.value) cache.delete(item.value.url)
  show()
}

function go(i: number) {
  const n = items.value.length
  if (n < 2 || signing.value) return
  const next = (i + n) % n
  direction.value = i > index.value ? 'next' : 'prev'
  state.value = { ...state.value, index: next }
}

// ─── Datos de la barra ───
const name = computed(() => current.value?.name ?? item.value?.name ?? 'Documento')
const kind = computed<Kind>(() => current.value?.kind ?? kindOf(item.value?.name ?? '', item.value?.mime ?? ''))
const KIND: Record<Kind, { label: string, icon: string, tone: string }> = {
  pdf: { label: 'PDF', icon: 'ph:file-pdf-fill', tone: 'pdf' },
  image: { label: 'Imagen', icon: 'ph:image-fill', tone: 'img' },
  word: { label: 'Word', icon: 'ph:file-doc-fill', tone: 'doc' },
  sheet: { label: 'Hoja de cálculo', icon: 'ph:file-xls-fill', tone: 'xls' },
  text: { label: 'Texto', icon: 'ph:file-text-fill', tone: 'txt' },
  other: { label: 'Archivo', icon: 'ph:file-fill', tone: 'other' },
}
const kindInfo = computed(() => KIND[kind.value])
const ext = computed(() => name.value.includes('.') ? name.value.split('.').pop()!.toUpperCase() : '')
const meta = computed(() => {
  const parts: string[] = [kind.value === 'other' && ext.value ? ext.value : kindInfo.value.label]
  const size = current.value?.blob.size ?? item.value?.size
  if (size) parts.push(fileSize(size))
  if (pages.value > 1) parts.push(`${pages.value} páginas`)
  if (dims.value) parts.push(`${dims.value.w} × ${dims.value.h}`)
  if (item.value?.date) parts.push(fdate(item.value.date))
  return parts.join(' · ')
})

const signable = computed(() => status.value === 'ready' && !!current.value && (kind.value === 'pdf' || kind.value === 'image'))

function startSigning() {
  if (!signable.value) return
  rotation.value = 0
  session.clear()
  signing.value = true
}

function stopSigning() {
  signing.value = false
  session.clear()
}

// Copia firmada guardada: el visor pasa a mostrarla y las vistas que listan archivos se recargan
function onSigned(file: { id: number, originalName: string, mime: string, size: number, createdAt: string }) {
  const from = item.value?.fileId ?? 0
  const next = storedFile(file)
  stopSigning()
  // Copia firmada actualizada: misma dirección, contenido nuevo
  cache.delete(next.url)
  replace(index.value, next)
  signedFiles.value = { from, file: file.id }
  refreshNuxtData()
}

const zoomable = computed(() => status.value === 'ready' && (kind.value === 'pdf' || kind.value === 'image'))
const printable = computed(() => status.value === 'ready' && (kind.value === 'pdf' || kind.value === 'image'))
const pct = computed(() => `${Math.round(zoom.value * 100)} %`)
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8]
const maxZoom = computed(() => (kind.value === 'image' ? 8 : 5))
function zoomStep(dir: 1 | -1) {
  const z = zoom.value
  const next = dir > 0 ? STEPS.find(s => s > z + 0.001) : [...STEPS].reverse().find(s => s < z - 0.001)
  if (next) zoom.value = Math.min(maxZoom.value, next)
}

const downloadHref = computed(() => current.value?.objectUrl ?? item.value?.downloadUrl ?? item.value?.url)

function shareable(l: Loaded) {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([l.blob], l.name, { type: l.mime })] })
  }
  catch {
    return false
  }
}

async function share() {
  const l = current.value
  if (!l) return
  try {
    await navigator.share({ files: [new File([l.blob], l.name, { type: l.mime })], title: l.name })
  }
  catch (err) {
    if ((err as Error)?.name !== 'AbortError') toast.error('No se pudo compartir')
  }
}

// Impresión en un marco oculto con lo ya cargado: el documento no sale de la app
function print() {
  const l = current.value
  if (!l || !printable.value) return
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
  if (l.kind === 'image') {
    const title = l.name.replace(/[<>&"]/g, '')
    frame.srcdoc = `<!doctype html><html><head><title>${title}</title><style>@page{margin:12mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="${l.objectUrl}"></body></html>`
  }
  else frame.src = l.objectUrl
  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
      }
      catch {
        toast.error('No se pudo imprimir', 'Descárgalo e imprímelo desde tu equipo.')
      }
    }, 150)
    setTimeout(() => frame.remove(), 60_000)
  }
  document.body.appendChild(frame)
}

// ─── Teclado ───
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))

// El visor es modal: lo que usa no sigue adelante y el resto tampoco llega a los atajos de la página
// de debajo (← → cambian de factura, Ctrl+K abre la paleta…)
function onKey(e: KeyboardEvent) {
  // El menú contextual abierto encima ya usó la tecla (Esc lo cierra a él, no al visor)
  if (!state.value.open || e.defaultPrevented) return
  if (handleKey(e) || !root.value?.contains(e.target as Node)) e.stopImmediatePropagation()
}

function handleKey(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  // Firmando, las teclas son primero de las firmas (Esc suelta la elegida o sale del modo firma)
  if (signing.value && studio.value?.handleKey(e)) return true
  if (signing.value && e.key === 'Escape') return true
  // Esc va primero que en los modales de debajo (fase de captura): cierra solo el visor
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return true
  }
  if (e.key === 'Tab') {
    trapFocus(e)
    return false
  }
  if (typing(e.target)) return false
  const stop = (run: () => void) => {
    e.preventDefault()
    run()
    return true
  }
  if (mod && e.key.toLowerCase() === 'p') return printable.value ? stop(print) : false
  if (mod && !zoomable.value) return false
  if (zoomable.value && (e.key === '+' || e.key === '=')) return stop(() => zoomStep(1))
  if (zoomable.value && (e.key === '-' || e.key === '_')) return stop(() => zoomStep(-1))
  if (zoomable.value && e.key === '0') return stop(() => (zoom.value = 1))
  if (mod) return false
  if (kind.value === 'image' && status.value === 'ready' && e.key.toLowerCase() === 'r') return stop(() => (rotation.value += 90))
  if (multi.value && zoom.value <= 1.01 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) return stop(() => go(index.value + (e.key === 'ArrowRight' ? 1 : -1)))
  if (kind.value === 'pdf' && pages.value > 1 && /^(PageDown|PageUp)$/.test(e.key) && document.activeElement?.closest('.pdf-stage') == null) {
    return stop(() => pdfRef.value?.goTo(page.value + (e.key === 'PageDown' ? 1 : -1)))
  }
  return false
}

function trapFocus(e: KeyboardEvent) {
  const nodes = [...(root.value?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), select, input') ?? [])].filter(n => n.offsetParent !== null)
  if (!nodes.length) return
  const first = nodes[0]!
  const last = nodes.at(-1)!
  if (e.shiftKey && (document.activeElement === first || !root.value?.contains(document.activeElement))) {
    e.preventDefault()
    last.focus()
  }
  else if (!e.shiftKey && (document.activeElement === last || !root.value?.contains(document.activeElement))) {
    e.preventDefault()
    first.focus()
  }
}

// ─── Deslizar entre documentos (táctil, sin zoom) ───
let swipe: { x: number, y: number, t: number, multi: boolean } | null = null
function onTouchStart(e: TouchEvent) {
  if (e.touches.length > 1) {
    if (swipe) swipe.multi = true
    return
  }
  const t = e.touches[0]!
  swipe = { x: t.clientX, y: t.clientY, t: performance.now(), multi: false }
}
function onTouchEnd(e: TouchEvent) {
  const s = swipe
  if (!s || e.touches.length) return
  swipe = null
  const t = e.changedTouches[0]
  if (!t || s.multi || !multi.value || zoom.value > 1.01 || signing.value) return
  const dx = t.clientX - s.x
  const dy = t.clientY - s.y
  if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6 && performance.now() - s.t < 700) go(index.value + (dx < 0 ? 1 : -1))
}

// ─── Apertura y cierre ───
let lastFocus: HTMLElement | null = null
let prevOverflow = ''
watch(() => state.value.open, async (open) => {
  if (open) {
    lastFocus = document.activeElement as HTMLElement
    prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey, true)
    await nextTick()
    closeBtn.value?.focus({ preventScroll: true })
  }
  else {
    window.removeEventListener('keydown', onKey, true)
    document.documentElement.style.overflow = prevOverflow
    ticket++
    lastFocus?.focus?.({ preventScroll: true })
  }
}, { immediate: true })

// Cerrado del todo (tras la animación): se libera lo descargado
function cleanup() {
  cache.clear()
  urls.forEach(u => URL.revokeObjectURL(u))
  urls.clear()
  current.value = null
}

watch(() => [state.value.open, state.value.items, state.value.index] as const, ([open]) => {
  if (signing.value) stopSigning()
  if (open) show()
}, { immediate: true })

watch(index, async () => {
  await nextTick()
  strip.value?.querySelector<HTMLElement>('.th.on')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
})

// Navegar a otra página de la app cierra el visor
const route = useRoute()
watch(() => route.fullPath, () => {
  if (state.value.open) close()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  if (state.value.open) document.documentElement.style.overflow = prevOverflow
  cleanup()
})

const thumbKind = (f: ViewerFile) => kindOf(f.name ?? '', f.mime ?? '')

// ─── Clic derecho / pulsación larga: zoom, giro, recorrer, descargar, copiar… como un visor de escritorio ───

// Un clic (o toque) fuera del documento cierra el visor, como un visor de fotos. No cuenta si arrastra
// (desplazar, mover con zoom, seleccionar texto), si cae en la barra de desplazamiento o si solo cierra
// el menú contextual o quita una selección de texto
const DOCUMENT = '.pg, .img, .fv-paper, .fv-card, .fv-nav, .fv-pages, .ghost-page'
const { state: ctxState } = useContextMenu()
let ctxClosedAt = 0
watch(() => !!ctxState.value, (v, was) => {
  if (was && !v) ctxClosedAt = performance.now()
}, { flush: 'sync' })
let backdropDown: { x: number, y: number } | null = null
function onBackdropDown(e: PointerEvent) {
  const selecting = !!window.getSelection()?.toString()
  const menu = !!ctxState.value || performance.now() - ctxClosedAt < 300
  backdropDown = e.button === 0 && e.isPrimary && !selecting && !menu ? { x: e.clientX, y: e.clientY } : null
}
function onBackdropClick(e: MouseEvent) {
  const down = backdropDown
  backdropDown = null
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || zoom.value > 1.01) return
  // Firmando, un clic fuera solo suelta la firma elegida: cerrar perdería lo colocado
  if (signing.value) {
    if (!(e.target as HTMLElement).closest('[data-placement], .sg-dock, .sg-sheet-wrap, .sg-ask')) session.selected.value = null
    return
  }
  const t = e.target as HTMLElement
  if (t.closest(DOCUMENT) || e.offsetX > t.clientWidth || e.offsetY > t.clientHeight) return
  close()
}

function download() {
  const href = downloadHref.value
  if (!href) return
  const a = document.createElement('a')
  a.href = href
  a.download = name.value
  a.click()
}

// El portapapeles solo acepta PNG: otras imágenes se convierten antes
async function pngOf(l: Loaded) {
  if (l.mime === 'image/png') return l.blob
  const bmp = await createImageBitmap(l.blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
}

async function copyImage() {
  const l = current.value
  if (!l) return
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(l) })])
    toast.success('Imagen copiada', 'Pégala en un email, un chat o un documento.')
  }
  catch {
    toast.error('No se pudo copiar la imagen', 'El navegador no permite copiar imágenes aquí. Descárgala.')
  }
}

function viewerMenu(e?: MouseEvent): CtxSpec {
  const ready = status.value === 'ready' && !!current.value
  const items: CtxItem[] = []
  if (signing.value && studio.value) {
    // Clic derecho sobre la página: la firma se pone justo ahí
    const at = e && (e.target as HTMLElement | null)?.closest?.('[data-sign-page]') ? { x: e.clientX, y: e.clientY } : undefined
    const sources = studio.value.sources
    items.push(
      ...sources.slice(0, 6).map(s => ({ label: at ? `Poner «${s.label}» aquí` : `Poner «${s.label}»`, icon: 'ph:signature', onClick: () => studio.value?.place(s, at) })),
      { divider: true },
      { label: 'Guardar firmado', icon: 'ph:check-circle', keys: [modKey(), 'S'], disabled: !studio.value.count, onClick: () => studio.value?.save() },
      { label: 'Descargar firmado', icon: 'ph:download-simple', disabled: !studio.value.count, onClick: () => studio.value?.download() },
      { label: 'Dejar de firmar', icon: 'ph:x', keys: ['Esc'], onClick: () => studio.value?.requestExit() },
    )
    return { title: 'Firmar documento', subtitle: name.value, icon: 'ph:signature', items }
  }
  if (signable.value) items.push({ label: 'Firmar…', icon: 'ph:signature', onClick: startSigning }, { divider: true })
  if (zoomable.value) {
    items.push(
      { label: 'Acercar', icon: 'ph:magnifying-glass-plus', keys: ['+'], disabled: zoom.value >= maxZoom.value, onClick: () => zoomStep(1) },
      { label: 'Alejar', icon: 'ph:magnifying-glass-minus', keys: ['−'], disabled: zoom.value <= 0.25, onClick: () => zoomStep(-1) },
      { label: 'Ajustar a la pantalla', icon: 'ph:arrows-in', keys: ['0'], active: Math.abs(zoom.value - 1) < 0.01, onClick: () => (zoom.value = 1) },
    )
    if (kind.value === 'image') {
      items.push(
        { label: 'Tamaño real', icon: 'ph:frame-corners', onClick: () => imgRef.value?.actualSize() },
        { label: 'Girar', icon: 'ph:arrow-clockwise', keys: ['R'], onClick: () => (rotation.value += 90) },
      )
    }
    items.push({ divider: true })
  }
  if (ready && kind.value === 'pdf' && pages.value > 1) {
    items.push(
      { label: 'Página anterior', icon: 'ph:caret-up', keys: ['RePág'], disabled: page.value <= 1, onClick: () => pdfRef.value?.goTo(page.value - 1) },
      { label: 'Página siguiente', icon: 'ph:caret-down', keys: ['AvPág'], disabled: page.value >= pages.value, onClick: () => pdfRef.value?.goTo(page.value + 1) },
      { divider: true },
    )
  }
  if (multi.value) {
    // ← → solo cambian de documento sin zoom (ampliado, mueven la vista)
    const arrows = zoom.value <= 1.01
    items.push(
      { label: 'Documento anterior', icon: 'ph:caret-left', keys: arrows ? ['←'] : undefined, onClick: () => go(index.value - 1) },
      { label: 'Documento siguiente', icon: 'ph:caret-right', keys: arrows ? ['→'] : undefined, onClick: () => go(index.value + 1) },
      { divider: true },
    )
  }
  if (downloadHref.value) items.push({ label: 'Descargar', icon: 'ph:download-simple', onClick: download })
  if (printable.value && desktopCtx()) items.push({ label: 'Imprimir', icon: 'ph:printer', keys: [modKey(), 'P'], onClick: print })
  if (canShare.value) items.push({ label: 'Compartir…', icon: 'ph:share-network', onClick: share })
  const copy: CtxItem[] = [
    ...(ready && kind.value === 'image' && typeof ClipboardItem !== 'undefined' ? [{ label: 'Imagen', icon: 'ph:image', onClick: copyImage }] : []),
    ...(ready && current.value?.kind === 'text' ? [{ label: 'Texto', icon: 'ph:text-aa', onClick: () => copyText(current.value?.text, 'Texto') }] : []),
    { label: 'Nombre del archivo', sub: name.value, icon: 'ph:file', onClick: () => copyText(name.value, 'Nombre') },
  ]
  items.push(
    { label: 'Copiar', icon: 'ph:copy', children: copy },
    { divider: true },
    { label: 'Cerrar el visor', icon: 'ph:x', keys: ['Esc'], onClick: close },
  )
  return { title: name.value, subtitle: meta.value, icon: kindInfo.value.icon, items }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fv" @after-leave="cleanup">
      <div
        v-if="state.open"
        ref="root"
        class="fv"
        :class="{ signing }"
        data-ctx-theme="dark"
        role="dialog"
        @keydown.stop
        aria-modal="true"
        :aria-label="`Visor de documentos: ${name}`"
      >
        <header class="fv-bar">
          <div class="fv-file">
            <span v-if="signing" class="fv-ic sign" aria-hidden="true"><Icon name="ph:signature" /></span>
            <span v-else class="fv-ic" :class="kindInfo.tone" aria-hidden="true"><Icon :name="kindInfo.icon" /></span>
            <div class="min0">
              <p class="fv-name" :title="name">{{ name }}</p>
              <p v-if="signing" class="fv-meta">
                <span class="fv-count sign">Firmando</span>
                <span class="truncate">{{ studio?.count ? `${studio.count} ${studio.count === 1 ? 'firma colocada' : 'firmas colocadas'}` : 'Elige una firma abajo' }}</span>
              </p>
              <p v-else class="fv-meta num">
                <span v-if="multi" class="fv-count">{{ index + 1 }} de {{ items.length }}</span>
                <span class="truncate">{{ meta }}</span>
              </p>
            </div>
          </div>

          <div v-if="zoomable" class="fv-tools" role="group" aria-label="Zoom">
            <button type="button" class="fv-btn" :disabled="zoom <= 0.25" aria-label="Alejar" title="Alejar (−)" @click="zoomStep(-1)"><Icon name="ph:minus-bold" /></button>
            <button type="button" class="fv-pct num" :class="{ on: zoom !== 1 }" :title="zoom === 1 ? 'Ajustado a la pantalla' : 'Ajustar a la pantalla (0)'" @click="zoom = 1">{{ pct }}</button>
            <button type="button" class="fv-btn" :disabled="zoom >= maxZoom" aria-label="Acercar" title="Acercar (+)" @click="zoomStep(1)"><Icon name="ph:plus-bold" /></button>
            <template v-if="kind === 'image' && !signing">
              <span class="fv-sep" aria-hidden="true" />
              <button type="button" class="fv-btn" aria-label="Girar" title="Girar (R)" @click="rotation += 90"><Icon name="ph:arrow-clockwise-bold" /></button>
            </template>
          </div>

          <div v-if="signing" class="fv-acts">
            <button type="button" class="fv-btn fv-txt" :disabled="!!studio?.busy" title="Dejar de firmar (Esc)" @click="studio?.requestExit()">
              <Icon name="ph:x-bold" class="only-narrow" /><span class="fv-txt-t">Descartar</span>
            </button>
            <button
              v-if="item?.fileId"
              type="button"
              class="fv-btn"
              :disabled="!studio?.count || !!studio?.busy"
              aria-label="Descargar firmado"
              title="Descargar firmado"
              @click="studio?.download()"
            >
              <span v-if="studio?.busy === 'download'" class="fv-mini-spin" aria-hidden="true" /><Icon v-else name="ph:download-simple" />
            </button>
            <button type="button" class="fv-primary" :disabled="!studio?.count || !!studio?.busy" :title="item?.fileId ? 'Guardar una copia firmada junto al original (Ctrl+S)' : 'Descargar el documento firmado'" @click="studio?.save()">
              <span v-if="studio?.busy" class="fv-mini-spin" aria-hidden="true" />
              <Icon v-else :name="item?.fileId ? 'ph:check-bold' : 'ph:download-simple-bold'" />
              <span class="fv-primary-long">{{ item?.fileId ? 'Guardar firmado' : 'Descargar firmado' }}</span>
              <span class="fv-primary-short">{{ item?.fileId ? 'Guardar' : 'Descargar' }}</span>
            </button>
          </div>
          <div v-else class="fv-acts">
            <button v-if="signable" type="button" class="fv-btn fv-sign" title="Firmar el documento" @click="startSigning">
              <Icon name="ph:signature" /><span class="fv-sign-t">Firmar</span>
            </button>
            <button v-if="printable" type="button" class="fv-btn hide-touch" aria-label="Imprimir" title="Imprimir (Ctrl+P)" @click="print"><Icon name="ph:printer" /></button>
            <button v-if="canShare" type="button" class="fv-btn" aria-label="Compartir" title="Compartir" @click="share"><Icon name="ph:share-network" /></button>
            <a v-if="downloadHref" :href="downloadHref" :download="name" class="fv-btn fv-dl" :aria-label="`Descargar ${name}`" title="Descargar">
              <Icon name="ph:download-simple" /><span class="fv-dl-t">Descargar</span>
            </a>
            <span class="fv-sep" aria-hidden="true" />
            <button ref="closeBtn" type="button" class="fv-btn fv-x" aria-label="Cerrar el visor" title="Cerrar (Esc)" @click="close"><Icon name="ph:x-bold" /></button>
          </div>
        </header>

        <div v-ctx="viewerMenu" class="fv-body" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd" @pointerdown="onBackdropDown" @click="onBackdropClick">
          <Transition :name="`fv-${direction}`" mode="out-in">
            <div :key="`${index}-${item?.url}`" class="fv-slot">
              <div v-if="status === 'loading'" class="fv-wait" role="status" aria-live="polite">
                <span class="fv-spin" aria-hidden="true" />
                <span>Abriendo {{ item?.name ?? 'el documento' }}…</span>
              </div>

              <div v-else-if="status === 'error' || !current" class="fv-card">
                <span class="fv-card-ic warn" aria-hidden="true"><Icon name="ph:warning-circle-fill" /></span>
                <p class="fv-card-t">No se pudo abrir el documento</p>
                <p class="fv-card-s">{{ errorText || 'Inténtalo de nuevo en unos segundos.' }}</p>
                <div class="fv-card-acts">
                  <button type="button" class="fv-pill" @click="retry"><Icon name="ph:arrow-clockwise-bold" /> Reintentar</button>
                  <a v-if="item?.downloadUrl" :href="item.downloadUrl" class="fv-pill ghost"><Icon name="ph:download-simple" /> Descargar</a>
                </div>
              </div>

              <LazyDocsPdfPages
                v-else-if="current.kind === 'pdf' && current.pdf"
                ref="pdfRef"
                v-model:zoom="zoom"
                :data="current.pdf"
                :label="current.name"
                @loaded="pages = $event"
                @page="page = $event"
                @error="status = 'error'"
              >
                <template #page="{ index: pageIndex }">
                  <DocsSignLayer v-if="signing" :page="pageIndex" />
                </template>
              </LazyDocsPdfPages>

              <LazyDocsImageStage
                v-else-if="current.kind === 'image'"
                ref="imgRef"
                v-model:zoom="zoom"
                :src="current.objectUrl"
                :alt="current.name"
                :rotation="rotation"
                @loaded="(w, h) => (dims = { w, h })"
                @error="status = 'error'"
              >
                <DocsSignLayer v-if="signing" :page="0" />
              </LazyDocsImageStage>

              <div v-else-if="current.kind === 'word' || current.kind === 'sheet'" class="fv-paper">
                <LazyDocsOfficePreview :blob="current.blob" :kind="current.kind" :name="current.name" @error="status = 'error'" />
              </div>

              <div v-else-if="current.kind === 'text'" class="fv-paper">
                <pre class="fv-text">{{ current.text }}</pre>
              </div>

              <div v-else class="fv-card">
                <span class="fv-card-ic" :class="kindInfo.tone" aria-hidden="true">
                  <Icon :name="fileIcon(current.name, current.mime)" />
                  <span v-if="ext" class="fv-ext">{{ ext }}</span>
                </span>
                <p class="fv-card-t">{{ current.name }}</p>
                <p class="fv-card-s">Este formato no se puede ver aquí. Descárgalo para abrirlo con su programa.</p>
                <div class="fv-card-acts">
                  <a :href="current.objectUrl" :download="current.name" class="fv-pill"><Icon name="ph:download-simple-bold" /> Descargar · {{ fileSize(current.blob.size) }}</a>
                </div>
              </div>
            </div>
          </Transition>

          <LazyDocsSignStudio
            v-if="signing && current && (current.kind === 'pdf' || current.kind === 'image')"
            ref="studio"
            :kind="current.kind"
            :page="current.kind === 'pdf' ? Math.max(0, page - 1) : 0"
            :pages="current.kind === 'pdf' ? pages : 1"
            :name="current.name"
            :mime="current.mime"
            :pdf="current.pdf"
            :object-url="current.objectUrl"
            :file-id="item?.fileId"
            @exit="stopSigning"
            @saved="onSigned"
          />

          <template v-if="multi && !signing">
            <button type="button" class="fv-nav prev" aria-label="Documento anterior" title="Anterior (←)" @click="go(index - 1)"><Icon name="ph:caret-left-bold" /></button>
            <button type="button" class="fv-nav next" aria-label="Documento siguiente" title="Siguiente (→)" @click="go(index + 1)"><Icon name="ph:caret-right-bold" /></button>
          </template>

          <Transition name="fv-rise">
            <div v-if="status === 'ready' && kind === 'pdf' && pages > 1" class="fv-pages num" role="group" aria-label="Páginas">
              <button type="button" class="fv-btn sm" :disabled="page <= 1" aria-label="Página anterior" @click="pdfRef?.goTo(page - 1)"><Icon name="ph:caret-up-bold" /></button>
              <span aria-live="polite">Página {{ page }} de {{ pages }}</span>
              <button type="button" class="fv-btn sm" :disabled="page >= pages" aria-label="Página siguiente" @click="pdfRef?.goTo(page + 1)"><Icon name="ph:caret-down-bold" /></button>
            </div>
          </Transition>
        </div>

        <footer v-if="multi && !signing" ref="strip" class="fv-strip" aria-label="Documentos">
          <button
            v-for="(f, i) in items"
            :key="`${i}-${f.url}`"
            type="button"
            class="th"
            :class="{ on: i === index }"
            :aria-label="f.name ?? `Documento ${i + 1}`"
            :aria-current="i === index ? 'true' : undefined"
            :title="f.name ?? undefined"
            @click="go(i)"
          >
            <img v-if="thumbKind(f) === 'image'" :src="f.url" alt="" loading="lazy" class="th-img">
            <span v-else class="th-ic" :class="KIND[thumbKind(f)].tone"><Icon :name="KIND[thumbKind(f)].icon" /></span>
            <span class="th-name">{{ f.name ?? `Documento ${i + 1}` }}</span>
          </button>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Visor siempre oscuro (como el visor de fotos del sistema): el documento es lo único claro */
.fv {
  --fv-bg: #0c0e13;
  --fv-glass: rgba(24, 27, 34, 0.74);
  --fv-line: rgba(255, 255, 255, 0.08);
  --fv-text: #f4f5f7;
  --fv-text-2: rgba(244, 245, 247, 0.62);
  --fv-hover: rgba(255, 255, 255, 0.09);
  --fv-press: rgba(255, 255, 255, 0.15);

  position: fixed;
  inset: 0;
  z-index: calc(var(--z-popover) - 1);
  display: flex;
  flex-direction: column;
  color: var(--fv-text);
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(255, 255, 255, 0.05), transparent 60%),
    rgba(10, 12, 16, 0.94);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  color-scheme: dark;
}

/* ─── Barra superior ─── */
.fv-bar {
  position: relative;
  z-index: 3;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--s-4);
  min-height: 64px;
  padding: 10px 14px 10px 18px;
  padding-top: max(10px, env(safe-area-inset-top));
  background: linear-gradient(to bottom, rgba(12, 14, 19, 0.9), rgba(12, 14, 19, 0.55));
  border-bottom: 1px solid var(--fv-line);
}

.fv-file {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.min0 {
  min-width: 0;
}

.fv-ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  font-size: 20px;
  border-radius: 10px;
}

.pdf { color: #ff8a80; background: rgba(255, 99, 88, 0.16); }
.img { color: #7cc4ff; background: rgba(88, 170, 255, 0.16); }
.doc { color: #9fa8ff; background: rgba(120, 132, 255, 0.18); }
.xls { color: #6ee2a5; background: rgba(60, 200, 130, 0.16); }
.txt { color: #d6dae3; background: rgba(255, 255, 255, 0.1); }
.other { color: #ffd27a; background: rgba(255, 190, 70, 0.15); }

.fv-name {
  overflow: hidden;
  font-size: 15px;
  font-weight: 620;
  letter-spacing: -0.005em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.fv-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  color: var(--fv-text-2);
  font-size: 12.5px;
}

.fv-count {
  flex-shrink: 0;
  padding: 1px 7px;
  font-weight: 600;
  color: var(--fv-text);
  background: var(--fv-hover);
  border-radius: 999px;
}

.fv-tools,
.fv-acts {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fv-tools {
  padding: 3px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--fv-line);
  border-radius: 12px;
}

/* Siempre a la derecha, haya o no controles de zoom en el centro */
.fv-acts {
  grid-column: 3;
  justify-content: flex-end;
}

.fv-btn {
  display: inline-grid;
  grid-auto-flow: column;
  place-items: center;
  gap: 7px;
  min-width: 36px;
  height: 36px;
  padding: 0 9px;
  font-size: 18px;
  color: var(--fv-text);
  background: transparent;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast), opacity var(--t-fast);
}

.fv-btn:hover:not(:disabled) {
  background: var(--fv-hover);
}

.fv-btn:active:not(:disabled) {
  background: var(--fv-press);
}

.fv-btn:disabled {
  opacity: 0.32;
  cursor: default;
}

.fv-btn:focus-visible,
.fv-pct:focus-visible,
.fv-nav:focus-visible,
.th:focus-visible,
.fv-pill:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.fv-btn.sm {
  min-width: 28px;
  height: 28px;
  padding: 0;
  font-size: 14px;
  border-radius: 999px;
}

.fv-dl {
  padding: 0 12px;
  font-size: 13.5px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.1);
}

.fv-dl :deep(svg) {
  font-size: 17px;
}

.fv-dl:hover {
  background: rgba(255, 255, 255, 0.16) !important;
}

.fv-pct {
  min-width: 62px;
  height: 30px;
  padding: 0 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fv-text-2);
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.fv-pct:hover,
.fv-pct.on {
  color: var(--fv-text);
}

.fv-pct:hover {
  background: var(--fv-hover);
}

.fv-tools .fv-btn {
  min-width: 30px;
  height: 30px;
  padding: 0;
  font-size: 14px;
  border-radius: 8px;
}

.fv-sep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--fv-line);
}

.fv-tools .fv-sep {
  margin: 0 2px;
}

/* ─── Zona del documento ─── */
.fv-body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.fv-slot {
  position: absolute;
  inset: 0;
}

.fv-wait {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: var(--s-6);
  color: var(--fv-text-2);
  font-size: 13.5px;
  text-align: center;
  overflow-wrap: anywhere;
}

.fv-spin {
  width: 30px;
  height: 30px;
  border: 2.5px solid rgba(255, 255, 255, 0.14);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.fv-paper {
  position: absolute;
  inset: 24px max(24px, calc((100% - 1120px) / 2));
  display: flex;
  overflow: hidden;
  background: var(--surface);
  color: var(--text);
  color-scheme: light dark;
  border-radius: 12px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2), 0 24px 64px -16px rgba(0, 0, 0, 0.6);
}

.fv-paper > * {
  flex: 1;
  min-width: 0;
}

.fv-text {
  margin: 0;
  padding: var(--s-6);
  overflow: auto;
  font: 13px/1.6 var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 4;
}

.fv-card {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(440px, calc(100% - 32px));
  padding: 36px 28px 30px;
  text-align: center;
  background: var(--fv-glass);
  border: 1px solid var(--fv-line);
  border-radius: 20px;
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.6);
  transform: translate(-50%, -50%);
}

.fv-card-ic {
  position: relative;
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin-bottom: 18px;
  font-size: 36px;
  border-radius: 20px;
}

.fv-card-ic.warn {
  color: #ffb4a8;
  background: rgba(255, 99, 88, 0.14);
}

.fv-ext {
  position: absolute;
  right: -8px;
  bottom: -6px;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.04em;
  color: #0c0e13;
  background: #ffd27a;
  border-radius: 6px;
}

.fv-card-t {
  max-width: 100%;
  font-size: 16px;
  font-weight: 640;
  overflow-wrap: anywhere;
}

.fv-card-s {
  margin-top: 6px;
  color: var(--fv-text-2);
  font-size: 13.5px;
  line-height: 1.5;
}

.fv-card-acts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 22px;
}

.fv-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 18px;
  font-size: 14px;
  font-weight: 620;
  color: #0c0e13;
  background: #fff;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  transition: transform var(--t-fast), background var(--t-fast);
}

.fv-pill:hover {
  background: #e9ebef;
}

.fv-pill:active {
  transform: scale(0.98);
}

.fv-pill.ghost {
  color: var(--fv-text);
  background: var(--fv-hover);
}

.fv-pill.ghost:hover {
  background: var(--fv-press);
}

/* Flechas laterales */
.fv-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  font-size: 18px;
  color: var(--fv-text);
  background: var(--fv-glass);
  border: 1px solid var(--fv-line);
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: pointer;
  transform: translateY(-50%);
  transition: background var(--t-fast), transform var(--t-fast);
}

.fv-nav:hover {
  background: rgba(40, 44, 54, 0.9);
}

.fv-nav:active {
  transform: translateY(-50%) scale(0.95);
}

.fv-nav.prev { left: 18px; }
.fv-nav.next { right: 18px; }

/* Píldora de páginas */
.fv-pages {
  position: absolute;
  bottom: 20px;
  left: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--fv-text);
  background: var(--fv-glass);
  border: 1px solid var(--fv-line);
  border-radius: 999px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  transform: translateX(-50%);
}

/* ─── Firmar ─── */
.fv-ic.sign {
  color: #b4c3ff;
  background: rgba(96, 124, 255, 0.2);
}

.fv-count.sign {
  color: #cdd7ff;
  background: rgba(96, 124, 255, 0.24);
}

.fv-sign {
  padding: 0 13px 0 11px;
  font-size: 13.5px;
  font-weight: 620;
  color: #fff;
  background: linear-gradient(180deg, color-mix(in srgb, var(--brand) 92%, white), var(--brand));
  box-shadow: 0 6px 18px -6px color-mix(in srgb, var(--brand) 70%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.fv-sign:hover:not(:disabled) {
  background: linear-gradient(180deg, color-mix(in srgb, var(--brand) 80%, white), color-mix(in srgb, var(--brand) 92%, white));
}

.fv-sign :deep(svg) {
  font-size: 18px;
}

.fv-txt {
  padding: 0 12px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--fv-text-2);
}

.fv-txt:hover:not(:disabled) {
  color: var(--fv-text);
}

.only-narrow,
.fv-primary-short {
  display: none;
}

.fv-primary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  margin-left: 4px;
  padding: 0 15px 0 13px;
  font-size: 13.5px;
  font-weight: 650;
  color: #fff;
  background: linear-gradient(180deg, color-mix(in srgb, var(--brand) 92%, white), var(--brand));
  border: 0;
  border-radius: 10px;
  box-shadow: 0 6px 18px -6px color-mix(in srgb, var(--brand) 70%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: opacity var(--t-fast), transform var(--t-fast);
}

.fv-primary :deep(svg) {
  font-size: 16px;
}

.fv-primary:active:not(:disabled) {
  transform: scale(0.98);
}

.fv-primary:disabled {
  opacity: 0.38;
  cursor: default;
  box-shadow: none;
}

.fv-primary:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

.fv-mini-spin {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* La bandeja de firmas ocupa el pie: el documento termina encima de ella */
.fv.signing .fv-slot {
  bottom: 112px;
}

.fv.signing .fv-pages {
  top: 14px;
  bottom: auto;
}

.fv.signing :deep(.pg) {
  overflow: visible;
}

.fv.signing :deep(.textLayer) {
  pointer-events: none;
}

.fv.signing :deep(.img-stage) {
  cursor: default;
}

/* ─── Miniaturas ─── */
.fv-strip {
  position: relative;
  z-index: 3;
  display: flex;
  justify-content: safe center;
  gap: 8px;
  padding: 10px 16px;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
  overflow-x: auto;
  background: rgba(12, 14, 19, 0.7);
  border-top: 1px solid var(--fv-line);
  scrollbar-width: none;
}

.fv-strip::-webkit-scrollbar {
  display: none;
}

.th {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  max-width: 200px;
  height: 44px;
  padding: 4px 12px 4px 4px;
  color: var(--fv-text-2);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
}

.th:hover {
  color: var(--fv-text);
  background: var(--fv-hover);
}

.th.on {
  color: var(--fv-text);
  background: rgba(255, 255, 255, 0.1);
  border-color: color-mix(in srgb, var(--brand) 70%, white 10%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 25%, transparent);
}

.th-img,
.th-ic {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 8px;
}

.th-img {
  object-fit: cover;
  background: rgba(255, 255, 255, 0.06);
}

.th-ic {
  display: grid;
  place-items: center;
  font-size: 17px;
}

.th-name {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 560;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ─── Animaciones ─── */
.fv-enter-active {
  transition: opacity 220ms var(--ease-out);
}

.fv-leave-active {
  transition: opacity 160ms var(--ease-in);
}

.fv-enter-active .fv-body {
  transition: transform 320ms var(--ease-spring), opacity 220ms var(--ease-out);
}

.fv-enter-from,
.fv-leave-to {
  opacity: 0;
}

.fv-enter-from .fv-body {
  opacity: 0;
  transform: scale(0.97) translateY(8px);
}

.fv-next-enter-active,
.fv-prev-enter-active {
  transition: opacity 200ms var(--ease-out), transform 260ms var(--ease-out);
}

.fv-next-leave-active,
.fv-prev-leave-active {
  transition: opacity 120ms var(--ease-in), transform 120ms var(--ease-in);
}

.fv-next-enter-from { opacity: 0; transform: translateX(28px); }
.fv-next-leave-to { opacity: 0; transform: translateX(-20px); }
.fv-prev-enter-from { opacity: 0; transform: translateX(-28px); }
.fv-prev-leave-to { opacity: 0; transform: translateX(20px); }

.fv-rise-enter-active,
.fv-rise-leave-active {
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
}

.fv-rise-enter-from,
.fv-rise-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (hover: none) {
  .hide-touch {
    display: none;
  }
}

@media (max-width: 760px) {
  .fv-bar {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-2);
    min-height: 58px;
    padding: 8px 8px 8px 14px;
    padding-top: max(8px, env(safe-area-inset-top));
  }

  /* En el móvil el zoom es con los dedos: la barra deja sitio al nombre */
  .fv-tools {
    display: none;
  }

  .fv-acts {
    grid-column: 2;
  }

  .fv-ic {
    width: 34px;
    height: 34px;
    font-size: 18px;
  }

  .fv-name {
    font-size: 14.5px;
  }

  .fv-dl-t {
    display: none;
  }

  .fv-dl {
    padding: 0 9px;
    background: transparent;
  }

  .fv-nav {
    display: none;
  }

  .fv-sign-t {
    display: none;
  }

  .fv-sign {
    padding: 0 9px;
  }

  .fv-txt {
    padding: 0 9px;
  }

  .fv-txt-t {
    display: none;
  }

  .only-narrow,
  .fv-primary-short {
    display: inline-block;
  }

  .fv-primary-long {
    display: none;
  }

  .fv-primary {
    padding: 0 12px;
  }

  .fv.signing .fv-slot {
    bottom: 100px;
  }

  .fv-paper {
    inset: 10px;
  }

  .fv-pages {
    bottom: 14px;
  }

  .th {
    max-width: 150px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fv-enter-active .fv-body,
  .fv-next-enter-active,
  .fv-prev-enter-active {
    transition: opacity 150ms;
  }

  .fv-enter-from .fv-body,
  .fv-next-enter-from,
  .fv-prev-enter-from,
  .fv-next-leave-to,
  .fv-prev-leave-to {
    transform: none;
  }
}
</style>
