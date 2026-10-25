<script setup lang="ts">
import '@fontsource/great-vibes/400.css'
import '@fontsource/mr-dafoe/400.css'
import '@fontsource/homemade-apple/400.css'
import '@fontsource/caveat/500.css'
import type { DroppedFile } from '~/components/docs/Dropzone.vue'

/**
 * Crear una firma: dibujándola, escribiendo el nombre con letra manuscrita o subiendo una foto o un
 * escaneo (el papel se vuelve transparente). Siempre acaba en un PNG transparente recortado a la tinta.
 * Los botones los pone quien lo usa (modal de Ajustes o el visor), con `submit()` y `ready`.
 */
export interface CreatedSignature {
  blob: Blob
  width: number
  height: number
  kind: 'drawn' | 'typed' | 'image'
  name: string
}

const props = defineProps<{ defaultName?: string, initialTab?: 'draw' | 'type' | 'upload' }>()

const { me } = useMe()
const toast = useToast()

type Tab = 'draw' | 'type' | 'upload'
const TABS = [
  { value: 'draw', label: 'Dibujar' },
  { value: 'type', label: 'Escribir' },
  { value: 'upload', label: 'Subir imagen' },
]
const tab = ref<Tab>(props.initialTab ?? 'draw')
const tabModel = computed({ get: () => tab.value as string, set: (v: string) => (tab.value = v as Tab) })
const inkId = ref<string>(INK_COLORS[0].id)
const ink = computed(() => INK_COLORS.find(c => c.id === inkId.value)?.value ?? INK_COLORS[0].value)
const THICK = [
  { value: 0.7, label: 'Fino' },
  { value: 1, label: 'Medio' },
  { value: 1.45, label: 'Grueso' },
]
const thickness = ref(1)
const name = ref(props.defaultName ?? '')
const nameTouched = ref(false)

// Dibujar
const pad = ref<{ toCanvas: () => Promise<HTMLCanvasElement | null>, inked: boolean } | null>(null)
const strokes = ref(0)

// Escribir
const typed = ref(me.value?.user.name ?? '')
const fontId = ref<string>(SIGNATURE_FONTS[0].id)
const font = computed(() => SIGNATURE_FONTS.find(f => f.id === fontId.value) ?? SIGNATURE_FONTS[0])

// Subir
const source = shallowRef<HTMLImageElement | null>(null)
const sourceName = ref('')
const removeBackground = ref(true)
const recolor = ref(false)
const processed = shallowRef<HTMLCanvasElement | null>(null)
const preview = ref('')
const reading = ref(false)

function process() {
  if (!source.value) {
    processed.value = null
    preview.value = ''
    return
  }
  const c = signatureFromImage(source.value, { removeBackground: removeBackground.value, ink: recolor.value ? ink.value : null })
  processed.value = c
  preview.value = c.toDataURL('image/png')
}
watch([removeBackground, recolor, ink], () => {
  if (tab.value === 'upload') process()
})

async function onFiles(files: DroppedFile[]) {
  const f = files[0]?.file
  if (!f) return
  if (!/^image\/(png|jpe?g|webp|heic|heif)$/i.test(f.type) && !/\.(png|jpe?g|webp)$/i.test(f.name)) {
    toast.error('Formato no admitido', 'Sube una foto o un escaneo de tu firma en PNG, JPG o WebP.')
    return
  }
  reading.value = true
  const url = URL.createObjectURL(f)
  try {
    source.value = await loadImage(url)
    sourceName.value = f.name
    process()
  }
  catch {
    toast.error('No se pudo leer la imagen', 'Prueba con otra foto o con un PNG.')
  }
  finally {
    URL.revokeObjectURL(url)
    reading.value = false
  }
}

function pickInk(id: string) {
  inkId.value = id
  // En una imagen subida, elegir color es pedir la tinta uniforme
  if (tab.value === 'upload') recolor.value = true
}

function resetUpload() {
  source.value = null
  sourceName.value = ''
  process()
}

const ready = computed(() => {
  if (tab.value === 'draw') return strokes.value > 0
  if (tab.value === 'type') return typed.value.trim().length > 0
  return !!processed.value
})

// Nombre propuesto: el escrito, o "Firma de …" con el nombre de quien firma
const { list: existing } = useSignatures()
const suggested = computed(() => {
  const first = me.value?.user.name?.split(' ')[0]
  const base = tab.value === 'type' && typed.value.trim()
    ? typed.value.trim().slice(0, 56)
    : props.defaultName || (first ? `Firma de ${first}` : 'Mi firma')
  // Sin repetir el nombre de otra firma guardada: «Firma de Lucía 2»
  const taken = new Set((existing.value ?? []).map(s => s.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  let n = 2
  while (taken.has(`${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
})
watch(suggested, (v) => {
  if (!nameTouched.value) name.value = v
}, { immediate: true })

async function submit(): Promise<CreatedSignature | null> {
  let canvas: HTMLCanvasElement | null = null
  if (tab.value === 'draw') canvas = await pad.value?.toCanvas() ?? null
  else if (tab.value === 'type') canvas = await typedSignature(typed.value.trim(), font.value.family, ink.value, font.value.size)
  else canvas = processed.value
  if (!canvas) return null
  const blob = await canvasPng(canvas)
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    kind: tab.value === 'draw' ? 'drawn' : tab.value === 'type' ? 'typed' : 'image',
    name: (name.value.trim() || suggested.value).slice(0, 60),
  }
}

defineExpose({ submit, ready })
</script>

<template>
  <div class="creator">
    <UiSegmented v-model="tabModel" :options="TABS" label="Cómo crear la firma" class="tabs" />

    <div class="stage">
      <Transition name="cr-fade" mode="out-in">
        <SignaturePad v-if="tab === 'draw'" key="draw" ref="pad" :color="ink" :thickness="thickness" @change="strokes = $event" />

        <div v-else-if="tab === 'type'" key="type" class="type">
          <input
            v-model="typed"
            class="type-input"
            :style="{ fontFamily: `'${font.family}', cursive`, color: ink, fontSize: `${Math.round(54 * font.size)}px` }"
            maxlength="40"
            placeholder="Tu nombre"
            aria-label="Nombre para la firma"
            autocomplete="name"
            spellcheck="false"
          >
          <div class="fonts" role="radiogroup" aria-label="Estilo de letra">
            <button
              v-for="f in SIGNATURE_FONTS"
              :key="f.id"
              type="button"
              role="radio"
              class="font"
              :class="{ on: fontId === f.id }"
              :aria-checked="fontId === f.id"
              @click="fontId = f.id"
            >
              <span class="font-sample" :style="{ fontFamily: `'${f.family}', cursive`, color: ink, fontSize: `${Math.round(25 * f.size)}px` }">{{ typed.trim() || 'Tu firma' }}</span>
              <span class="font-label">{{ f.label }}</span>
            </button>
          </div>
        </div>

        <div v-else key="upload" class="upload">
          <div v-if="preview" class="up-preview">
            <div class="checker">
              <img :src="preview" alt="Vista previa de la firma" class="up-img">
            </div>
            <div class="up-bar">
              <span class="up-name truncate"><Icon name="ph:image" aria-hidden="true" /> {{ sourceName }}</span>
              <button type="button" class="link small" @click="resetUpload">Cambiar imagen</button>
            </div>
          </div>
          <DocsDropzone
            v-else
            compact
            :multiple="false"
            camera
            accept="image/png,image/jpeg,image/webp"
            :title="reading ? 'Leyendo la imagen…' : 'Arrastra una foto o un escaneo de tu firma'"
            hint="Firma en un papel blanco y hazle una foto: quitamos el fondo solos."
            :disabled="reading"
            @files="onFiles"
          />
        </div>
      </Transition>
    </div>

    <div class="tools">
      <div class="inks" role="radiogroup" aria-label="Color de la tinta">
        <button
          v-for="c in INK_COLORS"
          :key="c.id"
          type="button"
          role="radio"
          class="ink"
          :class="{ on: inkId === c.id, muted: tab === 'upload' && !recolor }"
          :style="{ '--ink': c.value }"
          :aria-checked="inkId === c.id"
          :aria-label="c.label"
          :title="c.label"
          @click="pickInk(c.id)"
        />
      </div>
      <div v-if="tab === 'draw'" class="thick" role="radiogroup" aria-label="Grosor del trazo">
        <button
          v-for="t in THICK"
          :key="t.value"
          type="button"
          role="radio"
          class="th-btn"
          :class="{ on: thickness === t.value }"
          :aria-checked="thickness === t.value"
          :aria-label="t.label"
          :title="t.label"
          @click="thickness = t.value"
        >
          <span class="th-dot" :style="{ width: `${4 + t.value * 4}px`, height: `${4 + t.value * 4}px` }" />
        </button>
      </div>
      <template v-else-if="tab === 'upload' && source">
        <UiSwitch v-model="removeBackground" label="Quitar el fondo" class="tool-switch" />
        <UiSwitch v-model="recolor" label="Tinta uniforme" class="tool-switch" />
      </template>
    </div>

    <UiInput v-model="name" label="Nombre de la firma" maxlength="60" placeholder="Ej. Firma de Lucía" hint="Para reconocerla cuando tengas varias (firma completa, rúbrica, iniciales…)" @update:model-value="nameTouched = true" />
    <slot />
  </div>
</template>

<style scoped>
.creator {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.tabs {
  align-self: flex-start;
}

.stage {
  min-height: 230px;
}

.type {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.type-input {
  width: 100%;
  height: 130px;
  padding: 0 24px;
  line-height: 1.4;
  text-align: center;
  background: #fbfbf8;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: var(--r-lg);
  outline: none;
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}

.type-input::placeholder {
  color: #c1c5ce;
}

.type-input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.fonts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.font {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
  height: 86px;
  padding: 10px 8px 8px;
  background: #fbfbf8;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
}

.font:hover {
  border-color: var(--border-strong, var(--border));
}

.font.on {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.font:active {
  transform: scale(0.98);
}

.font-sample {
  max-width: 100%;
  overflow: hidden;
  line-height: 1.6;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.font-label {
  font-size: 11.5px;
  font-weight: 600;
  color: #7b8190;
}

.up-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checker {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 196px;
  padding: 16px;
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #f1f2f5 25%, transparent 25%),
    linear-gradient(-45deg, #f1f2f5 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #f1f2f5 75%),
    linear-gradient(-45deg, transparent 75%, #f1f2f5 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: var(--r-lg);
}

.up-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.up-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.up-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
  min-height: 34px;
}

.inks,
.thick {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ink {
  width: 26px;
  height: 26px;
  padding: 0;
  background: var(--ink);
  border: 2px solid var(--surface);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--border);
  cursor: pointer;
  transition: box-shadow var(--t-fast), transform var(--t-fast), opacity var(--t-fast);
}

.ink:hover {
  transform: scale(1.08);
}

.ink.on {
  box-shadow: 0 0 0 2px var(--brand);
}

.ink.muted {
  opacity: 0.45;
  box-shadow: 0 0 0 1px var(--border);
}

.thick {
  padding-left: 18px;
  border-left: 1px solid var(--border-subtle);
}

.th-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background var(--t-fast), border-color var(--t-fast);
}

.th-btn:hover {
  background: var(--surface-hover);
}

.th-btn.on {
  background: var(--brand-soft);
  border-color: color-mix(in srgb, var(--brand) 40%, transparent);
}

.th-dot {
  background: var(--text);
  border-radius: 50%;
}

.tool-switch {
  flex: none;
}

.cr-fade-enter-active,
.cr-fade-leave-active {
  transition: opacity 140ms var(--ease-out);
}

.cr-fade-enter-from,
.cr-fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .fonts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .type-input {
    height: 110px;
  }

  .stage {
    min-height: 200px;
  }
}
</style>
