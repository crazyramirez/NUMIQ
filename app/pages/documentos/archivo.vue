<script setup lang="ts">
import type { DroppedFile } from '~/components/docs/Dropzone.vue'
import type { CtxSpec } from '~/composables/useContextMenu'

useHead({ title: 'Archivo trimestral · NUMIQ' })

interface VaultFile {
  id: number
  name: string
  mime: string
  size: number
  folder: string | null
  year: number
  quarter: number
  notes: string | null
  createdAt: string
  /** Lo subió quien lo ve */
  mine: boolean
}

interface VaultData {
  files: VaultFile[]
  folders: Record<string, { count: number, bytes: number }>
  quarters: Record<string, { count: number, bytes: number }>
}

const toast = useToast()
const { confirm } = useConfirm()
// Gestor: consulta y descarga; sube solo a las carpetas que la empresa le permite (Ajustes → Equipo) y
// mueve, renombra o borra solo lo que subió él
const { readOnly, canUploadTo } = useMe()

const now = new Date()
// Periodo, carpeta y página en la URL: enlaces directos y, al volver atrás, el archivo sigue igual
const year = useQueryState('anio', now.getFullYear(), { parse: r => Number(r) || undefined })
const quarter = useQueryState('t', String(quarterOf(now)), { allowed: ['all', '1', '2', '3', '4'] })
const folder = useQueryState('carpeta', 'all')

const { data, refresh, pending } = await useFetch<VaultData>('/api/vault', {
  query: computed(() => ({ year: year.value, quarter: quarter.value === 'all' ? undefined : quarter.value })),
  default: () => ({ files: [], folders: {}, quarters: {} }),
  watch: [year, quarter],
})

const quarterOptions = computed(() => [
  { value: 'all', label: 'Todo el año', count: Object.values(data.value.quarters).reduce((s, q) => s + q.count, 0) || null },
  ...[1, 2, 3, 4].map(q => ({ value: String(q), label: `${q}T`, count: data.value.quarters[q]?.count ?? null })),
])

const folders = computed(() => {
  const known = VAULT_FOLDERS.map(f => ({ ...f, ...(data.value.folders[f.key] ?? { count: 0, bytes: 0 }) }))
  const custom = Object.entries(data.value.folders)
    .filter(([k]) => !VAULT_FOLDERS.some(f => f.key === k))
    .map(([k, v]) => ({ ...vaultFolder(k), ...v }))
  return [...known, ...custom]
})

const files = computed(() => (folder.value === 'all' ? data.value.files : data.value.files.filter(f => (f.folder ?? 'otros') === folder.value)))
const totalBytes = computed(() => files.value.reduce((s, f) => s + f.size, 0))
const { page, pages, items: shown, size: pageSize, total: pageTotal } = usePaged(files, [year, quarter, folder], 'pagina')
const periodLabel = computed(() => (quarter.value === 'all' ? `${year.value}` : `${quarter.value}.º trimestre de ${year.value}`))

// ─── Subida ───

const uploadOptions = computed(() => folders.value.filter(f => canUploadTo(f.key)).map(f => ({ value: f.key, label: f.label })))
const uploadFolder = ref(canUploadTo('banco') ? 'banco' : uploadOptions.value[0]?.value ?? 'banco')
watch(folder, (f) => {
  if (f !== 'all' && canUploadTo(f)) uploadFolder.value = f
}, { immediate: true })
const editable = (f: VaultFile) => !readOnly.value || (f.mine && canUploadTo(f.folder ?? 'otros'))
const uploadQuarter = computed(() => (quarter.value === 'all' ? quarterOf(now.getFullYear() === year.value ? now : new Date(year.value, 11, 1)) : Number(quarter.value)))
const uploading = ref(false)
const pct = ref(0)

async function upload(list: DroppedFile[]) {
  uploading.value = true
  pct.value = 0
  try {
    let saved = 0
    const skipped: string[] = []
    for (const chunk of chunkFiles(list, 20, 40 * 1024 * 1024)) {
      const form = new FormData()
      for (const f of chunk) form.append('files', f.file, f.file.name)
      form.append('folder', uploadFolder.value)
      form.append('year', String(year.value))
      form.append('quarter', String(uploadQuarter.value))
      const r = await uploadForm<{ ids: number[], skipped: Array<{ name: string, reason: string }> }>('/api/vault', form, (l, t) => (pct.value = Math.round(l / t * 100)))
      saved += r.ids.length
      skipped.push(...r.skipped.map(s => `${s.name}: ${s.reason}`))
    }
    if (saved) toast.success(`${saved} documento${saved > 1 ? 's' : ''} guardado${saved > 1 ? 's' : ''}`, `${vaultFolder(uploadFolder.value).label} · ${uploadQuarter.value}T ${year.value}`)
    if (skipped.length) toast.error('Algunos archivos no se guardaron', skipped.slice(0, 3).join(' · '))
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo subir', errorMessage(err))
  }
  finally {
    uploading.value = false
  }
}

// ─── Acciones ───

// Visor de la app: recorre los documentos de la carpeta y el periodo que se están viendo
const viewer = useFileViewer()
function show(f: VaultFile, sign = false) {
  const list = files.value
  viewer.open(list.map(storedFile), Math.max(0, list.findIndex(x => x.id === f.id)), { sign })
}

const editing = ref<VaultFile | null>(null)
const editOpen = ref(false)
const edit = ref({ name: '', folder: 'otros', year: 2026, quarter: 1, notes: '' })
const savingEdit = ref(false)
function openEdit(f: VaultFile) {
  editing.value = f
  edit.value = { name: f.name.replace(/\.[a-z0-9]{1,6}$/i, ''), folder: f.folder ?? 'otros', year: f.year, quarter: f.quarter, notes: f.notes ?? '' }
  editOpen.value = true
}
async function saveEdit() {
  if (!editing.value) return
  savingEdit.value = true
  try {
    await $fetch(`/api/vault/${editing.value.id}`, { method: 'PATCH', body: { ...edit.value, year: Number(edit.value.year), notes: edit.value.notes || null } })
    toast.success('Documento actualizado')
    editOpen.value = false
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    savingEdit.value = false
  }
}

async function remove(f: VaultFile) {
  const ok = await confirm({ title: '¿Eliminar este documento?', body: `${f.name} se borrará del archivo. No se puede deshacer.`, confirmLabel: 'Eliminar', danger: true })
  if (!ok) return
  try {
    await $fetch(`/api/vault/${f.id}`, { method: 'DELETE' })
    toast.success('Documento eliminado')
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
}

// Clic derecho / pulsación larga: además de lo del menú «⋮», mover de carpeta o de trimestre sin abrir el formulario
async function moveTo(f: VaultFile, body: { folder?: string, quarter?: number }, ok: string) {
  try {
    await $fetch(`/api/vault/${f.id}`, { method: 'PATCH', body })
    toast.success(ok, f.name)
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo mover', errorMessage(err))
  }
}

function ctxFor(f: VaultFile): CtxSpec {
  const current = f.folder ?? 'otros'
  const head = {
    title: f.name,
    subtitle: `${vaultFolder(f.folder).label} · ${f.quarter}T ${f.year} · ${fileSize(f.size)}`,
    icon: fileIcon(f.name, f.mime),
  }
  if (!editable(f)) {
    return {
      ...head,
      items: [
        { label: 'Ver', icon: 'ph:eye', keys: ['↵'], onClick: () => show(f) },
        { label: 'Descargar', icon: 'ph:download-simple', onClick: () => { window.location.href = `/api/files/${f.id}?download=1` } },
        { divider: true },
        { label: 'Copiar nombre', icon: 'ph:copy', onClick: () => copyText(f.name, 'Nombre') },
      ],
    }
  }
  return {
    ...head,
    items: [
      { label: 'Ver', icon: 'ph:eye', keys: ['↵'], onClick: () => show(f) },
      ...(signableMime(f.mime) && !readOnly.value ? [{ label: 'Firmar…', icon: 'ph:signature', onClick: () => show(f, true) }] : []),
      { label: 'Descargar', icon: 'ph:download-simple', onClick: () => { window.location.href = `/api/files/${f.id}?download=1` } },
      { divider: true },
      {
        label: 'Mover a',
        icon: 'ph:folder-simple',
        children: folders.value.filter(fd => canUploadTo(fd.key)).map(fd => ({ label: fd.label, icon: fd.icon, active: fd.key === current, onClick: () => fd.key !== current && moveTo(f, { folder: fd.key }, `Movido a ${fd.label}`) })),
      },
      {
        label: 'Trimestre',
        icon: 'ph:calendar-blank',
        children: [1, 2, 3, 4].map(q => ({ label: `${q}.º trimestre de ${f.year}`, active: q === f.quarter, onClick: () => q !== f.quarter && moveTo(f, { quarter: q }, `Movido al ${q}T ${f.year}`) })),
      },
      { label: 'Renombrar o añadir nota…', icon: 'ph:pencil-simple', onClick: () => openEdit(f) },
      { label: 'Copiar nombre', icon: 'ph:copy', onClick: () => copyText(f.name, 'Nombre') },
      { divider: true },
      { label: 'Eliminar', icon: 'ph:trash', danger: true, onClick: () => remove(f) },
    ],
  }
}

const quarterSelect = [1, 2, 3, 4].map(q => ({ value: q, label: `${q}.º trimestre` }))
const quarterModel = computed({ get: () => quarter.value, set: (v: string) => { quarter.value = v } })
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Archivo</h1>
        <p class="sub">Extractos, contratos, nóminas y justificantes de cada trimestre, listos para tu gestoría.</p>
      </div>
      <div class="page-actions">
        <UiButton variant="secondary" :icon="readOnly ? 'ph:file-zip' : 'ph:paper-plane-tilt'" :to="`/documentos/gestor?anio=${year}${quarter !== 'all' ? `&t=${quarter}` : ''}`">{{ readOnly ? 'Descargar el trimestre' : 'Enviar al gestor' }}</UiButton>
      </div>
    </header>


    <div class="toolbar">
      <div class="year" role="group" aria-label="Año">
        <UiButton variant="ghost" size="sm" square icon="ph:caret-left" aria-label="Año anterior" @click="year--" />
        <span class="num y">{{ year }}</span>
        <UiButton variant="ghost" size="sm" square icon="ph:caret-right" aria-label="Año siguiente" :disabled="year >= now.getFullYear() + 1" @click="year++" />
      </div>
      <UiSegmented v-model="quarterModel" :options="quarterOptions" label="Trimestre" />
      <span v-if="pending" class="spinner-sm" aria-hidden="true" />
    </div>

    <div class="folders">
      <button type="button" class="folder" :class="{ on: folder === 'all' }" @click="folder = 'all'">
        <span class="fd-ic all" aria-hidden="true"><Icon name="ph:stack" /></span>
        <span class="fd-name">Todo</span>
        <span class="fd-meta num">{{ data.files.length }} · {{ fileSize(data.files.reduce((s, f) => s + f.size, 0)) }}</span>
      </button>
      <button v-for="f in folders" :key="f.key" type="button" class="folder" :class="{ on: folder === f.key, empty: !f.count }" @click="folder = f.key">
        <span class="fd-ic" aria-hidden="true"><Icon :name="f.icon" /></span>
        <span class="fd-name">{{ f.label }}</span>
        <span class="fd-meta num">{{ f.count ? `${f.count} · ${fileSize(f.bytes)}` : f.hint }}</span>
      </button>
    </div>

    <DocsDropzone
      v-if="uploadOptions.length"
      compact
      :title="uploading ? `Subiendo… ${pct} %` : `Arrastra documentos para ${vaultFolder(uploadFolder).label} · ${uploadQuarter}T ${year}`"
      hint="PDF, imágenes, Word, Excel, CSV, XML o ZIP · hasta 25 MB cada uno"
      :disabled="uploading"
      @files="upload"
    >
      <div class="dest">
        <span class="label">Guardar en</span>
        <UiSelect v-model="uploadFolder" :options="uploadOptions" aria-label="Carpeta de destino" />
      </div>
    </DocsDropzone>

    <section class="card list">
      <header class="l-head">
        <p class="section-title">{{ folder === 'all' ? 'Todos los documentos' : vaultFolder(folder).label }} · {{ periodLabel }}</p>
        <span class="muted small num">{{ files.length }} documento{{ files.length === 1 ? '' : 's' }} · {{ fileSize(totalBytes) }}</span>
      </header>
      <UiEmpty v-if="!files.length" compact icon="ph:archive" title="No hay documentos aquí" :text="!uploadOptions.length ? 'Nada guardado en esta carpeta y periodo.' : 'Sube extractos del banco, contratos o justificantes: tu gestoría los tendrá ordenados por trimestre.'" />
      <ul v-else class="files">
        <li v-for="f in shown" :key="f.id" v-ctx="() => ctxFor(f)" class="file">
          <button type="button" class="f-main" @click="show(f)">
            <span class="f-ic" aria-hidden="true"><Icon :name="fileIcon(f.name, f.mime)" /></span>
            <span class="min0">
              <span class="f-name truncate">{{ f.name }}</span>
              <span class="f-sub truncate">{{ f.notes || `Subido el ${fdate(f.createdAt)}` }}</span>
            </span>
          </button>
          <UiBadge size="sm" tone="neutral" :icon="vaultFolder(f.folder).icon" class="f-folder">{{ vaultFolder(f.folder).label }}</UiBadge>
          <span class="f-q num">{{ f.quarter }}T {{ f.year }}</span>
          <span class="f-size num">{{ fileSize(f.size) }}</span>
          <UiRowMenuButton :menu="() => ctxFor(f)" :label="`Acciones de ${f.name}`" />
        </li>
      </ul>
      <UiPager v-model="page" v-model:size="pageSize" :pages="pages" :total="pageTotal" />
    </section>

    <UiModal v-if="uploadOptions.length" v-model="editOpen" size="sm" title="Mover o renombrar">
      <form id="vault-edit" class="form-grid" @submit.prevent="saveEdit">
        <UiInput v-model="edit.name" class="c-12" label="Nombre" required />
        <UiSelect v-model="edit.folder" class="c-12" label="Carpeta" :options="uploadOptions" />
        <UiInput v-model="edit.year" class="c-6" label="Año" type="number" />
        <UiSelect v-model="edit.quarter" class="c-6" label="Trimestre" :options="quarterSelect" />
        <UiInput v-model="edit.notes" class="c-12" label="Nota" placeholder="Ej. Extracto de septiembre" />
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="editOpen = false">Cancelar</UiButton>
        <UiButton variant="primary" type="submit" form="vault-edit" :loading="savingEdit">Guardar</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-3);
  margin-bottom: var(--s-4);
}

.year {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}

.y {
  min-width: 52px;
  text-align: center;
  font-weight: 650;
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.folders {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--s-3);
  margin-bottom: var(--s-4);
}

.folder {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xs);
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast) var(--ease-out);
}

.folder:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.folder.on {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-ring);
}

.fd-ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-bottom: 6px;
  font-size: 18px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-md);
}

.fd-ic.all {
  color: var(--text-2);
  background: var(--surface-sunken);
}

.folder.empty .fd-ic {
  color: var(--text-3);
  background: var(--surface-sunken);
}

.fd-name {
  font-weight: 600;
}

.fd-meta {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  font-size: var(--text-xs);
  line-height: 1.35;
  color: var(--text-3);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.dest {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-top: var(--s-3);
}

.list {
  margin-top: var(--s-4);
}

.l-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--s-2);
  padding: var(--s-4) var(--s-5);
  border-bottom: 1px solid var(--border-subtle);
}

.small {
  font-size: var(--text-sm);
}

.files {
  list-style: none;
  padding: 0;
}

.file {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 72px 72px 32px;
  align-items: center;
  gap: var(--s-4);
  padding: 10px var(--s-4) 10px var(--s-5);
}

.file + .file {
  border-top: 1px solid var(--border-subtle);
}

.f-main {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-width: 0;
  text-align: left;
}

.f-main:hover .f-name {
  color: var(--brand-text);
}

.f-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  font-size: 19px;
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-md);
}

.min0 {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.f-name {
  font-weight: 560;
  transition: color var(--t-fast);
}

.f-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.f-q,
.f-size {
  font-size: var(--text-sm);
  color: var(--text-3);
  text-align: right;
}

.form-grid .c-12 {
  grid-column: span 12;
}

@media (max-width: 720px) {
  .file {
    grid-template-columns: minmax(0, 1fr) auto 32px;
    padding: 10px var(--s-3);
  }

  .f-folder,
  .f-q {
    display: none;
  }
}
</style>
