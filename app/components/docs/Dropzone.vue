<script setup lang="ts">
/**
 * Zona para soltar archivos o carpetas enteras (se recorren las subcarpetas y cada archivo conserva
 * su ruta: "2024/Recibidas/luz.pdf"). También con botones para elegir archivos o una carpeta.
 */
export interface DroppedFile {
  file: File
  path: string
}

const props = withDefaults(defineProps<{
  title?: string
  hint?: string
  accept?: string
  multiple?: boolean
  /** Botón "Elegir carpeta" */
  folders?: boolean
  /** Botón de cámara (móvil) */
  camera?: boolean
  compact?: boolean
  disabled?: boolean
}>(), { title: 'Arrastra aquí tus archivos', multiple: true })

const emit = defineEmits<{ files: [files: DroppedFile[]] }>()

const over = ref(false)
const fileInput = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
const cameraInput = ref<HTMLInputElement>()
let depth = 0

// En el móvil no se arrastra: «Arrastra la factura…» pasa a «Sube la factura…» (tras montar: sin desajuste con el SSR)
const touch = ref(false)
onMounted(() => (touch.value = matchMedia('(hover: none)').matches))
const shownTitle = computed(() => (touch.value ? props.title.replace(/^Arrastra(?: aquí)?/, 'Sube') : props.title))
// El tercer icono enseña un ZIP solo si se aceptan ZIP
const lastIcon = computed(() => (!props.accept || /zip/i.test(props.accept) ? 'ph:file-zip' : 'ph:image'))

function onEnter(e: DragEvent) {
  if (props.disabled || !e.dataTransfer?.types.includes('Files')) return
  depth++
  over.value = true
}

function onLeave() {
  depth = Math.max(depth - 1, 0)
  if (!depth) over.value = false
}

async function readEntry(entry: FileSystemEntry, prefix: string, out: DroppedFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ file, path: prefix + file.name })
    return
  }
  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries devuelve las entradas por tandas: hay que pedir hasta que llegue vacío
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`, out)
  }
}

async function onDrop(e: DragEvent) {
  depth = 0
  over.value = false
  if (props.disabled || !e.dataTransfer) return
  // Las entradas hay que pedirlas antes del primer await: después el navegador las invalida
  const entries = [...e.dataTransfer.items].map(i => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null)).filter((x): x is FileSystemEntry => !!x)
  const loose = [...e.dataTransfer.files]
  const out: DroppedFile[] = []
  if (entries.length) {
    for (const entry of entries) await readEntry(entry, '', out)
  }
  else {
    out.push(...loose.map(file => ({ file, path: file.name })))
  }
  const files = out.filter(f => !/(^|\/)(\.|__MACOSX\/|thumbs\.db$|desktop\.ini$)/i.test(f.path))
  if (files.length) emit('files', props.multiple ? files : files.slice(0, 1))
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
    .map(file => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }))
    .filter(f => !/(^|\/)\./.test(f.path))
  input.value = ''
  if (files.length) emit('files', files)
}

defineExpose({ pick: () => fileInput.value?.click(), camera: () => cameraInput.value?.click() })
</script>

<template>
  <div
    class="drop"
    :class="{ over, compact, disabled }"
    @dragenter.prevent="onEnter"
    @dragover.prevent
    @dragleave="onLeave"
    @drop.prevent="onDrop"
  >
    <div class="art" aria-hidden="true">
      <span class="doc d1"><Icon name="ph:file-pdf" /></span>
      <span class="doc d2"><Icon name="ph:receipt" /></span>
      <span class="doc d3"><Icon :name="lastIcon" /></span>
    </div>
    <p class="t">{{ over ? 'Suelta para subir' : shownTitle }}</p>
    <p v-if="hint" class="s">{{ hint }}</p>
    <div class="btns">
      <UiButton v-if="camera" class="cam" variant="primary" icon="ph:camera" :disabled="disabled" @click="cameraInput?.click()">Hacer foto</UiButton>
      <UiButton :variant="camera ? 'secondary' : 'primary'" icon="ph:upload-simple" :disabled="disabled" @click="fileInput?.click()">Elegir {{ multiple ? 'archivos' : 'archivo' }}</UiButton>
      <UiButton v-if="folders" variant="secondary" icon="ph:folder-simple-plus" :disabled="disabled" @click="folderInput?.click()">Elegir carpeta</UiButton>
    </div>
    <slot />
    <input ref="fileInput" type="file" class="sr-only" :accept="accept" :multiple="multiple" tabindex="-1" aria-hidden="true" @change="onPick">
    <input v-if="folders" ref="folderInput" type="file" class="sr-only" webkitdirectory multiple tabindex="-1" aria-hidden="true" @change="onPick">
    <input v-if="camera" ref="cameraInput" type="file" class="sr-only" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" @change="onPick">
  </div>
</template>

<style scoped>
.drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  min-height: 280px;
  padding: var(--s-7) var(--s-5);
  text-align: center;
  background:
    radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--brand) 6%, transparent) 0%, transparent 60%),
    var(--surface);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-xl);
  transition: border-color var(--t-base), background var(--t-base), transform var(--t-base) var(--ease-out), box-shadow var(--t-base);
}

.drop.compact {
  min-height: 0;
  padding: var(--s-5) var(--s-4);
}

.drop.over {
  border-color: var(--brand);
  background: color-mix(in srgb, var(--brand) 7%, var(--surface));
  box-shadow: 0 0 0 4px var(--brand-ring);
  transform: scale(1.005);
}

.drop.disabled {
  opacity: 0.6;
}

.art {
  position: relative;
  width: 132px;
  height: 78px;
  margin-bottom: var(--s-2);
}

.compact .art {
  display: none;
}

.doc {
  position: absolute;
  top: 10px;
  display: grid;
  place-items: center;
  width: 50px;
  height: 62px;
  font-size: 24px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-md);
  transition: transform var(--t-slow) var(--ease-spring);
}

.d1 { left: 4px; color: var(--danger-solid); transform: rotate(-10deg); }
.d2 { left: 41px; top: 0; z-index: 1; color: var(--brand); }
.d3 { right: 4px; color: var(--warning-solid); transform: rotate(10deg); }

.over .d1 { transform: rotate(-16deg) translate(-6px, -4px); }
.over .d2 { transform: translateY(-8px); }
.over .d3 { transform: rotate(16deg) translate(6px, -4px); }

.t {
  font-size: var(--text-lg);
  font-weight: 640;
  letter-spacing: -0.012em;
}

.s {
  max-width: 460px;
  color: var(--text-3);
  font-size: var(--text-sm);
}

.btns {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--s-2);
  margin-top: var(--s-3);
}

/* La cámara solo tiene sentido en móvil */
@media (hover: hover) and (pointer: fine) {
  .cam {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .drop,
  .doc {
    transition: none;
  }
}
</style>
