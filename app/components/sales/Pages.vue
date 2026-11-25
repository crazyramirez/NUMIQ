<script setup lang="ts">
/**
 * Páginas adicionales del documento (condiciones generales, memoria del proyecto, fotos…), editadas
 * sobre su propia hoja: título y bloques de texto con formato o imágenes. Los bloques se reordenan
 * arrastrando su asa (⋮⋮), con su menú o con el clic derecho; las fotos se añaden con el botón,
 * arrastrándolas a la hoja o pegándolas. Una página se puede guardar como plantilla y reutilizarla.
 */
import type { AiContextValue } from '~/utils/ai-assist'
import type { MenuItem } from '~/components/ui/Menu.vue'
import type { CtxSpec } from '~/composables/useContextMenu'

const props = defineProps<{
  /** Marca y documento para la cabecera de cada hoja (igual que en el PDF) */
  brand: string
  docLabel: string
  accent: string
  font?: string
  /** Lo que sabe la IA del documento (cliente, conceptos, total…) */
  aiContext: () => Record<string, AiContextValue>
}>()
const pages = defineModel<DocPage[]>({ required: true })
/** Imágenes subiéndose: el editor no guarda hasta que terminan */
const uploading = defineModel<number>('uploading', { default: 0 })

const toast = useToast()
const root = ref<HTMLElement>()

// ─── Plantillas de página de la empresa ──────────────────────────────────────
const { data: templates, refresh: refreshTemplates } = useFetch<PageTemplate[]>('/api/sales/page-templates', { server: false, lazy: true, default: () => [] })

const STARTERS = [
  { label: 'Condiciones generales', icon: 'ph:scroll', title: 'Condiciones generales' },
  { label: 'Memoria del proyecto', icon: 'ph:notebook', title: 'Memoria del proyecto' },
  { label: 'Fotos del trabajo', icon: 'ph:images', title: 'Fotos del trabajo', photos: true },
]

const addMenu = computed<MenuItem[]>(() => [
  { label: 'Página en blanco', icon: 'ph:file', onClick: () => addPage() },
  { heading: 'Para empezar' },
  ...STARTERS.map(s => ({ label: s.label, icon: s.icon, onClick: () => addPage(undefined, s.title, s.photos) })),
  ...(templates.value?.length
    ? [
        { heading: 'Tus plantillas' },
        ...templates.value.map(t => ({ label: t.name, icon: 'ph:bookmark-simple-fill', onClick: () => addPage(t.page) })),
        { divider: true },
        { label: 'Gestionar plantillas…', icon: 'ph:sliders-horizontal', onClick: () => (manageOpen.value = true) },
      ]
    : []),
])

const textBlock = (): PageText => ({ id: pageId(), k: 'text', doc: null })

function focusIn(sel: string) {
  nextTick(() => {
    const el = root.value?.querySelector<HTMLElement>(sel)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
  })
}

function addPage(from?: DocPage, title = '', photos = false) {
  const page: DocPage = from ? clonePage(from) : { id: pageId(), title, blocks: photos ? [] : [textBlock()] }
  pages.value.push(page)
  if (photos) nextTick(() => pickImages(page, 0))
  else if (from || title) focusIn(`[data-page="${page.id}"] [data-block] .rt-area`)
  else focusIn(`[data-page="${page.id}"] .xp-title-in`)
}

// ─── Páginas ─────────────────────────────────────────────────────────────────
function movePage(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= pages.value.length) return
  const [p] = pages.value.splice(i, 1)
  pages.value.splice(j, 0, p!)
  nextTick(() => root.value?.querySelector(`[data-page="${p!.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function duplicatePage(i: number) {
  const copy = clonePage(pages.value[i]!)
  pages.value.splice(i + 1, 0, copy)
  toast.success('Página duplicada')
}

function removePage(i: number) {
  const [p] = pages.value.splice(i, 1)
  if (!p || pageIsEmpty(p)) return
  toast.push({ tone: 'info', title: 'Página eliminada', body: p.title || undefined, action: { label: 'Deshacer', run: () => pages.value.splice(Math.min(i, pages.value.length), 0, p) } }, 7000)
}

function pageMenu(p: DocPage, i: number): MenuItem[] {
  const n = pages.value.length
  return [
    ...(i > 0 ? [{ label: 'Subir página', icon: 'ph:arrow-up', onClick: () => movePage(i, -1) }] : []),
    ...(i < n - 1 ? [{ label: 'Bajar página', icon: 'ph:arrow-down', onClick: () => movePage(i, 1) }] : []),
    { label: 'Duplicar página', icon: 'ph:copy', onClick: () => duplicatePage(i) },
    { label: 'Guardar como plantilla…', icon: 'ph:bookmark-simple', onClick: () => openSave(p) },
    { divider: true },
    { label: 'Eliminar página', icon: 'ph:trash', danger: true, onClick: () => removePage(i) },
  ]
}

const pageCtx = (p: DocPage, i: number): CtxSpec => ({
  title: `Página adicional ${i + 1}`,
  subtitle: p.title || 'Sin título',
  icon: 'ph:file-text',
  items: pageMenu(p, i),
})

// ─── Bloques ─────────────────────────────────────────────────────────────────
function addText(p: DocPage, at = p.blocks.length) {
  const b = textBlock()
  p.blocks.splice(at, 0, b)
  focusIn(`[data-block="${b.id}"] .rt-area`)
}

function moveBlock(p: DocPage, i: number, to: number) {
  if (to < 0 || to >= p.blocks.length || to === i) return
  const [b] = p.blocks.splice(i, 1)
  p.blocks.splice(to, 0, b!)
}

function duplicateBlock(p: DocPage, i: number) {
  const b = p.blocks[i]!
  p.blocks.splice(i + 1, 0, { ...structuredClone(toRaw(b)), id: pageId() })
}

function removeBlock(p: DocPage, i: number) {
  const [b] = p.blocks.splice(i, 1)
  if (!b || blockIsEmpty(b)) return
  toast.push({ tone: 'info', title: b.k === 'image' ? 'Imagen quitada' : 'Texto eliminado', action: { label: 'Deshacer', run: () => p.blocks.splice(Math.min(i, p.blocks.length), 0, b) } }, 7000)
}

function blockMenu(p: DocPage, b: PageBlock, i: number): MenuItem[] {
  const n = p.blocks.length
  return [
    ...(i > 0 ? [{ label: 'Subir', icon: 'ph:arrow-up', onClick: () => moveBlock(p, i, i - 1) }] : []),
    ...(i < n - 1 ? [{ label: 'Bajar', icon: 'ph:arrow-down', onClick: () => moveBlock(p, i, i + 1) }] : []),
    { label: 'Duplicar', icon: 'ph:copy', onClick: () => duplicateBlock(p, i) },
    ...(b.k === 'image' ? [{ label: 'Cambiar imagen…', icon: 'ph:arrows-clockwise', onClick: () => pickImages(p, i, b) }] : []),
    { divider: true },
    { label: 'Texto debajo', icon: 'ph:text-align-left', onClick: () => addText(p, i + 1) },
    { label: 'Imagen debajo', icon: 'ph:image', onClick: () => pickImages(p, i + 1) },
    { divider: true },
    { label: b.k === 'image' ? 'Quitar imagen' : 'Eliminar texto', icon: 'ph:trash', danger: true, onClick: () => removeBlock(p, i) },
  ]
}

const blockCtx = (p: DocPage, b: PageBlock, i: number): CtxSpec => ({
  title: b.k === 'image' ? 'Imagen' : 'Texto',
  subtitle: `Bloque ${i + 1} de ${p.blocks.length}${p.title ? ` · ${p.title}` : ''}`,
  icon: b.k === 'image' ? 'ph:image' : 'ph:text-align-left',
  items: blockMenu(p, b, i),
})

/** La IA de cada texto sabe de qué va la página y lo que ya dicen los otros bloques */
function textContext(p: DocPage, b: PageText) {
  const others = p.blocks.filter(x => x !== b && x.k === 'text').map(x => richToPlain((x as PageText).doc)).join('\n').slice(0, 1500)
  return { ...props.aiContext(), titulo_de_la_pagina: p.title || null, resto_de_la_pagina: others || null }
}

// ─── Imágenes ────────────────────────────────────────────────────────────────
const SIZES: Array<{ v: PageImageSize, label: string, title: string }> = [
  { v: 's', label: 'S', title: 'Pequeña (un tercio)' },
  { v: 'm', label: 'M', title: 'Mediana (media hoja)' },
  { v: 'l', label: 'L', title: 'Grande (tres cuartos)' },
  { v: 'full', label: 'Ancho', title: 'Todo el ancho' },
]
const ALIGNS: Array<{ v: PageAlign, icon: string, title: string }> = [
  { v: 'left', icon: 'ph:align-left', title: 'A la izquierda' },
  { v: 'center', icon: 'ph:align-center-horizontal', title: 'Centrada' },
  { v: 'right', icon: 'ph:align-right', title: 'A la derecha' },
]

// Vista previa local mientras se sube (y después, para no parpadear al cambiar a la del servidor)
const previews = reactive(new Map<string, string>())
onBeforeUnmount(() => previews.forEach(u => URL.revokeObjectURL(u)))
const imgSrc = (b: PageImage) => previews.get(b.id) ?? (b.img ? `/api/sales/page-images/${b.img}` : '')
const pendingIds = reactive(new Set<string>())
const captions = reactive(new Set<string>())
// En pantallas táctiles las herramientas de una imagen salen al tocarla (y se van al tocar fuera)
const selected = ref<string | null>(null)
useEventListener('pointerdown', (e: PointerEvent) => {
  if (selected.value && !(e.target as HTMLElement | null)?.closest?.(`[data-block="${selected.value}"]`)) selected.value = null
}, { capture: true })

const fileInput = ref<HTMLInputElement>()
let pickTarget: { page: DocPage, at: number, replace?: PageImage } | null = null

function pickImages(page: DocPage, at: number, replace?: PageImage) {
  pickTarget = { page, at, replace }
  if (!fileInput.value) return
  fileInput.value.multiple = !replace
  fileInput.value.click()
}

function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (pickTarget && files.length) insertImages(pickTarget.page, files, pickTarget.at, pickTarget.replace)
  pickTarget = null
}

function findBlock(page: DocPage, id: string) {
  return page.blocks.find(b => b.id === id) as PageImage | undefined
}

function insertImages(page: DocPage, files: File[], at: number, replace?: PageImage) {
  const imgs = files.filter(f => /^image\//.test(f.type))
  if (!imgs.length) {
    toast.error('Eso no es una imagen', 'Añade fotos o imágenes JPG o PNG.')
    return
  }
  if (imgs.length > 20) toast.info('Se añaden las 20 primeras imágenes')
  imgs.slice(0, 20).forEach((file, n) => {
    if (replace && n === 0) {
      upload(page, replace.id, file, true)
      return
    }
    const b: PageImage = { id: pageId(), k: 'image', img: '', w: 4, h: 3, size: 'full', align: 'center', caption: null }
    page.blocks.splice(Math.min(at + n - (replace ? 1 : 0), page.blocks.length), 0, b)
    upload(page, b.id, file, false)
  })
}

async function upload(page: DocPage, id: string, file: File, replacing: boolean) {
  uploading.value++
  pendingIds.add(id)
  const before = previews.get(id)
  previews.set(id, URL.createObjectURL(file))
  try {
    const blob = await resizeImage(file, 2000)
    const fd = new FormData()
    fd.append('file', blob, 'imagen')
    const r = await $fetch<{ img: string, w: number, h: number }>('/api/sales/page-images', { method: 'POST', body: fd })
    const live = findBlock(page, id)
    if (live) Object.assign(live, r)
    if (before) URL.revokeObjectURL(before)
  }
  catch (err) {
    toast.error('No se pudo añadir la imagen', errorMessage(err))
    const now = previews.get(id)
    if (now) URL.revokeObjectURL(now)
    if (before) previews.set(id, before)
    else previews.delete(id)
    // Una imagen nueva que no se pudo subir desaparece; al cambiarla, se queda la de antes
    if (!replacing) {
      const i = page.blocks.findIndex(b => b.id === id)
      if (i >= 0) page.blocks.splice(i, 1)
    }
  }
  finally {
    pendingIds.delete(id)
    uploading.value--
  }
}

function toggleCaption(b: PageImage) {
  if (captions.has(b.id) || b.caption) {
    b.caption = null
    captions.delete(b.id)
    return
  }
  captions.add(b.id)
  focusIn(`[data-block="${b.id}"] .xp-cap-in`)
}

// ─── Arrastrar: bloques (por su asa) y fotos desde el escritorio ─────────────
const drop = reactive({ page: null as string | null, at: -1, y: 0, files: false, from: -1 })
let suppressClick = false

/** Hueco más cercano al puntero entre los bloques de la hoja (0 = antes del primero) */
function slotAt(sheet: Element, y: number) {
  const els = [...sheet.querySelectorAll<HTMLElement>(':scope .xp-blocks > [data-block]')]
  const sheetTop = sheet.getBoundingClientRect().top
  let at = els.length
  for (const [i, el] of els.entries()) {
    const r = el.getBoundingClientRect()
    if (y < r.top + r.height / 2) {
      at = i
      break
    }
  }
  // Línea entre dos bloques (o justo antes/después del primero/último)
  const prev = els[at - 1]?.getBoundingClientRect()
  const next = els[at]?.getBoundingClientRect()
  const lineY = prev && next ? (prev.bottom + next.top) / 2 : prev ? prev.bottom + 9 : next ? next.top - 9 : y
  return { at, y: lineY - sheetTop }
}

function onHandleDown(e: PointerEvent, page: DocPage, i: number) {
  if (e.button !== 0) return
  const handle = e.currentTarget as HTMLElement
  const sheet = handle.closest('.xp-sheet')
  if (!sheet) return
  const startY = e.clientY
  let moved = false
  handle.setPointerCapture(e.pointerId)
  let raf = 0
  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientY - startY) < 5) return
    if (!moved) {
      moved = true
      drop.page = page.id
      drop.from = i
      drop.files = false
      document.documentElement.classList.add('xp-dragging')
    }
    const s = slotAt(sheet, ev.clientY)
    drop.at = s.at
    drop.y = s.y
    // Cerca del borde de la ventana, la página se desplaza sola
    cancelAnimationFrame(raf)
    const edge = ev.clientY < 90 ? -14 : ev.clientY > window.innerHeight - 90 ? 14 : 0
    if (edge) raf = requestAnimationFrame(function scroll() {
      window.scrollBy(0, edge)
      raf = requestAnimationFrame(scroll)
    })
  }
  const end = (ev: PointerEvent) => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    cancelAnimationFrame(raf)
    document.documentElement.classList.remove('xp-dragging')
    if (moved) {
      suppressClick = true
      setTimeout(() => (suppressClick = false), 0)
      if (ev.type === 'pointerup') {
        const to = drop.at > i ? drop.at - 1 : drop.at
        moveBlock(page, i, to)
      }
    }
    drop.page = null
    drop.from = -1
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

function onHandleClick(toggle: () => void) {
  if (!suppressClick) toggle()
}

/** Teclado en el asa: Alt+↑ / Alt+↓ mueven el bloque */
function onHandleKey(e: KeyboardEvent, page: DocPage, i: number) {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  e.preventDefault()
  const id = page.blocks[i]!.id
  moveBlock(page, i, i + (e.key === 'ArrowUp' ? -1 : 1))
  nextTick(() => root.value?.querySelector<HTMLElement>(`[data-block="${id}"] .xp-handle`)?.focus())
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

function onDragOver(e: DragEvent, page: DocPage) {
  if (!hasFiles(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  const s = slotAt(e.currentTarget as Element, e.clientY)
  drop.page = page.id
  drop.files = true
  drop.at = s.at
  drop.y = s.y
}

function onDragLeave(e: DragEvent) {
  const sheet = e.currentTarget as HTMLElement
  if (!sheet.contains(e.relatedTarget as Node | null)) drop.page = null
}

function onDrop(e: DragEvent, page: DocPage) {
  if (!hasFiles(e)) return
  e.preventDefault()
  const at = drop.page === page.id ? drop.at : page.blocks.length
  drop.page = null
  insertImages(page, [...(e.dataTransfer?.files ?? [])], at)
}

/** Ctrl+V con una imagen copiada: entra debajo del bloque en el que se está escribiendo */
function onPaste(e: ClipboardEvent, page: DocPage) {
  const files = [...(e.clipboardData?.files ?? [])].filter(f => /^image\//.test(f.type))
  if (!files.length) return
  e.preventDefault()
  e.stopPropagation()
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-block]')?.dataset.block
  const i = page.blocks.findIndex(b => b.id === id)
  insertImages(page, files, i >= 0 ? i + 1 : page.blocks.length)
}

// ─── Guardar como plantilla / gestionarlas ───────────────────────────────────
const saveOpen = ref(false)
const manageOpen = ref(false)
const tplName = ref('')
const tplPage = ref<DocPage | null>(null)
const tplBusy = ref(false)
const tplExists = computed(() => !!templates.value?.some(t => t.name.toLowerCase() === tplName.value.trim().toLowerCase()))

function openSave(p: DocPage) {
  if (pageIsEmpty(p)) {
    toast.info('La página está vacía', 'Escribe algo o añade una imagen antes de guardarla como plantilla.')
    return
  }
  if (p.blocks.some(b => b.k === 'image' && !b.img)) {
    toast.info('Espera a que terminen de subirse las imágenes')
    return
  }
  tplPage.value = p
  tplName.value = p.title || ''
  saveOpen.value = true
}

async function saveTemplate() {
  if (!tplPage.value || !tplName.value.trim()) return
  tplBusy.value = true
  try {
    const r = await $fetch<{ list: PageTemplate[], replaced: boolean }>('/api/sales/page-templates', { method: 'POST', body: { name: tplName.value.trim(), page: tplPage.value } })
    templates.value = r.list
    saveOpen.value = false
    toast.success(r.replaced ? 'Plantilla actualizada' : 'Plantilla guardada', 'La tienes en «Añadir página» de cualquier factura o presupuesto.')
  }
  catch (err) {
    toast.error('No se pudo guardar la plantilla', errorMessage(err))
  }
  finally {
    tplBusy.value = false
  }
}

async function deleteTemplate(t: PageTemplate) {
  try {
    templates.value = await $fetch<PageTemplate[]>(`/api/sales/page-templates/${t.id}`, { method: 'DELETE' })
    toast.success('Plantilla borrada', 'Los documentos que ya la usan no cambian.')
  }
  catch (err) {
    toast.error('No se pudo borrar', errorMessage(err))
    refreshTemplates()
  }
}

function insertTemplate(t: PageTemplate) {
  manageOpen.value = false
  addPage(t.page)
}

const tplSummary = (t: PageTemplate) => {
  const imgs = t.page.blocks.filter(b => b.k === 'image').length
  const words = pagesToPlain([{ ...t.page, title: '' }]).replace(/\[Imagen[^\]]*\]/g, '').split(/\s+/).filter(Boolean).length
  return [words ? `${words} palabras` : null, imgs ? `${imgs} ${imgs === 1 ? 'imagen' : 'imágenes'}` : null].filter(Boolean).join(' · ') || 'Solo título'
}
</script>

<template>
  <div ref="root" class="xpages" :style="{ '--doc-accent': accent, '--doc-font': font }">
    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic" hidden @change="onFiles">

    <TransitionGroup name="xp-page">
      <section v-for="(p, pi) in pages" :key="p.id" class="xp" :data-page="p.id">
        <!-- Barra de la página (no se imprime): qué es y su menú -->
        <div v-ctx="() => pageCtx(p, pi)" class="xp-bar no-print">
          <span class="xp-chip">
            <Icon name="ph:file-text" aria-hidden="true" />
            Página adicional{{ pages.length > 1 ? ` ${pi + 1}` : '' }}
          </span>
          <span class="xp-bar-hint">Se añade tras {{ docLabel.toLowerCase().startsWith('presupuesto') ? 'el presupuesto' : 'la factura' }}, en hoja nueva</span>
          <UiMenu :items="pageMenu(p, pi)" :width="236">
            <template #default="{ toggle }">
              <button type="button" class="xp-bar-btn" aria-label="Opciones de la página" @click="toggle"><Icon name="ph:dots-three-bold" /></button>
            </template>
          </UiMenu>
        </div>

        <div
          class="paper xp-sheet"
          :class="{ 'drop-files': drop.page === p.id && drop.files }"
          @dragover="onDragOver($event, p)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, p)"
          @paste.capture="onPaste($event, p)"
        >
          <div class="xp-run" aria-hidden="true">
            <span class="xp-run-brand">{{ brand }}</span>
            <span>{{ docLabel }}</span>
          </div>

          <header class="xp-head">
            <input
              v-model="p.title"
              class="xp-title xp-title-in"
              placeholder="Título de la página"
              aria-label="Título de la página"
              maxlength="160"
              spellcheck="true"
              @keydown.enter.prevent="p.blocks[0]?.k === 'text' ? focusIn(`[data-block='${p.blocks[0].id}'] .rt-area`) : addText(p, 0)"
            >
            <div class="xp-rule" aria-hidden="true" />
          </header>

          <TransitionGroup name="xp-block" tag="div" class="xp-blocks">
            <div
              v-for="(b, bi) in p.blocks"
              :key="b.id"
              v-ctx="() => blockCtx(p, b, bi)"
              class="xp-item"
              :class="{ lifted: drop.page === p.id && !drop.files && drop.from === bi, sel: selected === b.id }"
              :data-block="b.id"
              :data-size="b.k === 'image' ? b.size : undefined"
              :data-align="b.k === 'image' ? b.align : undefined"
            >
              <!-- Asa: arrastrar para mover; clic para el menú del bloque -->
              <div class="xp-grip no-print">
                <UiMenu :items="blockMenu(p, b, bi)" :width="220" align="start">
                  <template #default="{ toggle }">
                  <button
                    type="button"
                    class="xp-handle"
                    :aria-label="`${b.k === 'image' ? 'Imagen' : 'Texto'}: arrastra para mover o pulsa para ver opciones (Alt+↑/↓ para mover)`"
                    :title="'Arrastra para mover · clic para opciones'"
                    @pointerdown="onHandleDown($event, p, bi)"
                    @click="onHandleClick(toggle)"
                    @keydown="onHandleKey($event, p, bi)"
                  >
                    <Icon name="ph:dots-six-vertical-bold" aria-hidden="true" />
                  </button>
                </template>
                </UiMenu>
              </div>

              <SalesPageText
                v-if="b.k === 'text'"
                v-model="b.doc"
                :context="() => textContext(p, b)"
                :placeholder="bi === 0 ? 'Escribe aquí las condiciones, la memoria del proyecto o lo que necesites… (o pide a la IA que lo redacte)' : 'Escribe aquí…'"
                class="xp-block"
              />

              <template v-else>
                <figure class="xp-block xp-fig xp-fig-edit" :data-size="b.size" :data-align="b.align" :class="{ pending: pendingIds.has(b.id) }">
                  <div class="xp-img-wrap" tabindex="0" :aria-label="`Imagen${b.caption ? `: ${b.caption}` : ''}. Pulsa para ver sus opciones`" @pointerdown="selected = b.id" @focus="selected = b.id">
                    <img v-if="imgSrc(b)" :src="imgSrc(b)" :alt="b.caption || 'Imagen de la página'" class="xp-img" draggable="false">
                    <span v-if="pendingIds.has(b.id)" class="xp-loading" aria-live="polite"><span class="xp-spin" aria-hidden="true" /> Subiendo…</span>
                  </div>
                  <input
                    v-if="b.caption != null || captions.has(b.id)"
                    v-model="b.caption"
                    class="xp-cap xp-cap-in"
                    placeholder="Pie de foto (opcional)"
                    aria-label="Pie de foto"
                    maxlength="300"
                    @blur="!b.caption && captions.delete(b.id)"
                  >
                </figure>
                <!-- Herramientas de la imagen: tamaño, alineación, pie, cambiar y quitar -->
                <div class="xp-tools no-print" role="toolbar" aria-label="Imagen">
                  <div class="xp-seg" role="group" aria-label="Tamaño">
                    <button v-for="sz in SIZES" :key="sz.v" type="button" :class="{ on: b.size === sz.v }" :aria-pressed="b.size === sz.v" :title="sz.title" @click="b.size = sz.v">{{ sz.label }}</button>
                  </div>
                  <span class="xp-tools-sep" aria-hidden="true" />
                  <button v-for="a in ALIGNS" :key="a.v" type="button" class="xp-tool" :class="{ on: b.align === a.v }" :aria-pressed="b.align === a.v" :title="a.title" :aria-label="a.title" @click="b.align = a.v">
                    <Icon :name="a.icon" aria-hidden="true" />
                  </button>
                  <span class="xp-tools-sep" aria-hidden="true" />
                  <button type="button" class="xp-tool" :class="{ on: b.caption != null || captions.has(b.id) }" title="Pie de foto" aria-label="Pie de foto" @click="toggleCaption(b)"><Icon name="ph:subtitles" aria-hidden="true" /></button>
                  <button type="button" class="xp-tool" title="Cambiar imagen" aria-label="Cambiar imagen" @click="pickImages(p, bi, b)"><Icon name="ph:arrows-clockwise" aria-hidden="true" /></button>
                  <button type="button" class="xp-tool danger" title="Quitar imagen" aria-label="Quitar imagen" @click="removeBlock(p, bi)"><Icon name="ph:trash" aria-hidden="true" /></button>
                </div>
              </template>
            </div>
          </TransitionGroup>

          <!-- Dónde caerá el bloque o la foto que se arrastra -->
          <div v-if="drop.page === p.id && drop.at >= 0" class="xp-drop no-print" :style="{ top: `${drop.y}px` }" aria-hidden="true">
            <span v-if="drop.files" class="xp-drop-t"><Icon name="ph:image" /> Suelta para añadir</span>
          </div>

          <div class="xp-add no-print">
            <button type="button" class="add-btn" @click="addText(p)"><Icon name="ph:text-align-left" /> Texto</button>
            <button type="button" class="add-btn" @click="pickImages(p, p.blocks.length)"><Icon name="ph:image" /> Imagen</button>
            <span class="add-hint">o arrastra fotos a la hoja · Ctrl+V para pegarlas</span>
          </div>
        </div>
      </section>
    </TransitionGroup>

    <!-- Añadir página -->
    <div class="xp-new-wrap no-print">
      <UiMenu :items="addMenu" :width="290" align="start">
      <template #default="{ toggle, open }">
        <button type="button" class="xp-new" :class="{ open }" :aria-expanded="open" @click="toggle">
          <span class="xp-new-ic" aria-hidden="true"><Icon name="ph:file-plus" /></span>
          <span class="xp-new-t">
            <strong>{{ pages.length ? 'Añadir otra página' : 'Añadir página' }}</strong>
            <small>Condiciones generales, memoria del proyecto, fotos… con texto e imágenes</small>
          </span>
          <Icon name="ph:caret-down" class="xp-new-caret" aria-hidden="true" />
        </button>
      </template>
      </UiMenu>
    </div>

    <!-- Guardar como plantilla -->
    <UiModal v-model="saveOpen" title="Guardar como plantilla" subtitle="Para añadir esta página a otros documentos con un clic" size="sm">
      <form id="xp-tpl" class="xp-form" @submit.prevent="saveTemplate">
        <UiInput v-model="tplName" label="Nombre de la plantilla" placeholder="Condiciones generales" maxlength="80" required />
        <p v-if="tplExists" class="xp-note"><Icon name="ph:info" aria-hidden="true" /> Ya tienes una plantilla con ese nombre: se sustituirá por esta página.</p>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="saveOpen = false">Cancelar</UiButton>
        <UiButton variant="primary" type="submit" form="xp-tpl" icon="ph:bookmark-simple" :loading="tplBusy" :disabled="!tplName.trim()">{{ tplExists ? 'Sustituir' : 'Guardar' }}</UiButton>
      </template>
    </UiModal>

    <!-- Gestionar plantillas -->
    <UiModal v-model="manageOpen" title="Plantillas de página" subtitle="Páginas guardadas para reutilizar en facturas y presupuestos" size="md">
      <ul v-if="templates?.length" class="xp-tpls">
        <li v-for="t in templates" :key="t.id" class="xp-tpl">
          <span class="xp-tpl-ic" aria-hidden="true"><Icon name="ph:bookmark-simple-fill" /></span>
          <span class="grow min0">
            <span class="xp-tpl-n">{{ t.name }}</span>
            <span class="xp-tpl-s">{{ tplSummary(t) }} · {{ fdateShort(t.updatedAt.slice(0, 10)) }}</span>
          </span>
          <UiButton size="sm" variant="soft" icon="ph:plus" @click="insertTemplate(t)">Añadir</UiButton>
          <UiButton size="sm" variant="ghost" square icon="ph:trash" :aria-label="`Borrar la plantilla ${t.name}`" @click="deleteTemplate(t)" />
        </li>
      </ul>
      <UiEmpty v-else icon="ph:bookmark-simple" title="Sin plantillas" description="Guarda una página con su menú (⋯ → Guardar como plantilla)." />
    </UiModal>
  </div>
</template>

<style scoped>
.xpages {
  display: flex;
  flex-direction: column;
  gap: 26px;
  margin-top: 26px;
}

/* ─── Barra de cada página ─── */
.xp-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 900px;
  margin: 0 auto 10px;
  width: 100%;
  padding: 0 4px;
}

.xp-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 650;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 999px;
  white-space: nowrap;
}

.xp-bar-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12.5px;
  color: var(--text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* El menú, siempre a la derecha (en el móvil no hay texto que lo empuje) */
.xp-bar > :last-child {
  margin-left: auto;
}

.xp-bar-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--text-2);
  border-radius: 8px;
  transition: background var(--t-fast), color var(--t-fast);
}

.xp-bar-btn:hover {
  color: var(--text);
  background: var(--surface-hover);
}

/* ─── La hoja ─── */
.xp-sheet {
  min-height: 420px;
  transition: box-shadow var(--t-fast);
}

.xp-sheet.drop-files {
  box-shadow: 0 0 0 2px var(--p-accent), 0 12px 40px -12px rgb(16 24 40 / 0.18);
}

/* Título: un campo que se ve como el título del documento */
.xp-title-in {
  display: block;
  width: calc(100% + 16px);
  margin: 0 -8px;
  padding: 4px 8px;
  font-family: inherit;
  color: var(--p-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  outline: none;
  transition: background var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast);
  color-scheme: light;
}

.xp-title-in::placeholder {
  color: #b4b9c4;
}

.xp-title-in:hover {
  background: var(--p-soft);
}

.xp-title-in:focus {
  background: #fff;
  border-color: var(--p-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-accent) 14%, transparent);
}

.xp-blocks {
  position: relative;
}

/* ─── Cada bloque, con su asa a la izquierda (en el margen de la hoja) ─── */
.xp-item {
  position: relative;
  border-radius: 10px;
  transition: opacity var(--t-fast);
}

.xp-item + .xp-item {
  margin-top: 20px;
}

.xp-item.lifted {
  opacity: 0.4;
}

.xp-grip {
  position: absolute;
  top: 3px;
  right: 100%;
  margin-right: 8px;
}

.xp-handle {
  display: grid;
  place-items: center;
  width: 24px;
  height: 30px;
  font-size: 16px;
  color: #9aa1ae;
  border-radius: 6px;
  cursor: grab;
  opacity: 0;
  touch-action: none;
  transition: opacity var(--t-fast), background var(--t-fast), color var(--t-fast);
}

.xp-item:hover .xp-handle,
.xp-handle:focus-visible,
.xp-item:focus-within .xp-handle {
  opacity: 1;
}

.xp-handle:hover {
  color: var(--p-text);
  background: var(--p-soft);
}

.xp-handle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--p-accent);
}

:global(html.xp-dragging),
:global(html.xp-dragging *) {
  cursor: grabbing !important;
  user-select: none !important;
}

/* El primer texto de la página, con sitio para escribir */
.xp-item:first-child :deep(.rt-area) {
  min-height: 90px;
}

/* ─── Imagen en edición ─── */
.xp-img-wrap {
  position: relative;
  min-height: 60px;
  border-radius: 6px;
  background: var(--p-soft);
}

.xp-fig-edit .xp-img {
  transition: opacity var(--t-fast);
}

.xp-fig-edit.pending .xp-img {
  opacity: 0.55;
}

.xp-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--p-text);
  white-space: nowrap;
  background: rgb(255 255 255 / 0.92);
  border-radius: 999px;
  box-shadow: 0 4px 16px -6px rgb(16 24 40 / 0.3);
  transform: translate(-50%, -50%);
}

.xp-spin {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--p-accent) 25%, transparent);
  border-top-color: var(--p-accent);
  border-radius: 50%;
  animation: xp-spin 0.7s linear infinite;
}

@keyframes xp-spin {
  to { transform: rotate(360deg); }
}

.xp-tools {
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  white-space: nowrap;
  background: #fff;
  border: 1px solid var(--p-line-strong);
  border-radius: 10px;
  box-shadow: 0 10px 28px -10px rgb(16 24 40 / 0.35);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -4px);
  transition: opacity 140ms var(--ease-out), transform 160ms var(--ease-out);
}

.xp-item:hover .xp-tools,
.xp-item:focus-within .xp-tools,
.xp-item.sel .xp-tools {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, 0);
}

/* Imagen pequeña o mediana: las herramientas salen por encima, alineadas con ella */
.xp-item[data-size='s'] .xp-tools,
.xp-item[data-size='m'] .xp-tools {
  top: -46px;
}

/* Puente invisible entre la barra y la imagen: el ratón no la pierde al subir */
.xp-tools::after {
  content: '';
  position: absolute;
  inset: 100% 0 auto;
  height: 10px;
}

.xp-item[data-align='left']:is([data-size='s'], [data-size='m']) .xp-tools {
  left: 0;
  transform: translateY(-4px);
}

.xp-item[data-align='right']:is([data-size='s'], [data-size='m']) .xp-tools {
  left: auto;
  right: 0;
  transform: translateY(-4px);
}

.xp-item:is(:hover, :focus-within, .sel)[data-align='left']:is([data-size='s'], [data-size='m']) .xp-tools,
.xp-item:is(:hover, :focus-within, .sel)[data-align='right']:is([data-size='s'], [data-size='m']) .xp-tools {
  transform: none;
}

.xp-img-wrap:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--p-accent);
}

.xp-seg {
  display: inline-flex;
  padding: 2px;
  background: var(--p-soft);
  border-radius: 7px;
}

.xp-seg button {
  min-width: 28px;
  height: 26px;
  padding: 0 7px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 650;
  color: var(--p-text-3);
  border-radius: 6px;
  transition: background var(--t-fast), color var(--t-fast);
}

.xp-seg button:hover {
  color: var(--p-text);
}

.xp-seg button.on {
  color: var(--p-text);
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
}

.xp-tool {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  font-size: 16px;
  color: var(--p-text-2);
  border-radius: 7px;
  transition: background var(--t-fast), color var(--t-fast);
}

.xp-tool:hover {
  color: var(--p-text);
  background: var(--p-soft);
}

.xp-tool.on {
  color: var(--p-accent);
  background: color-mix(in srgb, var(--p-accent) 12%, #fff);
}

.xp-tool.danger:hover {
  color: #b42318;
  background: #fef3f2;
}

.xp-tools-sep {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--p-line);
}

.xp-seg button:focus-visible,
.xp-tool:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--p-accent);
}

.xp-cap-in {
  display: block;
  width: 100%;
  padding: 4px 6px;
  font: inherit;
  font-size: 12px;
  text-align: inherit;
  color: var(--p-text-3);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  outline: none;
  color-scheme: light;
}

.xp-cap-in:hover {
  background: var(--p-soft);
}

.xp-cap-in:focus {
  color: var(--p-text-2);
  background: #fff;
  border-color: var(--p-accent);
}

/* Línea donde caerá lo que se arrastra */
.xp-drop {
  position: absolute;
  right: 60px;
  left: 60px;
  z-index: 5;
  height: 3px;
  margin-top: -1.5px;
  background: var(--p-accent);
  border-radius: 2px;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-accent) 18%, transparent);
  pointer-events: none;
}

.xp-drop::before,
.xp-drop::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  background: #fff;
  border: 2.5px solid var(--p-accent);
  border-radius: 50%;
  transform: translateY(-50%);
}

.xp-drop::before { left: -5px; }
.xp-drop::after { right: -5px; }

.xp-drop-t {
  position: absolute;
  bottom: 8px;
  left: 50%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 650;
  color: var(--p-on-accent, #fff);
  white-space: nowrap;
  background: var(--p-accent);
  border-radius: 999px;
  transform: translateX(-50%);
}

/* ─── Añadir bloques ─── */
.xp-add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px dashed var(--p-line);
}

.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px 7px 9px;
  font-family: var(--font-sans);
  font-weight: 600;
  color: var(--p-accent);
  border-radius: 8px;
  transition: background var(--t-fast);
}

.add-btn:hover {
  background: color-mix(in srgb, var(--p-accent) 8%, transparent);
}

.add-btn :deep(svg) {
  width: 18px;
  height: 18px;
}

.add-hint {
  margin-left: 6px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--p-text-3);
}

/* ─── Añadir página ─── */
.xp-new-wrap {
  display: block;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
}

.xp-new-wrap :deep(.menu) {
  display: block;
}

.xp-new {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px 20px;
  text-align: left;
  color: var(--text-2);
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  border: 1.5px dashed var(--border-strong);
  border-radius: 14px;
  transition: border-color var(--t-fast), background var(--t-fast), color var(--t-fast);
}

.xp-new:hover,
.xp-new.open {
  color: var(--text);
  background: var(--surface);
  border-color: color-mix(in srgb, var(--brand) 55%, transparent);
}

.xp-new:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.xp-new-ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  font-size: 21px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 11px;
}

.xp-new-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.xp-new-t strong {
  font-weight: 650;
}

.xp-new-t small {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.xp-new-caret {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--text-3);
  transition: transform var(--t-fast);
}

.xp-new.open .xp-new-caret {
  transform: rotate(180deg);
}

/* ─── Plantillas ─── */
.xp-form {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.xp-note {
  display: flex;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.xp-note :deep(svg) {
  flex: none;
  margin-top: 2px;
}

.xp-tpls {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.xp-tpl {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 10px 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.xp-tpl-ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 34px;
  height: 34px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 9px;
}

.xp-tpl-n {
  display: block;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.xp-tpl-s {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.min0 {
  min-width: 0;
}

/* ─── Animaciones ─── */
.xp-block-move,
.xp-page-move {
  transition: transform 260ms var(--ease-out);
}

.xp-block-enter-active,
.xp-page-enter-active {
  transition: opacity 220ms var(--ease-out), transform 260ms var(--ease-out);
}

.xp-block-enter-from,
.xp-page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.xp-block-leave-active,
.xp-page-leave-active {
  display: none;
}

/* Hoja estrecha (móvil): el asa necesita su margen a la izquierda */
@media (max-width: 767px) {
  .xp-sheet {
    min-height: 300px;
    padding-left: 38px;
  }

  .xp-grip {
    margin-right: 4px;
  }

  .xp-handle {
    width: 26px;
    opacity: 0.6;
  }

  .xp-drop {
    right: 20px;
    left: 38px;
  }

  .xp-bar-hint,
  .add-hint {
    display: none;
  }

  /* Las herramientas de la imagen, debajo de ella (no caben encima) y solo al tocarla */
  .xp-item .xp-tools,
  .xp-item:is(:hover, :focus-within, .sel) .xp-tools {
    position: static;
    display: none;
    flex-wrap: wrap;
    justify-content: center;
    width: fit-content;
    max-width: 100%;
    margin: 8px auto 0;
    white-space: normal;
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  .xp-item.sel .xp-tools,
  .xp-item:focus-within .xp-tools {
    display: flex;
  }
}

@media (hover: none) {
  .xp-handle {
    opacity: 0.6;
  }
}
</style>
