<script setup lang="ts">
/**
 * Bandeja de entrada: todo lo que llega (correos con facturas, documentos leídos por la IA,
 * gastos por revisar) en un solo sitio, con una decisión por cosa. El objetivo: dejarla vacía.
 */
useHead({ title: 'Bandeja · NUMIQ' })

interface MailMsg { id: number, fromName: string | null, fromAddress: string | null, subject: string | null, date: string | null, attachments: Array<{ filename: string, size: number, mime: string }> | null }
interface ImportRow { id: number, name: string | null, source: 'upload' | 'scan' | 'email', status: string, totalFiles: number, processedFiles: number, createdAt: string, running: boolean }
interface Feed {
  mail: { configured: boolean, wholeInbox: boolean, lastSync: string | null, messages: MailMsg[] }
  imports: ImportRow[]
  unreviewedExpenses: number
}

const toast = useToast()
const { open: openScan } = useScan()
const { me } = useMe()
const readOnly = computed(() => me.value?.company?.role === 'advisor')

const { data, status, refresh: refreshFeed, error } = useFetch<Feed>('/api/inbox', { key: 'inbox', lazy: true })
const inbox = useInboxCount()
// Cada cambio en la bandeja actualiza también el contador del menú
async function refresh() {
  await refreshFeed()
  inbox.refresh(true)
}
const firstLoad = computed(() => status.value === 'pending' && !data.value)
const messages = computed(() => data.value?.mail.messages ?? [])
const imports = computed(() => data.value?.imports ?? [])
const pending = computed(() => messages.value.length + imports.value.length + (data.value?.unreviewedExpenses ? 1 : 0))

// Mientras la IA lee una importación, la bandeja se refresca sola
const reading = computed(() => imports.value.some(i => i.running || i.status === 'processing' || i.status === 'uploading'))
let timer: ReturnType<typeof setInterval> | null = null
watch(reading, (on) => {
  if (on && !timer) timer = setInterval(() => refresh(), 4000)
  if (!on && timer) {
    clearInterval(timer)
    timer = null
  }
}, { immediate: true })
onBeforeUnmount(() => timer && clearInterval(timer))

// ─── Correo ───

const busy = ref<string | null>(null)

async function sync() {
  busy.value = 'sync'
  try {
    const r = await $fetch<{ scanned: number, added: number }>('/api/mail/sync', { method: 'POST', body: {} })
    toast.success(r.added ? `${r.added} ${r.added === 1 ? 'correo nuevo' : 'correos nuevos'} con facturas` : 'No hay correo nuevo', r.added ? 'Ya están en tu bandeja.' : 'Te avisamos aquí en cuanto llegue algo.')
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo revisar el correo', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

/** Lee con IA los adjuntos y abre la revisión: nada se crea sin confirmar */
async function readWithAi(ids: number[]) {
  busy.value = ids.length === 1 ? `read-${ids[0]}` : 'read-all'
  try {
    const r = await $fetch<{ batchId: number, files: number }>('/api/mail/import', { method: 'POST', body: { ids } })
    if (!r.files) {
      toast.info('Sin documentos que leer', 'Los adjuntos no parecen facturas.')
      await refresh()
      return
    }
    await navigateTo(`/documentos/importacion/${r.batchId}`)
  }
  catch (err) {
    toast.error('No se pudieron leer los correos', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function ignore(ids: number[]) {
  busy.value = `ignore-${ids[0]}`
  try {
    await $fetch('/api/mail/status', { method: 'POST', body: { ids, status: 'ignored' } })
    await refresh()
    toast.success(ids.length === 1 ? 'Correo descartado' : 'Correos descartados', 'Ya no aparecerán en la bandeja.')
  }
  catch (err) {
    toast.error('No se pudo descartar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

const fromOf = (m: MailMsg) => m.fromName || m.fromAddress || 'Remitente desconocido'
const sizeOf = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1000))} KB`)
const whenOf = (iso: string | null) => (iso ? relDays(iso.slice(0, 10)) : '')
const fileIcon = (mime: string) => (mime.includes('pdf') ? 'ph:file-pdf' : mime.startsWith('image/') ? 'ph:image' : mime.includes('zip') ? 'ph:file-zip' : mime.includes('sheet') || mime.includes('excel') || mime.includes('csv') ? 'ph:file-xls' : 'ph:file')

// ─── Importaciones ───
const SOURCE: Record<ImportRow['source'], { icon: string, label: string }> = {
  upload: { icon: 'ph:upload-simple', label: 'Subida' },
  scan: { icon: 'ph:scan', label: 'Escaneo' },
  email: { icon: 'ph:envelope-simple', label: 'Correo' },
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Bandeja</h1>
        <p class="sub">Todo lo que te llega, en un sitio. Decide qué es cada cosa y deja la bandeja vacía.</p>
      </div>
      <div v-if="!readOnly" class="page-actions">
        <UiButton
          v-if="data?.mail.configured"
          variant="soft"
          icon="ph:arrows-clockwise"
          compact
          :loading="busy === 'sync'"
          :title="data.mail.lastSync ? `Revisado ${relDays(data.mail.lastSync.slice(0, 10))}` : undefined"
          @click="sync"
        >
          Buscar correo nuevo
        </UiButton>
        <UiButton icon="ph:upload-simple" compact to="/documentos">Subir archivos</UiButton>
        <UiButton variant="ai" icon="ph:camera" compact @click="openScan()">Foto de un ticket</UiButton>
      </div>
    </header>

    <UiCard v-if="error && !data">
      <UiEmpty icon="ph:cloud-warning" title="No hemos podido cargar la bandeja" :text="errorMessage(error)">
        <UiButton icon="ph:arrow-clockwise" @click="refresh()">Reintentar</UiButton>
      </UiEmpty>
    </UiCard>

    <div v-else-if="firstLoad" class="stack gap-4" aria-busy="true">
      <div class="card sk" style="height: 120px" />
      <div class="card sk" style="height: 260px" />
    </div>

    <template v-else-if="data">
      <!-- Vacía: la meta -->
      <UiCard v-if="!pending" class="rise" style="--i: 1">
        <div class="zero">
          <span class="zero-ic" aria-hidden="true"><Icon name="ph:check-circle-fill" /></span>
          <h2>Bandeja vacía</h2>
          <p>Todo lo que te ha llegado ya está registrado. Cuando entre una factura por correo o subas documentos, aparecerán aquí.</p>
        </div>
      </UiCard>

      <template v-else>
        <!-- Documentos leídos por la IA, esperando tu visto bueno -->
        <section v-if="imports.length" class="block rise" style="--i: 1">
          <h2 class="block-t">Leído por la IA, por confirmar <span class="n num">{{ imports.length }}</span></h2>
          <ul class="list card">
            <li v-for="b in imports" :key="b.id">
              <NuxtLink :to="`/documentos/importacion/${b.id}`" class="row">
                <span class="row-ic ai" aria-hidden="true"><Icon :name="SOURCE[b.source].icon" /></span>
                <span class="row-main">
                  <span class="row-t">{{ b.name || 'Importación' }}</span>
                  <span class="row-s">
                    <template v-if="b.status === 'review'">{{ b.totalFiles }} {{ b.totalFiles === 1 ? 'documento leído' : 'documentos leídos' }} · {{ SOURCE[b.source].label }} {{ whenOf(b.createdAt) }}</template>
                    <template v-else>Leyendo {{ b.processedFiles }} de {{ b.totalFiles }}…</template>
                  </span>
                </span>
                <span v-if="b.status === 'review'" class="row-go">Revisar <Icon name="ph:arrow-right" aria-hidden="true" /></span>
                <span v-else class="spin" aria-label="Leyendo" />
              </NuxtLink>
            </li>
          </ul>
        </section>

        <!-- Gastos que la IA registró y conviene mirar -->
        <section v-if="data.unreviewedExpenses" class="block rise" style="--i: 2">
          <NuxtLink to="/gastos?estado=review&periodo=all" class="card row single">
            <span class="row-ic warn" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
            <span class="row-main">
              <span class="row-t">{{ data.unreviewedExpenses }} {{ data.unreviewedExpenses === 1 ? 'gasto leído por la IA espera' : 'gastos leídos por la IA esperan' }} un vistazo</span>
              <span class="row-s">Comprueba importes y categoría; un toque y listo</span>
            </span>
            <span class="row-go">Revisar <Icon name="ph:arrow-right" aria-hidden="true" /></span>
          </NuxtLink>
        </section>

        <!-- Correos con facturas adjuntas -->
        <section v-if="messages.length" class="block rise" style="--i: 3">
          <div class="block-h">
            <h2 class="block-t">Correo con facturas <span class="n num">{{ messages.length }}</span></h2>
            <UiButton v-if="!readOnly && messages.length > 1" size="sm" variant="ai" icon="ph:sparkle-fill" :loading="busy === 'read-all'" :disabled="!!busy" @click="readWithAi(messages.map(m => m.id))">
              Leer todo con IA
            </UiButton>
          </div>
          <ul class="list card">
            <li v-for="m in messages" :key="m.id" class="mail">
              <div class="mail-top">
                <UiAvatar :name="fromOf(m)" :size="36" />
                <div class="grow min0">
                  <p class="mail-from">{{ fromOf(m) }}</p>
                  <p class="mail-sub">{{ m.subject || '(Sin asunto)' }}</p>
                </div>
                <span class="mail-when">{{ whenOf(m.date) }}</span>
              </div>
              <div class="files">
                <span v-for="a in m.attachments ?? []" :key="a.filename" class="file" :title="a.filename">
                  <Icon :name="fileIcon(a.mime)" aria-hidden="true" />
                  <span class="file-n">{{ a.filename }}</span>
                  <span class="file-s num">{{ sizeOf(a.size) }}</span>
                </span>
              </div>
              <div v-if="!readOnly" class="mail-acts">
                <UiButton size="sm" variant="ghost" :loading="busy === `ignore-${m.id}`" :disabled="!!busy" @click="ignore([m.id])">No es una factura</UiButton>
                <UiButton size="sm" variant="primary" icon="ph:sparkle-fill" :loading="busy === `read-${m.id}`" :disabled="!!busy" @click="readWithAi([m.id])">Leer con IA</UiButton>
              </div>
            </li>
          </ul>
        </section>
      </template>

      <p v-if="!data.mail.configured" class="note">
        <Icon name="ph:info" aria-hidden="true" /> El correo no está configurado: cuando lo esté, las facturas que te lleguen por correo aparecerán aquí.
      </p>
    </template>
  </div>
</template>

<style scoped>
.zero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: var(--s-8) var(--s-5);
  text-align: center;
}

.zero-ic {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: 4px;
  font-size: 34px;
  color: var(--success);
  background: var(--success-soft);
  border-radius: var(--r-full);
}

.zero h2 {
  font-size: var(--text-xl);
  font-weight: 680;
}

.zero p {
  max-width: 460px;
  color: var(--text-3);
}

.block + .block {
  margin-top: var(--s-6);
}

.block-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  margin-bottom: var(--s-3);
}

.block-t {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--s-3);
  font-size: var(--text-md);
  font-weight: 650;
}

.block-h .block-t {
  margin-bottom: 0;
}

.block-t .n {
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  font-size: var(--text-xs);
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.list {
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
}

.list > li + li {
  border-top: 1px solid var(--border-subtle);
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px var(--s-5);
  transition: background var(--t-fast);
}

.row:hover {
  background: var(--surface-hover);
}

.row-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  font-size: 19px;
  border-radius: 12px;
}

.row-ic.ai {
  color: var(--ai-1);
  background: var(--ai-soft);
}

.row-ic.warn {
  color: var(--warning);
  background: var(--warning-soft);
}

.row-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row-t {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.row-s {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.row-go {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--brand-text);
}

.spin {
  flex: none;
  width: 18px;
  height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.mail {
  padding: 14px var(--s-5);
}

.mail-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.mail-from {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.mail-sub {
  margin-top: 1px;
  font-size: var(--text-sm);
  color: var(--text-2);
  overflow-wrap: anywhere;
}

.mail-when {
  flex: none;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 0 48px;
}

.file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 30px;
  padding: 0 10px;
  font-size: var(--text-xs);
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.file :deep(svg) {
  flex: none;
  width: 15px;
  height: 15px;
  color: var(--text-3);
}

.file-n {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-s {
  flex: none;
  color: var(--text-4);
}

.mail-acts {
  display: flex;
  justify-content: flex-end;
  gap: var(--s-2);
  margin-top: 10px;
}

.note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--s-5);
  font-size: var(--text-sm);
  color: var(--text-3);
}

.sk {
  background: linear-gradient(90deg, var(--surface) 0, var(--surface-hover) 40%, var(--surface) 80%);
  background-size: 800px 100%;
  animation: shimmer 1.3s linear infinite;
}

.min0 {
  min-width: 0;
}

@media (max-width: 767px) {
  .row,
  .mail {
    padding: 14px var(--s-4);
  }

  .files {
    margin-left: 0;
  }
}
</style>
