<script setup lang="ts">
import type { WorkBook } from 'xlsx'
import type * as Sheets from '~/utils/spreadsheet-preview'

const props = defineProps<{ blob: Blob, kind: 'word' | 'sheet', name: string }>()
const emit = defineEmits<{ error: [] }>()
const loading = ref(true)
const workbook = shallowRef<WorkBook | null>(null)
const sheets = shallowRef<typeof Sheets | null>(null)
const selected = ref('')
const page = ref(0)
const revision = ref(0)
let request = 0
const sheetOptions = computed(() => workbook.value?.SheetNames.map(name => ({ value: name, label: name })) ?? [])
const grid = computed(() => workbook.value && sheets.value ? sheets.value.spreadsheetPage(workbook.value, selected.value, page.value) : null)
watch(selected, () => { page.value = 0 })

// El documento no ejecuta scripts, carga recursos externos ni modifica estilos de la app.
const wordShell = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:#eef0f3}body{overflow:auto}.docx-wrapper{padding:16px!important}section.docx{margin-bottom:16px!important}a{color:inherit;pointer-events:none}</style></head><body></body></html>`

watch(() => [props.blob, props.kind] as const, async () => {
  const ticket = ++request
  revision.value++
  loading.value = true
  workbook.value = null
  page.value = 0
  if (props.kind !== 'sheet') return
  try {
    const [reader, data] = await Promise.all([import('~/utils/spreadsheet-preview'), props.blob.arrayBuffer()])
    if (ticket !== request) return
    const book = reader.readPreviewWorkbook(data, props.name)
    if (!book.SheetNames.length) throw new Error('Libro vacío')
    sheets.value = reader
    workbook.value = book
    selected.value = book.SheetNames[0]!
  }
  catch { if (ticket === request) emit('error') }
  finally { if (ticket === request) loading.value = false }
}, { immediate: true })

async function renderWord(event: Event) {
  const frame = event.target as HTMLIFrameElement
  const target = frame.contentDocument
  const ticket = request
  if (!target?.body) return
  try {
    const [{ renderAsync }, data] = await Promise.all([import('docx-preview'), props.blob.arrayBuffer()])
    if (ticket !== request) return
    const styles = target.createElement('div')
    const content = target.createElement('div')
    target.body.replaceChildren(styles, content)
    // renderAsync vacía sus contenedores: conservar el head con la política de recursos.
    await renderAsync(data, content, styles, { useBase64URL: true, renderAltChunks: false, ignoreLastRenderedPageBreak: false })
    target.querySelectorAll('a').forEach(a => a.removeAttribute('href'))
  }
  catch { if (ticket === request) emit('error') }
  finally { if (ticket === request) loading.value = false }
}
onBeforeUnmount(() => { request++ })
</script>

<template>
  <div class="office-preview">
    <div v-if="loading" class="office-loading" role="status">Preparando vista previa…</div>
    <iframe v-if="kind === 'word'" :key="revision" :srcdoc="wordShell" sandbox="allow-same-origin" :title="name" class="word-frame" @load="renderWord" />
    <template v-else-if="grid">
      <div class="sheet-toolbar">
        <UiSelect v-model="selected" :options="sheetOptions" aria-label="Hoja del libro" />
        <span class="sheet-count">{{ grid.total }} filas</span>
      </div>
      <div class="sheet-scroll" tabindex="0" :aria-label="`Contenido de ${selected}`">
        <table v-if="grid.rows.length">
          <thead><tr><th aria-label="Fila" /><th v-for="col in grid.columns" :key="col" scope="col">{{ col }}</th></tr></thead>
          <tbody><tr v-for="row in grid.rows" :key="row.number"><th scope="row">{{ row.number }}</th><td v-for="(cell, i) in row.cells" :key="i">{{ cell }}</td></tr></tbody>
        </table>
        <p v-else class="empty-sheet">Esta hoja está vacía</p>
      </div>
      <div class="sheet-footer">
        <UiButton size="sm" variant="ghost" :disabled="grid.current === 0" @click="page = grid.current - 1">Anterior</UiButton>
        <span>{{ grid.current + 1 }} / {{ grid.pages }}</span>
        <UiButton size="sm" variant="ghost" :disabled="grid.current + 1 >= grid.pages" @click="page = grid.current + 1">Siguiente</UiButton>
      </div>
      <p v-if="grid.limitedColumns" class="column-note">Vista previa de las primeras 100 columnas de la hoja.</p>
    </template>
  </div>
</template>

<style scoped>
.office-preview { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 320px; min-width: 0; background: var(--surface); }
.office-loading { position: absolute; inset: 0; display: grid; place-items: center; z-index: 2; background: var(--surface); color: var(--text-3); font-size: var(--text-sm); }
.word-frame { flex: 1; width: 100%; height: 100%; min-height: 320px; border: 0; }
.sheet-toolbar, .sheet-footer { display: flex; align-items: center; gap: 12px; padding: 8px 12px; flex-shrink: 0; }
.sheet-toolbar { border-bottom: 1px solid var(--border); }
.sheet-toolbar :deep(.field) { flex: 1; min-width: 0; }
.sheet-count, .sheet-footer, .column-note { font-size: var(--text-xs); color: var(--text-3); }
.sheet-scroll { flex: 1; min-height: 0; overflow: auto; }
table { border-collapse: separate; border-spacing: 0; font-size: 12px; color: var(--text); }
th, td { padding: 6px 10px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); min-width: 90px; max-width: 420px; white-space: pre-wrap; overflow-wrap: anywhere; vertical-align: top; }
th { background: var(--surface-2); color: var(--text-3); font-weight: 500; }
thead th { position: sticky; top: 0; z-index: 1; }
tr > th:first-child { position: sticky; left: 0; min-width: 42px; }
thead th:first-child { z-index: 2; }
.sheet-footer { justify-content: space-between; border-top: 1px solid var(--border); }
.column-note, .empty-sheet { padding: 12px; }
</style>
