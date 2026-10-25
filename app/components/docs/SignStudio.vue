<script setup lang="ts">
import type { CreatedSignature } from '~/components/signature/Creator.vue'
import type { CtxSpec } from '~/composables/useContextMenu'
import type { StampSource } from '~/composables/useSignSession'

/**
 * Modo firma del visor: bandeja con tus firmas (tocar para colocar, o arrastrar al sitio exacto),
 * barra flotante sobre la firma elegida, creación de firmas sin salir del documento y guardado de la copia
 * firmada junto al original (o descarga, si el documento no está guardado en NUMIQ).
 */
const props = defineProps<{
  kind: 'pdf' | 'image'
  /** Página a la vista (desde 0) */
  page: number
  pages: number
  name: string
  mime: string
  pdf?: ArrayBuffer
  objectUrl: string
  fileId?: number | null
}>()
interface SavedFile { id: number, originalName: string, mime: string, size: number, createdAt: string, updated: boolean }
const emit = defineEmits<{ exit: [], saved: [file: SavedFile] }>()

const session = inject(SIGN_SESSION)!
const toast = useToast()
const { list: saved, load, create, remove: removeSignature, makeDefault } = useSignatures()

const failed = ref(false)
onMounted(async () => {
  try {
    const l = await load()
    if (!l?.length) creatorOpen.value = true
  }
  catch {
    failed.value = true
  }
})

// ─── Firmas disponibles: las guardadas, las de solo este documento y los sellos de fecha ───
const temps = ref<StampSource[]>([])
const urls: string[] = []
const blobs = new Map<string, Blob>()
const sources = computed<StampSource[]>(() => [
  ...(saved.value ?? []).map(s => ({ key: `sig:${s.id}`, src: s.url, ratio: s.height / s.width, label: s.name })),
  ...temps.value,
])
let tmpSeq = 0

function local(blob: Blob, label: string, ratio: number, prefix: string, width?: number): StampSource {
  const src = URL.createObjectURL(blob)
  urls.push(src)
  const key = `${prefix}:${++tmpSeq}`
  blobs.set(key, blob)
  return { key, src, ratio, label, width }
}

function place(s: StampSource, at?: { x: number, y: number }) {
  const page = at ? pageAt(at.x, at.y) ?? props.page : props.page
  const p = session.add(s, page, at)
  if (p) navigator.vibrate?.(6)
}

function pageAt(x: number, y: number) {
  for (const el of document.elementsFromPoint(x, y)) {
    const page = (el as HTMLElement).dataset?.signPage
    if (page != null) return Number(page)
  }
  return null
}

async function addDate() {
  const d = new Date()
  const text = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  const canvas = await textStamp(text, INK_COLORS[0].value)
  if (!canvas) return
  place(local(await canvasPng(canvas), `Fecha ${text}`, canvas.height / canvas.width, 'date', 0.16))
}

// ─── Arrastrar desde la bandeja (ratón): la firma sigue al cursor y se suelta en su sitio ───
const ghost = ref<{ src: string, x: number, y: number, w: number, ratio: number, over: boolean } | null>(null)
let press: { s: StampSource, x: number, y: number, id: number } | null = null
let suppressClick = false

function trayDown(e: PointerEvent, s: StampSource) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return
  press = { s, x: e.clientX, y: e.clientY, id: e.pointerId }
  window.addEventListener('pointermove', trayMove, true)
  window.addEventListener('pointerup', trayUp, true)
}
function trayMove(e: PointerEvent) {
  if (!press || e.pointerId !== press.id) return
  if (!ghost.value && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return
  const layer = document.querySelector<HTMLElement>(`[data-sign-page="${props.page}"]`)
  const w = (press.s.width ?? (press.s.ratio > 0.5 ? 0.3 * 0.5 / press.s.ratio : 0.3)) * (layer?.clientWidth ?? 600)
  ghost.value = { src: press.s.src, x: e.clientX, y: e.clientY, w, ratio: press.s.ratio, over: pageAt(e.clientX, e.clientY) != null }
}
function trayUp(e: PointerEvent) {
  window.removeEventListener('pointermove', trayMove, true)
  window.removeEventListener('pointerup', trayUp, true)
  const p = press
  press = null
  if (!p || !ghost.value) return
  ghost.value = null
  suppressClick = true
  setTimeout(() => (suppressClick = false), 0)
  if (pageAt(e.clientX, e.clientY) != null) place(p.s, { x: e.clientX, y: e.clientY })
}
function trayClick(s: StampSource) {
  if (suppressClick) return
  place(s)
}

// ─── Barra flotante sobre la firma elegida ───
const bar = ref<{ x: number, y: number, below: boolean } | null>(null)
let raf = 0
function track() {
  raf = requestAnimationFrame(track)
  const id = session.selected.value
  const el = id != null && !session.active.value ? document.querySelector<HTMLElement>(`[data-placement="${id}"]`) : null
  if (!el) {
    if (bar.value) bar.value = null
    return
  }
  const r = el.getBoundingClientRect()
  const body = document.querySelector('.fv-body')?.getBoundingClientRect()
  const top = body?.top ?? 0
  const below = r.top - 56 < top
  const x = Math.min(Math.max(r.left + r.width / 2, 120), window.innerWidth - 120)
  const y = below ? r.bottom + 14 : r.top - 14
  if (!bar.value || bar.value.x !== x || bar.value.y !== y || bar.value.below !== below) bar.value = { x, y, below }
}
onMounted(() => (raf = requestAnimationFrame(track)))
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('pointermove', trayMove, true)
  window.removeEventListener('pointerup', trayUp, true)
  urls.forEach(u => URL.revokeObjectURL(u))
  session.dispose()
})

const selectedLabel = computed(() => session.placements.value.find(p => p.id === session.selected.value)?.label ?? '')
function everyPage() {
  const n = session.everyPage()
  if (n) toast.success('En todas las páginas', `Añadida en ${n} ${n === 1 ? 'página más' : 'páginas más'}.`)
  else toast.info('Ya está en todas las páginas')
}

// ─── Nueva firma sin salir del documento ───
const creatorOpen = ref(false)
const creator = ref<{ submit: () => Promise<CreatedSignature | null>, ready: boolean } | null>(null)
const keep = ref(true)
const creating = ref(false)

async function useNew() {
  if (!creator.value?.ready) return
  creating.value = true
  try {
    const sig = await creator.value.submit()
    if (!sig) return
    if (keep.value) {
      const s = await create(sig)
      creatorOpen.value = false
      await nextTick()
      place({ key: `sig:${s.id}`, src: s.url, ratio: s.height / s.width, label: s.name })
      toast.success('Firma guardada en Ajustes', 'La tendrás a mano en cualquier documento.')
    }
    else {
      const s = local(sig.blob, sig.name, sig.height / sig.width, 'tmp')
      temps.value = [...temps.value, s]
      creatorOpen.value = false
      await nextTick()
      place(s)
    }
  }
  catch (err) {
    toast.error('No se pudo guardar la firma', errorMessage(err))
  }
  finally {
    creating.value = false
  }
}

// ─── Eliminar firmas de la bandeja (las guardadas, con confirmación) ───
const savedId = (s: StampSource) => (s.key.startsWith('sig:') ? Number(s.key.slice(4)) : null)
const toDelete = ref<StampSource | null>(null)
const deleting = ref(false)
const usedCount = computed(() => (toDelete.value ? session.placements.value.filter(p => p.key === toDelete.value!.key).length : 0))

function askDelete(s: StampSource) {
  if (savedId(s)) toDelete.value = s
  else temps.value = temps.value.filter(t => t.key !== s.key)
}

async function confirmDelete() {
  const s = toDelete.value
  const id = s ? savedId(s) : null
  if (!s || !id || deleting.value) return
  deleting.value = true
  try {
    // Lo ya colocado con esta firma sigue valiendo: su imagen pasa a una copia local de este documento
    if (session.placements.value.some(p => p.key === s.key)) {
      const blob = await (await fetch(s.src)).blob()
      const src = URL.createObjectURL(blob)
      urls.push(src)
      blobs.set(s.key, blob)
      session.rewriteSrc(s.key, src)
    }
    await removeSignature(id)
    toDelete.value = null
    toast.success('Firma eliminada', `«${s.label}» ya no está en tus firmas. Los documentos firmados con ella no cambian.`)
  }
  catch (err) {
    toast.error('No se pudo eliminar la firma', errorMessage(err))
  }
  finally {
    deleting.value = false
  }
}

async function setMain(id: number, label: string) {
  try {
    await makeDefault(id)
    toast.success(`«${label}» es tu firma principal`)
  }
  catch (err) {
    toast.error('No se pudo cambiar', errorMessage(err))
  }
}

function chipMenu(s: StampSource): CtxSpec {
  const id = savedId(s)
  const sig = id ? saved.value?.find(x => x.id === id) : null
  return {
    title: s.label,
    subtitle: id ? (sig?.isDefault ? 'Firma principal' : 'Guardada en tus firmas') : 'Solo para este documento',
    icon: 'ph:signature',
    items: [
      { label: 'Colocar en la página', icon: 'ph:plus-circle', onClick: () => place(s) },
      ...(id && sig && !sig.isDefault ? [{ label: 'Usar como principal', icon: 'ph:star', onClick: () => setMain(id, s.label) }] : []),
      { divider: true },
      { label: id ? 'Eliminar firma…' : 'Quitar de la bandeja', icon: 'ph:trash', danger: true, onClick: () => askDelete(s) },
    ],
  }
}

// ─── Salir, descargar y guardar ───
const askDiscard = ref(false)
const busy = ref<'save' | 'download' | null>(null)
const count = computed(() => session.placements.value.length)

function requestExit() {
  if (busy.value) return
  if (count.value) askDiscard.value = true
  else emit('exit')
}

const srcOf = (key: string) => sources.value.find(s => s.key === key)?.src ?? session.placements.value.find(p => p.key === key)?.src ?? ''
async function pngBytes(key: string) {
  const blob = blobs.get(key) ?? await (await fetch(srcOf(key))).blob()
  return new Uint8Array(await blob.arrayBuffer())
}

function signedName(type: string) {
  const ext = type === 'application/pdf' ? 'pdf' : type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'
  return `${props.name.replace(/\.[^.]+$/, '').replace(/\s*\(firmado\)$/i, '')} (firmado).${ext}`
}

async function build() {
  const list = session.placements.value.map(p => ({ page: p.page, x: p.x, y: p.y, w: p.w, ratio: p.ratio, key: p.key }))
  if (props.kind === 'pdf') {
    if (!props.pdf) throw new Error('El PDF aún no está cargado.')
    const bytes = await stampPdf(props.pdf, list, pngBytes)
    return new Blob([bytes as BlobPart], { type: 'application/pdf' })
  }
  return await stampImage(props.objectUrl, props.mime, list, key => loadImage(srcOf(key)))
}

async function download() {
  if (!count.value || busy.value) return
  busy.value = 'download'
  try {
    const blob = await build()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = signedName(blob.type)
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    toast.success('Documento firmado descargado', a.download)
  }
  catch (err) {
    toast.error('No se pudo firmar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function save() {
  if (!props.fileId) return download()
  if (!count.value || busy.value) return
  busy.value = 'save'
  try {
    const blob = await build()
    const body = new FormData()
    body.append('file', blob, signedName(blob.type))
    const file = await $fetch<SavedFile>(`/api/files/${props.fileId}/signed`, { method: 'POST', body })
    if (file.updated) toast.success('Copia firmada actualizada', `«${file.originalName}» ya lleva las firmas nuevas.`)
    else toast.success('Documento firmado', `Guardado como «${file.originalName}», junto al original.`)
    emit('saved', file)
  }
  catch (err) {
    toast.error('No se pudo guardar el documento firmado', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

// ─── Teclado (lo llama el visor, que recibe todas las teclas) ───
function handleKey(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  if (creatorOpen.value) {
    if (e.key !== 'Escape') return false
    e.preventDefault()
    creatorOpen.value = false
    return true
  }
  if (toDelete.value) {
    if (e.key === 'Escape') {
      e.preventDefault()
      toDelete.value = null
      return true
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmDelete()
      return true
    }
    return false
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    if (askDiscard.value) askDiscard.value = false
    else if (session.selected.value != null) session.selected.value = null
    else requestExit()
    return true
  }
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return false
  const k = e.key.toLowerCase()
  const stop = (run: () => void) => {
    e.preventDefault()
    run()
    return true
  }
  if (mod && k === 'z') return stop(() => (e.shiftKey ? session.redo() : session.undo()))
  if (mod && k === 'y') return stop(session.redo)
  if (mod && k === 's') return stop(save)
  if (session.selected.value == null) return false
  if (mod && k === 'd') return stop(() => session.duplicate())
  if (e.key === 'Delete' || e.key === 'Backspace') return stop(() => session.remove())
  const step = e.shiftKey ? 10 : 1
  if (e.key === 'ArrowLeft') return stop(() => session.nudge(-step, 0))
  if (e.key === 'ArrowRight') return stop(() => session.nudge(step, 0))
  if (e.key === 'ArrowUp') return stop(() => session.nudge(0, -step))
  if (e.key === 'ArrowDown') return stop(() => session.nudge(0, step))
  return false
}

defineExpose({ handleKey, save, download, requestExit, busy, count, sources, place })
</script>

<template>
  <!-- Bandeja de firmas -->
  <div class="sg-dock">
    <Transition name="sg-hint">
      <p v-if="!count && sources.length && !creatorOpen" class="sg-hint" aria-live="polite">
        <Icon name="ph:hand-tap" aria-hidden="true" />
        <span class="hide-touch">Pulsa una firma para colocarla o arrástrala a su sitio</span>
        <span class="only-touch">Toca una firma para colocarla y muévela con el dedo</span>
      </p>
      <p v-else-if="count === 1 && session.selected.value != null && !creatorOpen" class="sg-hint" aria-live="polite">
        <Icon name="ph:arrows-out-cardinal" aria-hidden="true" /> Arrástrala para moverla · tira de una esquina para cambiar el tamaño
      </p>
    </Transition>

    <div class="sg-tray" role="toolbar" aria-label="Firmas">
      <div class="sg-list">
        <div v-for="s in sources" :key="s.key" v-ctx="() => chipMenu(s)" class="sg-item">
          <button
            type="button"
            class="sg-chip"
            :title="`Colocar «${s.label}»`"
            @pointerdown="trayDown($event, s)"
            @click="trayClick(s)"
          >
            <span class="sg-paper"><img :src="s.src" alt="" draggable="false"></span>
            <span class="sg-label">{{ s.label }}</span>
          </button>
          <button
            type="button"
            class="sg-del"
            :title="savedId(s) ? 'Eliminar firma' : 'Quitar de la bandeja'"
            :aria-label="savedId(s) ? `Eliminar la firma «${s.label}»` : `Quitar «${s.label}» de la bandeja`"
            @pointerdown.stop
            @click.stop="askDelete(s)"
          >
            <Icon name="ph:trash-bold" />
          </button>
        </div>
        <button type="button" class="sg-chip sg-new" :class="{ alone: !sources.length }" @click="creatorOpen = true">
          <span class="sg-new-ic"><Icon name="ph:plus-bold" /></span>
          <span class="sg-label">{{ sources.length ? 'Nueva firma' : 'Crea tu firma' }}</span>
        </button>
      </div>
      <span class="sg-sep" aria-hidden="true" />
      <button type="button" class="sg-tool" title="Añadir la fecha de hoy" @click="addDate">
        <Icon name="ph:calendar-check" /><span class="sg-tool-t">Fecha</span>
      </button>
      <button type="button" class="sg-tool icon" :disabled="!session.canUndo.value" title="Deshacer (Ctrl+Z)" aria-label="Deshacer" @click="session.undo()">
        <Icon name="ph:arrow-counter-clockwise-bold" />
      </button>
      <button type="button" class="sg-tool icon hide-touch" :disabled="!session.canRedo.value" title="Rehacer (Ctrl+Mayús+Z)" aria-label="Rehacer" @click="session.redo()">
        <Icon name="ph:arrow-clockwise-bold" />
      </button>
    </div>
  </div>

  <!-- Barra de la firma elegida -->
  <Teleport to="body">
    <Transition name="sg-bar">
      <div v-if="bar && session.selected.value != null" class="sg-bar" :class="{ below: bar.below }" :style="{ left: `${bar.x}px`, top: `${bar.y}px` }" role="toolbar" :aria-label="`Firma: ${selectedLabel}`" @pointerdown.stop>
        <button type="button" class="sg-bar-btn" title="Duplicar (Ctrl+D)" @click="session.duplicate()"><Icon name="ph:copy-simple" /><span>Duplicar</span></button>
        <button v-if="kind === 'pdf' && pages > 1" type="button" class="sg-bar-btn" title="Poner en todas las páginas" @click="everyPage"><Icon name="ph:stack" /><span>Todas las páginas</span></button>
        <span class="sg-bar-sep" aria-hidden="true" />
        <button type="button" class="sg-bar-btn danger" title="Quitar (Supr)" aria-label="Quitar la firma" @click="session.remove()"><Icon name="ph:trash" /></button>
      </div>
    </Transition>
    <div v-if="ghost" class="sg-ghost" :class="{ over: ghost.over }" :style="{ left: `${ghost.x}px`, top: `${ghost.y}px`, width: `${ghost.w}px`, aspectRatio: `${1 / ghost.ratio}` }" aria-hidden="true">
      <img :src="ghost.src" alt="">
    </div>
  </Teleport>

  <!-- ¿Descartar? -->
  <Transition name="sg-pop">
    <div v-if="askDiscard" class="sg-ask" role="alertdialog" aria-labelledby="sg-ask-t">
      <p id="sg-ask-t" class="sg-ask-t">¿Descartar {{ count === 1 ? 'la firma colocada' : `las ${count} firmas colocadas` }}?</p>
      <p class="sg-ask-s">El documento queda como estaba.</p>
      <div class="sg-ask-acts">
        <button type="button" class="sg-pill ghost" @click="askDiscard = false">Seguir firmando</button>
        <button type="button" class="sg-pill danger" @click="emit('exit')">Descartar</button>
      </div>
    </div>
  </Transition>

  <!-- ¿Eliminar firma guardada? -->
  <Transition name="sg-sheet">
    <div v-if="toDelete" class="sg-sheet-wrap" @pointerdown.self="toDelete = null">
      <div class="sg-confirm" role="alertdialog" aria-modal="true" aria-labelledby="sg-del-t" aria-describedby="sg-del-s">
        <span class="sg-confirm-paper"><img :src="toDelete.src" alt=""></span>
        <p id="sg-del-t" class="sg-confirm-t">¿Eliminar la firma «{{ toDelete.label }}»?</p>
        <p id="sg-del-s" class="sg-confirm-s">
          Desaparece de tus firmas en todos los documentos. Lo que ya firmaste con ella no cambia.
          <template v-if="usedCount">{{ usedCount === 1 ? ' La que has colocado aquí se queda.' : ` Las ${usedCount} que has colocado aquí se quedan.` }}</template>
        </p>
        <div class="sg-confirm-acts">
          <UiButton :disabled="deleting" @click="toDelete = null">Cancelar</UiButton>
          <UiButton variant="danger" icon="ph:trash" :loading="deleting" @click="confirmDelete">Eliminar firma</UiButton>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Crear firma -->
  <Transition name="sg-sheet">
    <div v-if="creatorOpen" class="sg-sheet-wrap" @pointerdown.self="creatorOpen = false">
      <div class="sg-sheet" role="dialog" aria-modal="true" aria-label="Nueva firma">
        <header class="sg-sheet-head">
          <div>
            <p class="sg-sheet-t">{{ saved?.length || temps.length ? 'Nueva firma' : 'Crea tu firma' }}</p>
            <p class="sg-sheet-s">Dibújala, escríbela o sube una foto. Se coloca en la página al terminar.</p>
          </div>
          <button type="button" class="sg-x" aria-label="Cerrar" @click="creatorOpen = false"><Icon name="ph:x-bold" /></button>
        </header>
        <div class="sg-sheet-body">
          <SignatureCreator ref="creator" />
          <p v-if="failed" class="sg-warn">No se pudieron cargar tus firmas guardadas.</p>
        </div>
        <footer class="sg-sheet-foot">
          <UiSwitch v-model="keep" label="Guardar en mis firmas" class="sg-keep" />
          <UiButton @click="creatorOpen = false">Cancelar</UiButton>
          <UiButton variant="primary" icon="ph:signature" :loading="creating" :disabled="!creator?.ready" @click="useNew">Usar firma</UiButton>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ─── Bandeja ─── */
.sg-dock {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 0 16px max(16px, env(safe-area-inset-bottom));
  pointer-events: none;
}

.sg-dock > * {
  pointer-events: auto;
}

.sg-hint {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  margin: 0;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 560;
  color: var(--fv-text);
  text-align: center;
  background: rgba(24, 27, 34, 0.82);
  border: 1px solid var(--fv-line);
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  pointer-events: none !important;
}

.sg-hint :deep(svg) {
  flex: none;
  font-size: 15px;
  color: #9db1ff;
}

.sg-tray {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: min(100%, 980px);
  padding: 6px;
  background: rgba(24, 27, 34, 0.86);
  border: 1px solid var(--fv-line);
  border-radius: 20px;
  box-shadow: 0 18px 50px -10px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
}

.sg-list {
  display: flex;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  overscroll-behavior-x: contain;
}

.sg-list::-webkit-scrollbar {
  display: none;
}

.sg-item {
  position: relative;
  flex: none;
}

/* Eliminar: aparece al pasar por encima (siempre visible en pantallas táctiles) */
.sg-del {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 12px;
  color: #fff;
  background: rgba(22, 25, 32, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  opacity: 0;
  transform: scale(0.8);
  transition: opacity var(--t-fast), transform var(--t-fast), background var(--t-fast);
}

.sg-item:hover .sg-del,
.sg-item:focus-within .sg-del {
  opacity: 1;
  transform: scale(1);
}

.sg-del:hover {
  background: #e5484d;
  border-color: transparent;
}

.sg-del:focus-visible {
  opacity: 1;
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

@media (hover: none) {
  .sg-del {
    opacity: 1;
    transform: scale(1);
  }
}

/* Confirmación de eliminar (los diálogos de la app quedarían detrás del visor) */
.sg-confirm {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(400px, 100%);
  padding: 24px 22px 20px;
  color: var(--text);
  text-align: center;
  background: var(--surface);
  border-radius: 22px;
  box-shadow: 0 40px 100px -20px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.06);
  color-scheme: light dark;
}

.sg-confirm-paper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 180px;
  height: 64px;
  margin-bottom: 16px;
  padding: 8px 14px;
  background: linear-gradient(180deg, #fff, #f6f6f3);
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.07);
}

.sg-confirm-paper img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.sg-confirm-t {
  font-size: 16px;
  font-weight: 680;
  overflow-wrap: anywhere;
}

.sg-confirm-s {
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--text-3);
}

.sg-confirm-acts {
  display: flex;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 20px;
}

.sg-confirm-acts > * {
  flex: 1;
}

.sg-chip {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 128px;
  padding: 5px 5px 6px;
  color: var(--fv-text-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 14px;
  cursor: grab;
  touch-action: pan-x;
  transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast), transform var(--t-fast);
}

.sg-chip:hover {
  color: var(--fv-text);
  background: var(--fv-hover);
}

.sg-chip:active {
  transform: scale(0.97);
}

.sg-chip:focus-visible,
.sg-tool:focus-visible,
.sg-bar-btn:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.sg-paper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 50px;
  padding: 6px 10px;
  background: linear-gradient(180deg, #fff, #f6f6f3);
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}

.sg-paper img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.sg-label {
  max-width: 100%;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sg-new {
  justify-content: center;
  width: 104px;
  cursor: pointer;
  border: 1px dashed rgba(255, 255, 255, 0.18);
}

.sg-new.alone {
  flex-direction: row;
  width: auto;
  height: 50px;
  padding: 0 16px;
  gap: 10px;
  color: #fff;
  background: var(--brand);
  border: 0;
}

.sg-new.alone .sg-label {
  font-size: 13.5px;
}

.sg-new.alone .sg-new-ic {
  width: 26px;
  height: 26px;
  background: rgba(255, 255, 255, 0.2);
}

.sg-new-ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  font-size: 14px;
  color: var(--fv-text);
  background: var(--fv-hover);
  border-radius: 50%;
}

.sg-sep {
  flex: none;
  width: 1px;
  height: 44px;
  margin: 0 2px;
  background: var(--fv-line);
}

.sg-tool {
  display: inline-flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 50px;
  height: 62px;
  padding: 0 8px;
  font-size: 19px;
  color: var(--fv-text);
  background: transparent;
  border: 0;
  border-radius: 12px;
  cursor: pointer;
  transition: background var(--t-fast), opacity var(--t-fast);
}

.sg-tool.icon {
  min-width: 40px;
  font-size: 17px;
}

.sg-tool:hover:not(:disabled) {
  background: var(--fv-hover);
}

.sg-tool:disabled {
  opacity: 0.3;
  cursor: default;
}

.sg-tool-t {
  font-size: 11px;
  font-weight: 600;
  color: var(--fv-text-2);
}

/* ─── Barra flotante ─── */
.sg-bar {
  position: fixed;
  z-index: calc(var(--z-popover) - 1);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  color: #f4f5f7;
  background: rgba(22, 25, 32, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 12px 32px -6px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  transform: translate(-50%, -100%);
  white-space: nowrap;
}

.sg-bar.below {
  transform: translate(-50%, 0);
}

.sg-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  font-size: 12.5px;
  font-weight: 600;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.sg-bar-btn :deep(svg) {
  font-size: 16px;
}

.sg-bar-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.sg-bar-btn.danger:hover {
  color: #ff8a80;
  background: rgba(255, 99, 88, 0.16);
}

.sg-bar-sep {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: rgba(255, 255, 255, 0.12);
}

.sg-bar-enter-active,
.sg-bar-leave-active {
  transition: opacity 140ms var(--ease-out);
}

.sg-bar-enter-from,
.sg-bar-leave-to {
  opacity: 0;
}

.sg-ghost {
  position: fixed;
  z-index: calc(var(--z-popover) - 1);
  opacity: 0.55;
  pointer-events: none;
  transform: translate(-50%, -50%) scale(0.92);
  transition: opacity 120ms, transform 160ms var(--ease-out);
  filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.35));
}

.sg-ghost.over {
  opacity: 0.95;
  transform: translate(-50%, -50%) scale(1);
}

.sg-ghost img {
  width: 100%;
  height: 100%;
}

/* ─── ¿Descartar? ─── */
.sg-ask {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 6;
  width: min(340px, calc(100% - 32px));
  padding: 16px;
  background: rgba(28, 31, 39, 0.96);
  border: 1px solid var(--fv-line);
  border-radius: 16px;
  box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.sg-ask-t {
  font-size: 14.5px;
  font-weight: 650;
}

.sg-ask-s {
  margin-top: 2px;
  font-size: 13px;
  color: var(--fv-text-2);
}

.sg-ask-acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.sg-pill {
  height: 36px;
  padding: 0 14px;
  font-size: 13.5px;
  font-weight: 620;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  transition: background var(--t-fast);
}

.sg-pill.ghost {
  color: var(--fv-text);
  background: var(--fv-hover);
}

.sg-pill.ghost:hover {
  background: var(--fv-press);
}

.sg-pill.danger {
  color: #fff;
  background: #e5484d;
}

.sg-pill.danger:hover {
  background: #d63d42;
}

.sg-pop-enter-active,
.sg-pop-leave-active {
  transition: opacity 160ms var(--ease-out), transform 160ms var(--ease-out);
}

.sg-pop-enter-from,
.sg-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

/* ─── Hoja para crear la firma (con los colores de la app, como el papel) ─── */
.sg-sheet-wrap {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(6, 8, 12, 0.55);
}

.sg-sheet {
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: 100%;
  overflow: hidden;
  color: var(--text);
  background: var(--surface);
  border-radius: 22px;
  box-shadow: 0 40px 100px -20px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.06);
  color-scheme: light dark;
}

.sg-sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 4px;
}

.sg-sheet-t {
  font-size: 17px;
  font-weight: 680;
  letter-spacing: -0.01em;
}

.sg-sheet-s {
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-3);
}

.sg-x {
  display: grid;
  flex: none;
  place-items: center;
  width: 34px;
  height: 34px;
  font-size: 15px;
  color: var(--text-2);
  background: var(--surface-2, var(--surface-hover));
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.sg-x:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.sg-sheet-body {
  flex: 1;
  min-height: 0;
  padding: 16px 22px;
  overflow-y: auto;
}

.sg-sheet-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--border-subtle);
}

.sg-keep {
  margin-right: auto;
}

.sg-warn {
  margin-top: 10px;
  font-size: var(--text-xs);
  color: var(--warning);
}

.sg-sheet-enter-active,
.sg-sheet-leave-active {
  transition: opacity 200ms var(--ease-out);
}

.sg-sheet-enter-active .sg-sheet {
  transition: transform 320ms var(--ease-spring);
}

.sg-sheet-leave-active .sg-sheet {
  transition: transform 160ms var(--ease-in);
}

.sg-sheet-enter-from,
.sg-sheet-leave-to {
  opacity: 0;
}

.sg-sheet-enter-from .sg-sheet {
  transform: translateY(18px) scale(0.98);
}

.sg-sheet-leave-to .sg-sheet {
  transform: translateY(10px);
}

.sg-hint-enter-active,
.sg-hint-leave-active {
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
}

.sg-hint-enter-from,
.sg-hint-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.only-touch {
  display: none;
}

@media (hover: none) {
  .hide-touch {
    display: none;
  }

  .only-touch {
    display: inline;
  }
}

@media (max-width: 640px) {
  .sg-dock {
    padding: 0 8px max(8px, env(safe-area-inset-bottom));
  }

  .sg-tray {
    width: 100%;
    border-radius: 18px;
  }

  .sg-chip {
    width: 104px;
  }

  .sg-new {
    width: 88px;
  }

  .sg-tool {
    min-width: 44px;
  }

  .sg-sheet-wrap {
    align-items: end;
    padding: 0;
  }

  .sg-sheet {
    width: 100%;
    max-height: 94%;
    border-radius: 22px 22px 0 0;
  }

  .sg-sheet-head,
  .sg-sheet-body {
    padding-right: 16px;
    padding-left: 16px;
  }

  .sg-sheet-foot {
    flex-wrap: wrap;
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
  }

  .sg-keep {
    flex-basis: 100%;
    margin-bottom: 4px;
  }

  .sg-sheet-foot > :not(.sg-keep) {
    flex: 1;
  }

  .sg-sheet-enter-from .sg-sheet {
    transform: translateY(100%);
  }

  .sg-sheet-leave-to .sg-sheet {
    transform: translateY(100%);
  }

  .sg-ask {
    top: 8px;
    right: 8px;
  }
}
</style>
