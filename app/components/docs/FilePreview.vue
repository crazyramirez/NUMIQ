<script setup lang="ts">
import { filePreviewKind } from '#shared/utils/file-preview'

/**
 * Vista del original guardado o local: imágenes, PDF, Word y hojas de cálculo.
 */
const props = defineProps<{
  fileId?: number | null
  /** Archivo local (escaneo en curso) */
  file?: File | null
  name?: string | null
  mime?: string | null
}>()

const url = ref<string | null>(null)
const pdfBytes = shallowRef<ArrayBuffer | null>(null)
const failed = ref(false)
const loading = ref(false)
const officeBlob = shallowRef<Blob | null>(null)
let objectUrl: string | null = null
let request = 0

const label = computed(() => props.file?.name ?? props.name ?? 'Documento')
const kind = computed(() => filePreviewKind(label.value, props.file?.type || props.mime || ''))
const icon = computed(() => {
  const n = label.value.toLowerCase()
  if (/\.(xlsx?|ods|csv)$/.test(n)) return 'ph:file-xls'
  if (/\.(docx?|odt)$/.test(n)) return 'ph:file-doc'
  if (/\.zip$/.test(n)) return 'ph:file-zip'
  return 'ph:file'
})

function release() {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = null
}

watch(() => [props.fileId, props.file, kind.value] as const, async (_, __, onCleanup) => {
  const ticket = ++request
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  release()
  url.value = null
  pdfBytes.value = null
  officeBlob.value = null
  failed.value = false
  loading.value = false
  if (kind.value === 'other') return

  if (props.file) {
    if (kind.value === 'word' || kind.value === 'sheet') {
      officeBlob.value = props.file
      return
    }
    if (kind.value === 'pdf') {
      try {
        const bytes = await props.file.arrayBuffer()
        if (ticket === request) {
          pdfBytes.value = bytes
        }
      }
      catch {
        if (ticket === request) failed.value = true
      }
      return
    }
    objectUrl = URL.createObjectURL(props.file)
    url.value = objectUrl
    return
  }

  if (!props.fileId) return
  if (kind.value === 'image') {
    url.value = `/api/files/${props.fileId}`
    return
  }

  // La descarga autenticada se comparte entre el visor PDF y Office.
  loading.value = true
  try {
    const blob = await $fetch<Blob>(`/api/files/${props.fileId}`, { responseType: 'blob', signal: controller.signal })
    if (ticket !== request) return
    if (kind.value === 'word' || kind.value === 'sheet') {
      officeBlob.value = blob
      return
    }
    if (kind.value === 'pdf') {
      pdfBytes.value = await blob.arrayBuffer()
      return
    }
    objectUrl = URL.createObjectURL(blob)
    url.value = objectUrl
  }
  catch {
    if (ticket === request && !controller.signal.aborted) failed.value = true
  }
  finally {
    if (ticket === request) loading.value = false
  }
}, { immediate: true })

onBeforeUnmount(() => { request++; release() })
</script>

<template>
  <div class="preview" :class="kind">
    <div v-if="loading" class="skeleton fill" />
    <img v-else-if="kind === 'image' && url && !failed" :src="url" :alt="label" class="img" @error="failed = true">
    <DocsPdfPreview
      v-else-if="kind === 'pdf' && (pdfBytes || url) && !failed"
      :data="pdfBytes"
      :url="url"
      :label="label"
      @error="failed = true"
    />
    <LazyDocsOfficePreview v-else-if="(kind === 'word' || kind === 'sheet') && officeBlob && !failed" :blob="officeBlob" :kind="kind" :name="label" @error="failed = true" />
    <div v-else-if="kind === 'other' || failed" class="other">
      <span class="o-ic" aria-hidden="true"><Icon :name="failed ? 'ph:warning-circle' : icon" /></span>
      <p class="o-name">{{ label }}</p>
      <p class="o-sub">{{ failed ? 'No se pudo mostrar la vista previa' : 'Sin vista previa para este formato' }}</p>
      <a v-if="fileId" :href="`/api/files/${fileId}?download=1`" class="dl"><Icon name="ph:download-simple" aria-hidden="true" /> Descargar</a>
    </div>
  </div>
</template>

<style scoped>
.preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  height: 100%;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-xl);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.fill {
  position: absolute;
  inset: 0;
  border-radius: 0;
}

.img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: var(--shadow-sm);
  border-radius: var(--r-sm);
}

.other {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: var(--s-6);
  text-align: center;
}

.o-ic {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--s-2);
  font-size: 28px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-lg);
}

.o-name {
  max-width: 280px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.o-sub {
  margin-bottom: var(--s-2);
  color: var(--text-3);
  font-size: var(--text-sm);
}

.dl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 560;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-xs);
  transition: background var(--t-fast);
}

.dl:hover {
  background: var(--surface-hover);
}
</style>
