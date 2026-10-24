<script setup lang="ts">
/**
 * Casilla de imagen (foto de producto, logotipo de contacto…): clic, arrastrar o pegar.
 * La imagen se reduce en el navegador; quien la usa la sube al guardar con `pending` o la borra con `remove`.
 */
const props = withDefaults(defineProps<{
  /** Imagen guardada en el servidor */
  url?: string | null
  label?: string
  /** Nombre para los textos de ayuda: «imagen», «logotipo»… */
  noun?: string
  size?: number
  /** Píxeles máximos por lado al reducir */
  max?: number
  /** contain: se ve entera sobre blanco (logotipos); cover: llena la casilla (fotos) */
  fit?: 'cover' | 'contain'
  /** Recorta el margen vacío (logotipos) */
  trim?: boolean
  icon?: string
}>(), { label: 'Imagen', noun: 'imagen', size: 112, max: 800, fit: 'cover', icon: 'ph:image-square' })

const pending = defineModel<Blob | null>('pending', { default: null })
const remove = defineModel<boolean>('remove', { default: false })

const toast = useToast()
const busy = ref(false)
const over = ref(false)
const input = ref<HTMLInputElement>()
const preview = ref<string | null>(null)

watch(pending, (b) => {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = b ? URL.createObjectURL(b) : null
}, { immediate: true })
onBeforeUnmount(() => preview.value && URL.revokeObjectURL(preview.value))

const shown = computed(() => preview.value ?? (remove.value ? null : props.url ?? null))

async function take(file: File | null | undefined) {
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.error('Eso no es una imagen', 'Usa un archivo JPG, PNG, WebP o SVG.')
    return
  }
  busy.value = true
  try {
    pending.value = await resizeImage(file, props.max, { trim: props.trim })
    remove.value = false
  }
  catch (err) {
    toast.error(`No se pudo usar ${props.noun === 'imagen' ? 'la imagen' : `el ${props.noun}`}`, errorMessage(err))
  }
  finally {
    busy.value = false
  }
}

function onPick(e: Event) {
  const el = e.target as HTMLInputElement
  take(el.files?.[0])
  el.value = ''
}

function onDrop(e: DragEvent) {
  over.value = false
  take(e.dataTransfer?.files?.[0])
}

/** Para el @paste del formulario: pegar una imagen copiada la usa aquí */
function onPaste(e: ClipboardEvent) {
  const file = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'))
  if (file) {
    e.preventDefault()
    take(file)
  }
}

function drop() {
  if (pending.value) pending.value = null
  else remove.value = true
}

defineExpose({ onPaste, take })
</script>

<template>
  <div
    class="pick"
    :class="[`fit-${fit}`, { filled: !!shown, over }]"
    :style="{ '--size': `${size}px` }"
    @dragenter.prevent="over = true"
    @dragover.prevent
    @dragleave="over = false"
    @drop.prevent="onDrop"
  >
    <button type="button" class="pick-btn" :aria-label="shown ? `Cambiar ${noun}` : `Añadir ${noun}`" :title="shown ? `Cambiar ${noun}` : `Añadir ${noun}: haz clic, arrastra o pega`" :disabled="busy" @click="input?.click()">
      <img v-if="shown" :src="shown" alt="" class="pick-pic">
      <span v-else class="pick-empty">
        <span v-if="busy" class="spinner" aria-hidden="true" />
        <Icon v-else :name="icon" aria-hidden="true" />
        <span>{{ busy ? 'Procesando' : label }}</span>
      </span>
      <span v-if="shown" class="pick-edit" aria-hidden="true"><Icon name="ph:camera" /></span>
    </button>
    <button v-if="shown" type="button" class="pick-del" :aria-label="`Quitar ${noun}`" @click="drop">
      <Icon name="ph:x-bold" aria-hidden="true" />
    </button>
    <input ref="input" type="file" accept="image/*" class="sr-only" tabindex="-1" aria-hidden="true" @change="onPick">
  </div>
</template>

<style scoped>
.pick {
  position: relative;
  flex: none;
  width: var(--size);
  height: var(--size);
}

.pick-btn {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  color: var(--text-3);
  background: var(--surface-sunken);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-xl);
  cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast), color var(--t-fast);
}

.pick-btn:hover,
.pick.over .pick-btn {
  color: var(--brand);
  background: var(--brand-soft);
  border-color: var(--brand);
}

.pick-btn:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.pick.filled .pick-btn {
  position: relative;
  background: #fff;
  border: 1px solid var(--border);
}

.pick-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  font-weight: 550;
}

.pick-empty :deep(svg) {
  width: 28px;
  height: 28px;
}

.pick-pic {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fit-contain .pick-pic {
  padding: 12%;
  object-fit: contain;
}

.pick-edit {
  position: absolute;
  inset: auto 0 0;
  display: grid;
  place-items: center;
  height: 30px;
  color: #fff;
  background: linear-gradient(transparent, rgb(0 0 0 / 0.55));
  opacity: 0;
  transition: opacity var(--t-fast);
}

.pick-btn:hover .pick-edit,
.pick-btn:focus-visible .pick-edit {
  opacity: 1;
}

.pick-del {
  position: absolute;
  top: -8px;
  right: -8px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 50%;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: color var(--t-fast), border-color var(--t-fast);
}

.pick-del:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.pick-del:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

@media (hover: none) {
  .pick-edit {
    opacity: 1;
  }
}

@media (max-width: 480px) {
  .pick {
    width: calc(var(--size) * 0.8);
    height: calc(var(--size) * 0.8);
  }
}
</style>
