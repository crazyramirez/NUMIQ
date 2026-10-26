<script setup lang="ts">
/** Copia de seguridad y Clonación completa de NUMIQ para migración de servidores */
const toast = useToast()
const { confirm } = useConfirm()
const { verifactu } = useMe()

const { data, refresh, status } = useFetch<{
  documents: number
  expenses: number
  contacts: number
  bank: number
  files: number
  filesSize: number
  last: { at: string, size: number } | null
  /** Clonar y restaurar la base de datos entera: solo quien administra el servidor */
  canClone: boolean
}>('/api/backup', { lazy: true, server: false })

const mode = ref<'clone' | 'archive'>('clone')
const cloning = computed(() => mode.value === 'clone' && !!data.value?.canClone)

const modeOptions = [
  { value: 'clone', label: 'Clonar a nuevo servidor (100% exacto)' },
  { value: 'archive', label: 'Copia para archivo (Excel, JSON)' },
]

// ─── 1. Copia para archivo (Excel / JSON / PDFs) ───
const opts = reactive({ pdfs: true, originals: true })
const busyArchive = ref(false)

async function downloadArchive() {
  busyArchive.value = true
  try {
    const res = await $fetch.raw<Blob>('/api/backup/download', {
      query: { pdfs: opts.pdfs ? 1 : 0, originals: opts.originals ? 1 : 0 },
      responseType: 'blob',
    })
    saveDownload(res, 'copia-numiq.zip')
    toast.success('Copia descargada', `${fileSize(res._data!.size)} · guárdala en un lugar seguro`)
    refresh()
  }
  catch (err) {
    toast.error('No se pudo generar la copia', errorMessage(err))
  }
  finally {
    busyArchive.value = false
  }
}

const daysSince = computed(() => (data.value?.last ? Math.floor((Date.now() - new Date(data.value.last.at).getTime()) / 86_400_000) : null))

// ─── 2. Clonación completa para nuevo servidor ───
const busyClone = ref(false)
const busyRestore = ref(false)
const restoreFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()

async function downloadClone() {
  busyClone.value = true
  try {
    const res = await $fetch.raw<Blob>('/api/backup/clone', { responseType: 'blob' })
    saveDownload(res, `numiq-clon-completo-${new Date().toISOString().slice(0, 10)}.zip`)
    toast.success('Clon completo generado', `${fileSize(res._data!.size)} · Base de datos SQL completa y archivos listos para migrar`)
  }
  catch (err) {
    toast.error('No se pudo generar el clon', errorMessage(err))
  }
  finally {
    busyClone.value = false
  }
}

function onFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files && target.files[0]) {
    restoreFile.value = target.files[0]
  }
}

async function executeRestore() {
  if (!restoreFile.value) return

  const ok = await confirm({
    title: '¿Restaurar clon completo en este servidor?',
    body: `Vas a restaurar "${restoreFile.value.name}" (${fileSize(restoreFile.value.size)}). Esta acción SOBRESCRIBIRÁ todas las tablas de la base de datos actual y copiará los archivos adjuntos. Todos los datos actuales serán sustituidos por los contenidos en el clon. ¿Deseas continuar?`,
    confirmLabel: 'Sí, restaurar datos',
    cancelLabel: 'Cancelar',
    danger: true,
  })

  if (!ok) return

  busyRestore.value = true
  try {
    const fd = new FormData()
    fd.append('file', restoreFile.value)

    const res = await $fetch<{ ok: boolean, tablesRestored: number, filesRestored: number }>('/api/backup/restore', {
      method: 'POST',
      body: fd,
    })

    toast.success('Clon restaurado con éxito', `${res.tablesRestored} tablas restauradas y ${res.filesRestored} archivos físicos actualizados.`)
    restoreFile.value = null
    if (fileInput.value) fileInput.value.value = ''
    refresh()
    setTimeout(() => {
      window.location.reload()
    }, 1500)
  }
  catch (err) {
    toast.error('Error al restaurar el clon', errorMessage(err))
  }
  finally {
    busyRestore.value = false
  }
}
</script>

<template>
  <div class="stack gap-4">
    <!-- Selector de modo: Clon vs Archivo -->
    <div v-if="data?.canClone" class="mode-header">
      <UiSegmented v-model="mode" :options="modeOptions" label="Tipo de copia de seguridad" />
    </div>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- MODO 1: CLONAR A NUEVO SERVIDOR                                         -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <template v-if="cloning">
      <UiCard
        title="Clonar a nuevo servidor"
        icon="ph:hard-drives"
        subtitle="Exporta e importa el 100% idéntico de tu NUMIQ: base de datos completa con todos los registros y contraseñas + todos los archivos físicos subidos."
      >
        <div class="clone-banner">
          <div class="cb-ic" aria-hidden="true">
            <Icon name="ph:copy-bold" />
          </div>
          <div class="cb-body">
            <strong>¿Para qué sirve esta opción?</strong>
            <p>
              Genera un paquete <span class="mono">.zip</span> con el volcado SQL integral de todas las tablas (usuarios con contraseñas seguras, facturas, clientes, presupuestos, gastos, bancos, configuraciones) junto a la carpeta física de archivos (<span class="mono">storage/uploads</span>: logos, justificantes y documentos escaneados). Al restaurarlo en un nuevo servidor o VPS, tendrás un duplicado exacto sin perder absolutamente nada.
            </p>
          </div>
        </div>

        <div class="clone-grid">
          <!-- Tarjeta 1: Exportar / Descargar -->
          <div class="action-card">
            <div class="ac-head">
              <span class="ac-icon export" aria-hidden="true"><Icon name="ph:download-simple-bold" /></span>
              <div>
                <h3>1. Exportar clon de este servidor</h3>
                <p class="ac-sub">Descarga el paquete completo empaquetado para migración.</p>
              </div>
            </div>

            <ul class="clone-checks">
              <li>
                <Icon name="ph:check-circle-fill" class="check-ok" />
                <span>Base de datos MySQL completa (todas las tablas y datos íntegros)</span>
              </li>
              <li>
                <Icon name="ph:check-circle-fill" class="check-ok" />
                <span>Usuarios, accesos y contraseñas cifradas</span>
              </li>
              <li>
                <Icon name="ph:check-circle-fill" class="check-ok" />
                <span>Todos los archivos físicos (logos, tickets, escaneos y adjuntos)</span>
              </li>
              <li>
                <Icon name="ph:check-circle-fill" class="check-ok" />
                <span>Manifiesto e instrucciones paso a paso de restauración</span>
              </li>
            </ul>

            <div class="ac-footer">
              <UiButton
                variant="primary"
                icon="ph:file-zip"
                :loading="busyClone"
                class="w-full"
                @click="downloadClone"
              >
                {{ busyClone ? 'Generando paquete de clonación…' : 'Descargar clon completo (.zip)' }}
              </UiButton>
            </div>
          </div>

          <!-- Tarjeta 2: Restaurar / Importar -->
          <div class="action-card">
            <div class="ac-head">
              <span class="ac-icon import" aria-hidden="true"><Icon name="ph:upload-simple-bold" /></span>
              <div>
                <h3>2. Restaurar clon en este servidor</h3>
                <p class="ac-sub">Restaura un paquete .zip de clonación generado por NUMIQ.</p>
              </div>
            </div>

            <div class="drop-zone" @click="fileInput?.click()">
              <input
                ref="fileInput"
                type="file"
                accept=".zip"
                class="sr-only"
                @change="onFileSelect"
              >
              <Icon :name="restoreFile ? 'ph:file-zip-fill' : 'ph:cloud-arrow-up'" class="drop-icon" :class="{ 'has-file': restoreFile }" />
              <div v-if="restoreFile" class="drop-file-info">
                <span class="font-bold text-sm">{{ restoreFile.name }}</span>
                <span class="text-xs text-3 num">{{ fileSize(restoreFile.size) }}</span>
              </div>
              <div v-else class="drop-prompt">
                <span class="font-medium text-sm">Selecciona o arrastra el archivo de clonación</span>
                <span class="text-xs text-3">Archivo .zip con database.sql y uploads</span>
              </div>
            </div>

            <div class="ac-footer">
              <UiButton
                variant="secondary"
                icon="ph:arrow-counter-clockwise-bold"
                :disabled="!restoreFile || busyRestore"
                :loading="busyRestore"
                class="w-full"
                @click="executeRestore"
              >
                {{ busyRestore ? 'Restaurando base de datos y archivos…' : 'Restaurar datos ahora' }}
              </UiButton>
            </div>
          </div>
        </div>

        <!-- Instrucciones y comandos de consola -->
        <div class="cli-guide">
          <div class="cli-head">
            <Icon name="ph:terminal-window" aria-hidden="true" />
            <span>Migración por consola / terminal (ideal para servidores VPS, Plesk o bases de datos grandes):</span>
          </div>

          <div class="cli-steps">
            <div class="cli-step">
              <span class="step-badge">Paso 1</span>
              <p>En el servidor actual puedes exportar el clon directamente por terminal:</p>
              <pre class="cli-code">npm run clone:export</pre>
            </div>

            <div class="cli-step">
              <span class="step-badge">Paso 2</span>
              <p>Copia el archivo generado al nuevo servidor (por SCP, SFTP o descargándolo) y ejecuta:</p>
              <pre class="cli-code">npm run clone:import numiq-clon-completo-YYYY-MM-DD.zip</pre>
            </div>

            <div class="cli-step">
              <span class="step-badge">Alternativa</span>
              <p>El <span class="mono">.zip</span> contiene en su interior el archivo estándar <span class="mono">database.sql</span> y la carpeta <span class="mono">uploads/</span>. Puedes importarlo directamente con MySQL:</p>
              <pre class="cli-code">mysql -u usuario -p base_de_datos &lt; database.sql</pre>
            </div>
          </div>
        </div>
      </UiCard>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- MODO 2: COPIA PARA ARCHIVO (EXCEL / JSON)                               -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <template v-else>
      <UiCard
        title="Copia de seguridad (Formato abierto)"
        icon="ph:cloud-arrow-down"
        subtitle="Descarga los datos de tu empresa en formatos legibles sin NUMIQ: hojas de cálculo Excel, JSON estructurado y PDFs clasificados."
      >
        <div v-if="status === 'pending' && !data" class="stack gap-3">
          <div v-for="i in 3" :key="i" class="skeleton" style="height: 44px" />
        </div>
        <div v-else-if="data" class="bk">
          <div class="last" :class="{ warn: daysSince === null || daysSince > 90 }">
            <Icon :name="data.last ? 'ph:clock-counter-clockwise' : 'ph:warning-circle'" aria-hidden="true" />
            <span v-if="data.last">Última copia {{ relTime(data.last.at) }} · {{ fileSize(data.last.size) }}</span>
            <span v-else>Aún no has descargado ninguna copia</span>
          </div>

          <ul class="what">
            <li>
              <span class="w-ic" aria-hidden="true"><Icon name="ph:file-xls" /></span>
              <span><strong>Excel</strong> con facturas, presupuestos, gastos, contactos, productos, cobros y pagos{{ data.bank ? ' y banco' : '' }}</span>
            </li>
            <li>
              <span class="w-ic" aria-hidden="true"><Icon name="ph:brackets-curly" /></span>
              <span><strong>Datos completos</strong> en JSON, para archivo documental o análisis{{ verifactu ? ' (incluye los registros VeriFactu)' : '' }}</span>
            </li>
          </ul>

          <div class="opts">
            <UiSwitch v-model="opts.pdfs" label="PDF de facturas y presupuestos" :hint="`${data.documents} documentos emitidos, ordenados por año`" />
            <UiSwitch v-model="opts.originals" label="Documentos originales" :hint="data.files ? `${data.files} archivos · ${fileSize(data.filesSize)}: tickets, facturas recibidas, archivo trimestral y adjuntos` : 'No tienes documentos subidos'" :disabled="!data.files" />
          </div>

          <div class="actions">
            <p class="note"><Icon name="ph:lock-simple" aria-hidden="true" /> Contiene datos personales y fiscales: guárdala en un lugar seguro.</p>
            <UiButton variant="primary" icon="ph:download-simple" :loading="busyArchive" @click="downloadArchive">
              {{ busyArchive ? 'Preparando la copia…' : 'Descargar copia para archivo' }}
            </UiButton>
          </div>
        </div>
      </UiCard>
    </template>
  </div>
</template>

<style scoped>
.mode-header {
  display: flex;
  justify-content: flex-start;
  margin-bottom: var(--s-1);
}

.clone-banner {
  display: flex;
  gap: var(--s-4);
  padding: var(--s-4);
  background: var(--brand-soft);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  margin-bottom: var(--s-5);
}

.cb-ic {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  background: var(--surface);
  border-radius: var(--r-md);
  color: var(--brand);
  font-size: 20px;
  flex-shrink: 0;
}

.cb-body strong {
  display: block;
  font-size: var(--text-sm);
  color: var(--text);
  margin-bottom: 2px;
}

.cb-body p {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-2);
  line-height: 1.5;
}

.clone-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--s-5);
  margin-bottom: var(--s-5);
}

.action-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: var(--s-5);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.ac-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: var(--s-4);
}

.ac-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: var(--r-md);
  font-size: 20px;
  flex-shrink: 0;
}

.ac-icon.export {
  color: var(--brand);
  background: var(--brand-soft);
}

.ac-icon.import {
  color: var(--success);
  background: var(--success-soft);
}

.ac-head h3 {
  font-size: var(--text-base);
  font-weight: 600;
  margin: 0 0 2px 0;
  color: var(--text);
}

.ac-sub {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.clone-checks {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--s-5) 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.clone-checks li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--text-2);
  line-height: 1.4;
}

.check-ok {
  color: var(--brand);
  font-size: 16px;
  margin-top: 1px;
  flex-shrink: 0;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: var(--s-5);
  margin-bottom: var(--s-5);
  border: 2px dashed var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  cursor: pointer;
  text-align: center;
  transition: border-color var(--t-fast), background var(--t-fast);
}

.drop-zone:hover {
  border-color: var(--brand);
  background: var(--surface-hover);
}

.drop-icon {
  font-size: 32px;
  color: var(--text-3);
  transition: color var(--t-fast);
}

.drop-icon.has-file {
  color: var(--brand);
}

.drop-file-info,
.drop-prompt {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.w-full {
  width: 100%;
}

.cli-guide {
  padding: var(--s-4);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.cli-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: var(--s-3);
}

.cli-steps {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.cli-step {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.step-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--brand);
  letter-spacing: 0.5px;
}

.cli-step p {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.cli-code {
  margin: 2px 0 0 0;
  padding: 8px 12px;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs);
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  color: var(--text);
  overflow-x: auto;
}

/* ─── Estilos de la vista de archivo ─── */
.bk {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.last {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-md);
}

.last.warn {
  color: var(--warning);
  background: var(--warning-soft);
}

.what {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.what li {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.what strong {
  color: var(--text);
  font-weight: 600;
}

.w-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  font-size: 18px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-md);
}

.opts {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  padding-top: var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  flex-wrap: wrap;
}

.note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

@media (max-width: 640px) {
  .actions > :last-child {
    width: 100%;
  }
}
</style>
