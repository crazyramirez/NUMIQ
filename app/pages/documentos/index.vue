<script setup lang="ts">
import type { DroppedFile } from '~/components/docs/Dropzone.vue'
import type { Tone } from '~/utils/labels'

useHead({ title: 'Importar · NUMIQ' })

interface Batch {
  id: number
  source: 'upload' | 'scan' | 'email'
  name: string | null
  direction: string
  status: 'uploading' | 'processing' | 'review' | 'done' | 'failed'
  totalFiles: number
  processedFiles: number
  summary: { invoices?: number, expenses?: number, contactsCreated?: number, itemsCreated?: number, vault?: number, duplicates?: number } | null
  createdAt: string
  running: boolean
}

const toast = useToast()
const router = useRouter()
const { open: openScan } = useScan()

const { data: ai } = await useFetch<{ configured: boolean }>('/api/ai/status', { default: () => ({ configured: true }) })
const { data: batches, refresh, pending } = await useFetch<Batch[]>('/api/imports', { default: () => [] })
const { page, pages, items: shownBatches } = usePaged(batches)

// Lotes leyéndose: se refrescan solos
const anyRunning = computed(() => batches.value.some(b => b.running || b.status === 'processing'))
const { pause, resume } = useIntervalFn(() => refresh(), 2500, { immediate: false })
watch(anyRunning, v => (v ? resume() : pause()), { immediate: true })

// ─── Opciones ───

const direction = ref<'auto' | 'issued' | 'received'>('auto')
const createItems = ref(true)
const markPaid = ref(true)
const dirOptions = [
  { value: 'auto', label: 'Detectar solo' },
  { value: 'issued', label: 'Emitidas' },
  { value: 'received', label: 'Recibidas' },
]
const dirModel = computed({ get: () => direction.value as string, set: (v: string) => { direction.value = v as typeof direction.value } })

// ─── Subida ───

const uploading = ref(false)
const progress = ref({ files: 0, total: 0, loaded: 0, bytes: 0 })
const percent = computed(() => (progress.value.bytes ? Math.min(100, Math.round(progress.value.loaded / progress.value.bytes * 100)) : 0))

function batchName(files: DroppedFile[]) {
  const roots = new Set(files.map(f => f.path.split('/')[0]))
  if (roots.size === 1) {
    const root = [...roots][0]!
    return files.length === 1 ? files[0]!.file.name : root
  }
  return `${files.length} archivos`
}

async function start(files: DroppedFile[]) {
  if (uploading.value) return
  uploading.value = true
  progress.value = { files: 0, total: files.length, loaded: 0, bytes: files.reduce((s, f) => s + f.file.size, 0) }
  try {
    const { id } = await $fetch<{ id: number }>('/api/imports', { method: 'POST', body: { name: batchName(files), direction: direction.value, options: { createItems: createItems.value, markPaid: markPaid.value } } })
    let skipped: Array<{ name: string, reason: string }> = []
    let done = 0
    for (const chunk of chunkFiles(files)) {
      const form = new FormData()
      for (const f of chunk) form.append('files', f.file, f.file.name)
      form.append('paths', JSON.stringify(chunk.map(f => f.path)))
      form.append('lastModified', JSON.stringify(chunk.map(f => f.file.lastModified)))
      const base = done
      const r = await uploadForm<{ added: number, skipped: typeof skipped }>(`/api/imports/${id}/files`, form, (loaded) => {
        progress.value.loaded = base + Math.min(loaded, chunk.reduce((s, f) => s + f.file.size, 0))
      })
      done += chunk.reduce((s, f) => s + f.file.size, 0)
      progress.value.loaded = done
      progress.value.files += chunk.length
      skipped = [...skipped, ...r.skipped]
    }
    if (skipped.length) toast.info(`${skipped.length} archivo${skipped.length > 1 ? 's' : ''} sin importar`, skipped.slice(0, 3).map(s => `${s.name}: ${s.reason}`).join(' · '))
    await $fetch(`/api/imports/${id}/start`, { method: 'POST' })
    await router.push(`/documentos/importacion/${id}`)
  }
  catch (err) {
    toast.error('No se pudo importar', errorMessage(err))
  }
  finally {
    uploading.value = false
  }
}

const STATUS: Record<Batch['status'], { label: string, tone: Tone }> = {
  uploading: { label: 'Subiendo', tone: 'neutral' },
  processing: { label: 'Leyendo con IA', tone: 'ai' },
  review: { label: 'Para revisar', tone: 'warning' },
  done: { label: 'Terminada', tone: 'success' },
  failed: { label: 'Con errores', tone: 'danger' },
}

function summaryText(b: Batch) {
  const s = b.summary ?? {}
  const parts = [
    s.invoices && `${s.invoices} emitida${s.invoices > 1 ? 's' : ''}`,
    s.expenses && `${s.expenses} gasto${s.expenses > 1 ? 's' : ''}`,
    s.contactsCreated && `${s.contactsCreated} contacto${s.contactsCreated > 1 ? 's' : ''} nuevo${s.contactsCreated > 1 ? 's' : ''}`,
    s.vault && `${s.vault} al archivo`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : `${b.totalFiles} archivo${b.totalFiles === 1 ? '' : 's'}`
}

const busy = (b: Batch) => b.running || b.status === 'processing'

// ─── Eliminar una importación con lo que creó ───

const undoOpen = ref(false)
const undoBatch = ref<Batch | null>(null)
function askUndo(b: Batch) {
  undoBatch.value = b
  undoOpen.value = true
}

const SOURCE_ICON: Record<Batch['source'], string> = { upload: 'ph:upload-simple', scan: 'ph:scan', email: 'ph:envelope-simple' }
const TYPES = ['PDF', 'Fotos', 'Word', 'Excel', 'CSV', 'ZIP', 'Carpetas']
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Importar</h1>
        <p class="sub">Trae años de facturas de otro programa, de carpetas o de un ZIP: la IA las lee y tú confirmas.</p>
      </div>
      <div class="page-actions">
        <UiButton variant="ai" icon="ph:scan" @click="openScan()">Escanear factura o ticket</UiButton>
      </div>
    </header>


    <div class="grid">
      <section class="card main rise" style="--i: 1" aria-label="Importación por lotes">
        <div class="drop-wrap">
          <DocsDropzone
            title="Arrastra facturas, carpetas o un ZIP"
            hint="Emitidas y recibidas de cualquier año: la IA lee cada documento, asigna o crea clientes, proveedores y productos, y detecta duplicados."
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.odt,.xls,.xlsx,.ods,.csv,.tsv,.txt,.xml,.zip"
            folders
            :disabled="uploading || !ai.configured"
            @files="start"
          >
            <div class="types" aria-label="Formatos admitidos">
              <span v-for="t in TYPES" :key="t" class="type">{{ t }}</span>
            </div>
          </DocsDropzone>

          <Transition name="fade">
            <div v-if="uploading" class="uploading" role="status" aria-live="polite">
              <Icon name="ph:cloud-arrow-up" class="up-ic" aria-hidden="true" />
              <p class="up-t">Subiendo {{ progress.files }} de {{ progress.total }} archivos</p>
              <div class="bar"><span :style="{ width: `${percent}%` }" /></div>
              <p class="up-s num">{{ percent }} % · {{ fileSize(progress.loaded) }} de {{ fileSize(progress.bytes) }}</p>
            </div>
          </Transition>
        </div>

        <p v-if="!ai.configured" class="no-ai">
          <Icon name="ph:warning-fill" aria-hidden="true" />
          La IA no está configurada: añade <code>NUXT_OPENAI_API_KEY</code> en el archivo .env del servidor.
        </p>

        <div class="opts">
          <div class="opt-dir">
            <p class="label">¿Qué estás importando?</p>
            <UiSegmented v-model="dirModel" :options="dirOptions" label="Tipo de facturas" />
            <p class="hint">Con "Detectar solo", tu NIF y las carpetas deciden si cada factura es emitida o recibida.</p>
          </div>
          <div class="opt-sw">
            <UiSwitch v-model="createItems" label="Crear productos y servicios" hint="Los conceptos de tus facturas emitidas pasan al catálogo" />
            <UiSwitch v-model="markPaid" label="Dar por cobradas las vencidas" hint="Las facturas antiguas sin estado se marcan cobradas o pagadas" />
          </div>
        </div>
      </section>

      <aside class="aside">
        <UiCard ai class="rise scan-card" style="--i: 2">
          <div class="scan-art" aria-hidden="true"><Icon name="ph:scan" /></div>
          <h2 class="scan-t">Escaneo rápido</h2>
          <p class="scan-s">Haz una foto al ticket o sube el PDF: en segundos tienes el gasto o la factura listos para guardar.</p>
          <UiButton variant="ai" icon="ph:camera" block @click="openScan()">Escanear ahora</UiButton>
          <p class="scan-tip no-touch"><Icon name="ph:keyboard" aria-hidden="true" /> También puedes pegar una captura con Ctrl+V</p>
        </UiCard>

        <UiCard title="Así funciona" icon="ph:lightbulb-filament" class="rise" style="--i: 3">
          <ol class="steps">
            <li><span class="n">1</span><span><b>Sube</b> archivos sueltos, una carpeta con subcarpetas o un ZIP. Las carpetas ("2023", "Recibidas", "1T") ayudan a clasificar.</span></li>
            <li><span class="n">2</span><span><b>La IA lee</b> cada factura y comprueba que base, IVA y retención cuadren al céntimo.</span></li>
            <li><span class="n">3</span><span><b>Revisa</b> lo que tenga avisos y pulsa importar. Nada se crea sin tu confirmación.</span></li>
          </ol>
        </UiCard>
      </aside>
    </div>

    <section class="recent rise" style="--i: 4">
      <div class="row between rec-head">
        <h2 class="section-title">Importaciones recientes</h2>
        <UiButton v-if="batches.length" variant="ghost" size="sm" icon="ph:arrows-clockwise" :loading="pending" @click="refresh()">Actualizar</UiButton>
      </div>
      <div class="card">
        <UiEmpty v-if="!batches.length" compact icon="ph:tray" title="Aún no has importado nada" text="Tus importaciones aparecerán aquí para revisarlas cuando quieras." />
        <ul v-else class="batches">
          <li v-for="b in shownBatches" :key="b.id" class="batch">
            <span class="b-ic" :class="b.source" aria-hidden="true"><Icon :name="SOURCE_ICON[b.source]" /></span>
            <div class="grow min0">
              <!-- El enlace cubre toda la fila; el botón de eliminar queda por encima -->
              <NuxtLink :to="`/documentos/importacion/${b.id}`" class="b-name truncate">{{ b.name || `Importación ${b.id}` }}</NuxtLink>
              <p class="b-sub truncate">{{ fdate(b.createdAt) }} · {{ summaryText(b) }}</p>
            </div>
            <div v-if="busy(b)" class="b-prog">
              <div class="bar sm"><span :style="{ width: `${b.totalFiles ? Math.round(b.processedFiles / b.totalFiles * 100) : 0}%` }" /></div>
              <span class="num small">{{ b.processedFiles }}/{{ b.totalFiles }}</span>
            </div>
            <UiBadge :tone="STATUS[b.status].tone" size="sm" :dot="b.status === 'processing'">{{ STATUS[b.status].label }}</UiBadge>
            <UiButton
              class="b-del"
              variant="ghost"
              size="sm"
              square
              icon="ph:trash"
              :disabled="busy(b)"
              :title="busy(b) ? 'Espera a que termine la lectura' : 'Eliminar con todo lo que creó'"
              :aria-label="`Eliminar ${b.name || `importación ${b.id}`} con todo lo que creó`"
              @click="askUndo(b)"
            />
            <Icon name="ph:caret-right" class="chev" aria-hidden="true" />
          </li>
        </ul>
        <UiPager v-model="page" :pages="pages" />
      </div>
    </section>

    <ImportUndoModal v-model="undoOpen" :batch-id="undoBatch?.id ?? null" :name="undoBatch?.name" @done="refresh()" />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--s-5);
  align-items: start;
}

.main {
  padding: var(--s-4);
}

.drop-wrap {
  position: relative;
}

.types {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: var(--s-4);
}

.type {
  padding: 2px 9px;
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-3);
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.uploading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: var(--s-6);
  text-align: center;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  backdrop-filter: blur(4px);
  border-radius: var(--r-xl);
}

.up-ic {
  font-size: 36px;
  color: var(--brand);
  animation: float 1.6s var(--ease-out) infinite alternate;
}

@keyframes float {
  to {
    transform: translateY(-6px);
  }
}

.up-t {
  font-weight: 620;
  font-size: var(--text-md);
}

.up-s {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.bar {
  width: min(360px, 100%);
  height: 8px;
  overflow: hidden;
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.bar span {
  display: block;
  height: 100%;
  background: var(--ai-grad);
  border-radius: inherit;
  transition: width var(--t-slow) var(--ease-out);
}

.bar.sm {
  width: 90px;
  height: 5px;
}

.no-ai {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--s-3);
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: var(--r-lg);
}

.opts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--s-6);
  padding: var(--s-5) var(--s-3) var(--s-2);
}

.opt-dir {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--s-2);
}

.opt-sw {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.aside {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.scan-card :deep(.body) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--s-2);
}

.scan-art {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: var(--s-1);
  font-size: 22px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-lg);
  box-shadow: 0 6px 16px -6px rgb(79 70 229 / 0.55);
}

.scan-t {
  font-size: var(--text-lg);
  font-weight: 650;
}

.scan-s {
  margin-bottom: var(--s-2);
  color: var(--text-2);
  font-size: var(--text-sm);
}

.scan-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.steps li {
  display: flex;
  gap: var(--s-3);
}

.n {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  font-size: var(--text-xs);
  font-weight: 650;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.recent {
  margin-top: var(--s-7);
}

.rec-head {
  margin-bottom: var(--s-3);
}

.batches {
  list-style: none;
  padding: 0;
}

.batches li + li {
  border-top: 1px solid var(--border-subtle);
}

.batch {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 14px 12px 14px 18px;
  transition: background var(--t-fast);
}

.batch:hover {
  background: var(--surface-hover);
}

.batch:first-child {
  border-radius: var(--r-xl) var(--r-xl) 0 0;
}

.batch:last-child {
  border-radius: 0 0 var(--r-xl) var(--r-xl);
}

.batch:only-child {
  border-radius: var(--r-xl);
}

/* Toda la fila abre la importación */
.b-name {
  display: block;
  outline: none;
}

.b-name::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.batch:has(.b-name:focus-visible) {
  box-shadow: inset 0 0 0 2px var(--brand);
}

.b-del {
  position: relative;
  z-index: 1;
  color: var(--text-4);
}

.b-del:not(:disabled):hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.b-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  font-size: 18px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-md);
}

.b-ic.scan {
  color: var(--ai-1);
  background: var(--ai-soft);
}

.b-ic.email {
  color: var(--info);
  background: var(--info-soft);
}

.min0 {
  min-width: 0;
}

.b-name {
  font-weight: 580;
}

.b-sub {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.b-prog {
  display: flex;
  align-items: center;
  gap: 8px;
}

.small {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.chev {
  color: var(--text-4);
}

/* Por el ancho real del contenido (la barra lateral resta 248 px): el panel de opciones baja antes de apretarse */
.page {
  container: docs / inline-size;
}

@container docs (max-width: 1060px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .aside {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}

@media (max-width: 720px) {
  .opts,
  .aside {
    grid-template-columns: minmax(0, 1fr);
  }

  .main {
    padding: var(--s-2);
  }

  .b-prog {
    display: none;
  }

  /* Nombre y resumen enteros arriba; debajo, estado y papelera (como las demás listas del móvil) */
  .batch {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    grid-template-areas:
      'ic main main'
      'ic status del';
    align-items: center;
    gap: 6px var(--s-3);
    padding: 12px 10px 10px 14px;
  }

  .b-ic {
    grid-area: ic;
    align-self: start;
  }

  .batch > .grow {
    grid-area: main;
  }

  .batch > .badge {
    grid-area: status;
    justify-self: start;
  }

  .b-del {
    grid-area: del;
  }

  .chev {
    display: none;
  }

  .b-name,
  .b-sub {
    white-space: normal;
  }
}
</style>
