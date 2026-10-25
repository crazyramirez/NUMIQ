<script setup lang="ts">
import type { CtxSpec } from '~/composables/useContextMenu'

/** Documentos asociados a una factura o presupuesto: orden de pedido, albarán, contrato… */
interface Attachment {
  id: number
  originalName: string
  mime: string
  size: number
  createdAt: string
}

// Vue convierte un booleano ausente en false: sin el default, nadie podría añadir ni quitar
const props = withDefaults(defineProps<{ docId: number, items: Attachment[], canEdit?: boolean }>(), { canEdit: true })
const emit = defineEmits<{ changed: [] }>()
const toast = useToast()
const { confirm } = useConfirm()
const viewer = useFileViewer()
const view = (i: number) => viewer.open(props.items.map(storedFile), i)

const input = ref<HTMLInputElement>()
const uploading = ref(false)
const dragging = ref(false)

const iconFor = (mime: string) =>
  mime === 'application/pdf'
    ? { name: 'ph:file-pdf-fill', tone: 'pdf' }
    : mime.startsWith('image/')
      ? { name: 'ph:image-fill', tone: 'img' }
      : /sheet|excel|csv/.test(mime)
        ? { name: 'ph:file-xls-fill', tone: 'xls' }
        : /word|document|text/.test(mime)
          ? { name: 'ph:file-doc-fill', tone: 'doc' }
          : { name: 'ph:file-zip-fill', tone: 'zip' }

const sizeLabel = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

async function upload(files: FileList | File[] | null | undefined) {
  const list = [...(files ?? [])]
  if (!list.length) return
  const tooBig = list.find(f => f.size > 10 * 1024 * 1024)
  if (tooBig) {
    toast.error(`${tooBig.name} supera 10 MB`)
    return
  }
  uploading.value = true
  try {
    const body = new FormData()
    list.slice(0, 10).forEach(f => body.append('files', f))
    await $fetch(`/api/sales/${props.docId}/attachments`, { method: 'POST', body })
    toast.success(list.length === 1 ? 'Documento adjuntado' : `${list.length} documentos adjuntados`)
    emit('changed')
  }
  catch (err) {
    toast.error('No se pudo adjuntar', errorMessage(err))
  }
  finally {
    uploading.value = false
    if (input.value) input.value.value = ''
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false
  if (props.canEdit) upload(e.dataTransfer?.files)
}

// Clic derecho / pulsación larga en un adjunto
function attCtx(a: Attachment, i: number): CtxSpec {
  return {
    title: a.originalName,
    subtitle: `${sizeLabel(a.size)} · ${fdate(a.createdAt)}`,
    icon: iconFor(a.mime).name,
    items: [
      { label: 'Ver', icon: 'ph:eye', onClick: () => view(i) },
      ...(props.canEdit && signableMime(a.mime) ? [{ label: 'Firmar…', icon: 'ph:signature', onClick: () => viewer.open(props.items.map(storedFile), i, { sign: true }) }] : []),
      { label: 'Descargar', icon: 'ph:download-simple', onClick: () => { window.location.href = `/api/files/${a.id}?download=1` } },
      { label: 'Copiar nombre', icon: 'ph:copy', onClick: () => copyText(a.originalName, 'Nombre') },
      ...(props.canEdit
        ? [
            { label: 'Añadir más documentos…', icon: 'ph:plus', onClick: () => input.value?.click() },
            { divider: true },
            { label: 'Quitar', icon: 'ph:trash', danger: true, onClick: () => remove(a) },
          ]
        : []),
    ],
  }
}

async function remove(a: Attachment) {
  if (!(await confirm({ title: `¿Quitar ${a.originalName}?`, body: 'El archivo se borrará de NUMIQ.', confirmLabel: 'Quitar', danger: true }))) return
  try {
    await $fetch(`/api/files/${a.id}`, { method: 'DELETE' })
    emit('changed')
  }
  catch (err) {
    toast.error('No se pudo quitar', errorMessage(err))
  }
}
</script>

<template>
  <section
    class="card att"
    :class="{ dragging }"
    @dragover.prevent="dragging = canEdit"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="att-head">
      <h2 class="section-title row gap-2"><Icon name="ph:paperclip" class="h-ic" /> Documentos adjuntos</h2>
      <UiButton v-if="canEdit" size="sm" variant="ghost" icon="ph:plus" :loading="uploading" @click="input?.click()">Añadir</UiButton>
    </div>

    <ul v-if="items.length" class="list">
      <li v-for="(a, i) in items" :key="a.id" v-ctx="() => attCtx(a, i)" class="item">
        <button type="button" class="grow min0 name-link" :aria-label="`Ver ${a.originalName}`" @click="view(i)">
          <span class="ic" :class="iconFor(a.mime).tone"><Icon :name="iconFor(a.mime).name" /></span>
          <span class="min0 name-text">
            <span class="name truncate">{{ a.originalName }}</span>
            <span class="meta">{{ sizeLabel(a.size) }} · {{ fdate(a.createdAt) }}</span>
          </span>
        </button>
        <a :href="`/api/files/${a.id}?download=1`" class="act" :aria-label="`Descargar ${a.originalName}`"><Icon name="ph:download-simple" /></a>
        <button v-if="canEdit" type="button" class="act danger" :aria-label="`Quitar ${a.originalName}`" @click="remove(a)"><Icon name="ph:trash" /></button>
      </li>
    </ul>
    <button v-else-if="canEdit" type="button" class="empty" :disabled="uploading" @click="input?.click()">
      <Icon name="ph:file-arrow-up" class="e-ic" />
      <span><strong class="no-touch">Arrastra aquí</strong><strong class="touch-only">Toca para subir</strong> la orden de pedido, el albarán o el contrato</span>
      <span class="hint">PDF, imagen, Word, Excel, CSV o ZIP · máx. 10 MB</span>
    </button>
    <p v-else class="muted small">Sin documentos adjuntos.</p>

    <input ref="input" type="file" multiple class="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.odt,.ods,.csv,.txt,.zip" @change="upload(($event.target as HTMLInputElement).files)">
  </section>
</template>

<style scoped>
.att {
  padding: var(--s-5);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.att.dragging {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.att-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -4px 0 var(--s-3);
}

.h-ic {
  width: 17px;
  height: 17px;
  color: var(--text-3);
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.item + .item {
  border-top: 1px solid var(--border-subtle);
}

.ic {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  font-size: 17px;
  border-radius: var(--r-sm);
}

.ic.pdf { color: var(--danger-solid); background: var(--danger-soft); }
.ic.img { color: var(--info-solid); background: var(--info-soft); }
.ic.xls { color: var(--success-solid); background: var(--success-soft); }
.ic.doc { color: var(--brand); background: var(--brand-soft); }
.ic.zip { color: var(--warning-solid); background: var(--warning-soft); }

.min0 {
  min-width: 0;
}

.name-link {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -4px 0 -4px -4px;
  padding: 4px;
  text-align: left;
  border-radius: var(--r-md);
  transition: background var(--t-fast);
}

.name-link:hover {
  background: var(--surface-hover);
}

.name-text {
  display: flex;
  flex-direction: column;
}

.name {
  font-weight: 550;
  font-size: var(--text-sm);
}

.name-link:hover .name {
  color: var(--brand-text);
}

.meta {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.act {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--text-3);
  border-radius: var(--r-sm);
  transition: background var(--t-fast), color var(--t-fast);
}

.act:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.act.danger:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: var(--s-5) var(--s-3);
  font-size: var(--text-sm);
  text-align: center;
  color: var(--text-2);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.empty:hover {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.e-ic {
  width: 24px;
  height: 24px;
  margin-bottom: 4px;
  color: var(--brand-text);
}

.small {
  font-size: var(--text-sm);
}
</style>
