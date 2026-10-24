<script setup lang="ts">
import type { DroppedFile } from '~/components/docs/Dropzone.vue'
import type { Advisor } from '~/components/settings/AdvisorForm.vue'

useHead({ title: 'Gestoría · NUMIQ' })

interface Preview {
  period: { from: string, to: string, label: string, slug: string }
  issued: { count: number, base: number, total: number }
  received: { count: number, base: number, total: number, withFile: number, bytes: number }
  vault: Array<{ id: number, name: string, folder: string | null, size: number, mime: string, year: number, quarter: number, notes: string | null }>
  estimate: number
}

interface Pack {
  id: number
  label: string
  periodFrom: string
  periodTo: string
  contents: { issued: number, received: number, receivedFiles: number, vault: number, summary: boolean, files: number } | null
  size: number
  expiresAt: string
  downloads: number
  sentTo: string | null
  sentAt: string | null
  emailStatus: 'sent' | 'failed' | null
  emailError: string | null
  createdAt: string
  available: boolean
}

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirm()
const { me } = useMe()

// ─── Periodo: por defecto el trimestre anterior (lo habitual al presentar impuestos) ───

const now = new Date()
const curQ = quarterOf(now)
const gran = ref<'month' | 'quarter' | 'year' | 'range'>(route.query.mes ? 'month' : route.query.t ? 'quarter' : 'quarter')
const year = ref(Number(route.query.anio) || (curQ === 1 ? now.getFullYear() - 1 : now.getFullYear()))
const quarter = ref(Number(route.query.t) || (curQ === 1 ? 4 : curQ - 1))
const month = ref(Number(route.query.mes) || (now.getMonth() === 0 ? 12 : now.getMonth()))
const from = ref(`${now.getFullYear()}-01-01`)
const to = ref(todayISO())

const periodQuery = computed(() => {
  if (gran.value === 'range') return { from: from.value, to: to.value }
  if (gran.value === 'month') return { year: year.value, month: month.value }
  if (gran.value === 'quarter') return { year: year.value, quarter: quarter.value }
  return { year: year.value }
})
const rangeOk = computed(() => gran.value !== 'range' || (!!from.value && !!to.value && from.value <= to.value))

const { data: preview, pending: loadingPreview } = await useFetch<Preview>('/api/advisor/preview', {
  query: periodQuery,
  watch: [periodQuery],
  immediate: true,
})
const { data: info, refresh: refreshInfo } = await useFetch<{ advisor: Advisor | null, mail: boolean, packs: Pack[] }>('/api/advisor', { default: () => ({ advisor: null, mail: true, packs: [] }) })
const { page: packPage, pages: packPages, items: shownPacks } = usePaged(() => info.value.packs)

const granOptions = [
  { value: 'month', label: 'Mes' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'year', label: 'Año' },
  { value: 'range', label: 'Fechas' },
]
const granModel = computed({ get: () => gran.value as string, set: (v: string) => { gran.value = v as typeof gran.value } })
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const monthOptions = MONTHS.map((m, i) => ({ value: i + 1, label: m.charAt(0).toUpperCase() + m.slice(1) }))

// ─── Qué se incluye ───

const incIssued = ref(true)
const incReceived = ref(true)
const incSummary = ref(true)
const vaultIds = ref<number[]>([])
watch(() => preview.value?.vault, (v) => {
  vaultIds.value = (v ?? []).map(f => f.id)
}, { immediate: true })

function toggleVault(id: number) {
  vaultIds.value = vaultIds.value.includes(id) ? vaultIds.value.filter(x => x !== id) : [...vaultIds.value, id]
}

const size = computed(() => {
  const p = preview.value
  if (!p) return 0
  const vaultBytes = p.vault.filter(v => vaultIds.value.includes(v.id)).reduce((s, v) => s + v.size, 0)
  return (incIssued.value ? p.issued.count * 30_000 : 0) + (incReceived.value ? p.received.bytes : 0) + vaultBytes + (incSummary.value ? 50_000 : 0)
})
const nothing = computed(() => !incIssued.value && !incReceived.value && !incSummary.value && !vaultIds.value.length)

// Documentos nuevos al archivo del periodo (último trimestre del rango)
const uploadFolder = ref('banco')
const uploading = ref(false)
const target = computed(() => {
  const end = preview.value?.period.to ?? todayISO()
  return { year: Number(end.slice(0, 4)), quarter: quarterOf(end) }
})
async function upload(list: DroppedFile[]) {
  uploading.value = true
  try {
    const form = new FormData()
    for (const f of list) form.append('files', f.file, f.file.name)
    form.append('folder', uploadFolder.value)
    form.append('year', String(target.value.year))
    form.append('quarter', String(target.value.quarter))
    const r = await uploadForm<{ ids: number[], skipped: Array<{ name: string, reason: string }> }>('/api/vault', form)
    if (r.skipped.length) toast.error('Algunos archivos no se añadieron', r.skipped.map(s => `${s.name}: ${s.reason}`).join(' · '))
    await refreshNuxtData()
    vaultIds.value = [...new Set([...vaultIds.value, ...r.ids])]
    if (r.ids.length) toast.success(`${r.ids.length} documento${r.ids.length > 1 ? 's' : ''} añadido${r.ids.length > 1 ? 's' : ''}`, `Guardado${r.ids.length > 1 ? 's' : ''} también en el archivo (${target.value.quarter}T ${target.value.year})`)
  }
  catch (err) {
    toast.error('No se pudo subir', errorMessage(err))
  }
  finally {
    uploading.value = false
  }
}

// ─── Correo ───

const brand = computed(() => me.value?.company?.tradeName || me.value?.company?.legalName || '')
const firstName = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? ''
const mail = ref({ to: '', cc: '', subject: '', message: '' })
const touched = ref(false)

function defaults() {
  const a = info.value.advisor
  const label = preview.value?.period.label ?? ''
  const extra = vaultIds.value.length ? ', la documentación adicional' : ''
  const hello = a?.name ? `Hola, ${firstName(a.name)}:` : 'Hola:'
  return {
    to: a?.email ?? '',
    cc: a?.cc?.join(', ') ?? '',
    subject: `Documentación ${label} · ${brand.value}`,
    message: a?.message || `${hello}\n\nTe envío la documentación de ${label}: facturas emitidas generadas en la app, facturas recibidas y gastos con sus justificantes${extra} y un resumen con los libros registro, el IVA y las retenciones.\n\nCualquier cosa que necesites, me dices.\n\nUn saludo,\n${me.value?.user?.name ?? ''}`,
  }
}

watch([() => preview.value?.period.label, () => info.value.advisor, () => vaultIds.value.length > 0], () => {
  if (!touched.value) mail.value = defaults()
}, { immediate: true })

// ─── Preparar, descargar y enviar ───

const busy = ref<'download' | 'send' | null>(null)
const errors = ref<Record<string, string>>({})

async function build() {
  return $fetch<Pack>('/api/advisor/packs', {
    method: 'POST',
    body: { period: periodQuery.value, issued: incIssued.value, received: incReceived.value, summary: incSummary.value, vaultIds: vaultIds.value },
  })
}

async function download() {
  busy.value = 'download'
  try {
    const pack = await build()
    window.location.href = `/api/advisor/packs/${pack.id}/download`
    toast.success('ZIP preparado', `${pack.contents?.files ?? 0} archivos · ${fileSize(pack.size)}`)
    await refreshInfo()
  }
  catch (err) {
    toast.error('No se pudo preparar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function send() {
  errors.value = {}
  if (!mail.value.to.trim()) {
    errors.value.to = 'Indica el email de tu gestor'
    return
  }
  busy.value = 'send'
  try {
    const pack = await build()
    const r = await $fetch<{ attached: boolean }>(`/api/advisor/packs/${pack.id}/send`, { method: 'POST', body: mail.value })
    toast.success('Enviado a tu gestor', r.attached ? `ZIP adjunto (${fileSize(pack.size)}) y enlace de descarga` : 'Con enlace de descarga (el ZIP era demasiado grande para adjuntarlo)')
    touched.value = false
    await refreshInfo()
  }
  catch (err) {
    const field = errorField(err)
    if (field) errors.value[field.split('.')[0]!] = errorMessage(err)
    else toast.error('No se pudo enviar', errorMessage(err))
    await refreshInfo()
  }
  finally {
    busy.value = null
  }
}

async function removePack(p: Pack) {
  const ok = await confirm({ title: '¿Borrar este envío?', body: 'Se borra el ZIP y el enlace que recibió tu gestor deja de funcionar.', confirmLabel: 'Borrar', danger: true })
  if (!ok) return
  try {
    await $fetch(`/api/advisor/packs/${p.id}`, { method: 'DELETE' })
    await refreshInfo()
  }
  catch (err) {
    toast.error('No se pudo borrar', errorMessage(err))
  }
}

const advisorOpen = ref(false)
function onAdvisorSaved(a: Advisor | null) {
  info.value = { ...info.value, advisor: a }
  advisorOpen.value = false
  touched.value = false
  mail.value = defaults()
}

const vaultByFolder = computed(() => {
  const groups = new Map<string, Preview['vault']>()
  for (const v of preview.value?.vault ?? []) {
    const k = v.folder ?? 'otros'
    groups.set(k, [...(groups.get(k) ?? []), v])
  }
  return [...groups.entries()]
})
const folderOptions = VAULT_FOLDERS.map(f => ({ value: f.key, label: f.label }))
const expired = (p: Pack) => new Date(p.expiresAt) < new Date()
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Gestoría</h1>
        <p class="sub">Todo lo que tu gestoría necesita de un periodo, en un ZIP y con un correo preparado.</p>
      </div>
    </header>


    <div class="grid">
      <div class="main">
        <!-- Periodo -->
        <section class="card block rise" style="--i: 1">
          <div class="b-head">
            <span class="step">1</span>
            <h2 class="section-title">Periodo</h2>
          </div>
          <div class="period">
            <UiSegmented v-model="granModel" :options="granOptions" label="Tipo de periodo" />
            <template v-if="gran !== 'range'">
              <div class="year" role="group" aria-label="Año">
                <UiButton variant="ghost" size="sm" square icon="ph:caret-left" aria-label="Año anterior" @click="year--" />
                <span class="num y">{{ year }}</span>
                <UiButton variant="ghost" size="sm" square icon="ph:caret-right" aria-label="Año siguiente" :disabled="year >= now.getFullYear()" @click="year++" />
              </div>
              <div v-if="gran === 'quarter'" class="qs" role="group" aria-label="Trimestre">
                <button v-for="q in 4" :key="q" type="button" class="q" :class="{ on: quarter === q }" :aria-pressed="quarter === q" @click="quarter = q">{{ q }}T</button>
              </div>
              <UiSelect v-if="gran === 'month'" v-model="month" :options="monthOptions" aria-label="Mes" class="month" />
            </template>
            <template v-else>
              <UiInput v-model="from" type="date" aria-label="Desde" class="date" />
              <span class="muted">a</span>
              <UiInput v-model="to" type="date" aria-label="Hasta" class="date" :error="rangeOk ? null : 'Revisa las fechas'" />
            </template>
          </div>
          <p v-if="preview" class="p-label"><Icon name="ph:calendar-blank" aria-hidden="true" /> {{ preview.period.label }} · del {{ fdate(preview.period.from) }} al {{ fdate(preview.period.to) }}</p>
        </section>

        <!-- Contenido -->
        <section class="card block rise" style="--i: 2">
          <div class="b-head">
            <span class="step">2</span>
            <h2 class="section-title">Qué se envía</h2>
            <span v-if="loadingPreview" class="spinner-sm" aria-hidden="true" />
          </div>

          <div class="incl">
            <label class="opt" :class="{ on: incIssued }">
              <input v-model="incIssued" type="checkbox">
              <span class="o-ic issued" aria-hidden="true"><Icon name="ph:receipt" /></span>
              <span class="grow min0">
                <span class="o-t">Facturas emitidas</span>
                <span class="o-s">{{ preview ? `${preview.issued.count} factura${preview.issued.count === 1 ? '' : 's'} en PDF (generadas por la app) · ${eur(preview.issued.total)}` : '…' }}</span>
              </span>
            </label>
            <label class="opt" :class="{ on: incReceived }">
              <input v-model="incReceived" type="checkbox">
              <span class="o-ic received" aria-hidden="true"><Icon name="ph:wallet" /></span>
              <span class="grow min0">
                <span class="o-t">Facturas recibidas y gastos</span>
                <span class="o-s">{{ preview ? `${preview.received.count} gasto${preview.received.count === 1 ? '' : 's'} · ${preview.received.withFile} con documento original · ${eur(preview.received.total)}` : '…' }}</span>
              </span>
            </label>
            <label class="opt" :class="{ on: incSummary }">
              <input v-model="incSummary" type="checkbox">
              <span class="o-ic summary" aria-hidden="true"><Icon name="ph:table" /></span>
              <span class="grow min0">
                <span class="o-t">Resumen para el gestor</span>
                <span class="o-s">Libros registro de emitidas y recibidas, IVA y retenciones, en Excel y PDF</span>
              </span>
            </label>
          </div>

          <div class="vault">
            <p class="eyebrow">Documentación adicional del archivo</p>
            <p v-if="!preview?.vault.length" class="muted small">No hay documentos en el archivo para este periodo. Añade extractos del banco, contratos o justificantes:</p>
            <div v-for="[folder, list] in vaultByFolder" :key="folder" class="v-group">
              <p class="v-folder"><Icon :name="vaultFolder(folder).icon" aria-hidden="true" /> {{ vaultFolder(folder).label }}</p>
              <label v-for="v in list" :key="v.id" class="v-file">
                <input type="checkbox" :checked="vaultIds.includes(v.id)" @change="toggleVault(v.id)">
                <Icon :name="fileIcon(v.name, v.mime)" class="v-ic" aria-hidden="true" />
                <span class="grow truncate">{{ v.name }}</span>
                <span class="v-meta num">{{ v.quarter }}T · {{ fileSize(v.size) }}</span>
              </label>
            </div>
            <DocsDropzone compact :title="uploading ? 'Subiendo…' : 'Añadir documentos a este envío'" :hint="`Se guardan también en el archivo (${target.quarter}T ${target.year})`" :disabled="uploading" @files="upload">
              <div class="dest">
                <span class="label">Carpeta</span>
                <UiSelect v-model="uploadFolder" :options="folderOptions" aria-label="Carpeta" />
              </div>
            </DocsDropzone>
          </div>
        </section>

        <!-- Correo -->
        <section class="card block rise" style="--i: 3">
          <div class="b-head">
            <span class="step">3</span>
            <h2 class="section-title">Correo para tu gestor</h2>
          </div>
          <div class="form-grid">
            <UiInput v-model="mail.to" class="c-6" label="Para" type="email" placeholder="gestor@asesoria.es" :error="errors.to" @input="touched = true" />
            <UiInput v-model="mail.cc" class="c-6" label="Copia (opcional)" :error="errors.cc" @input="touched = true" />
            <UiInput v-model="mail.subject" class="c-12" label="Asunto" :error="errors.subject" @input="touched = true" />
            <UiTextarea v-model="mail.message" class="c-12 msg" label="Mensaje" :error="errors.message" @input="touched = true" />
          </div>
          <p v-if="!info.mail" class="warn-mail"><Icon name="ph:warning-fill" aria-hidden="true" /> El correo no está configurado: puedes descargar el ZIP y enviarlo tú.</p>
        </section>

        <div class="actionbar">
          <p class="ab-t">
            <Icon name="ph:file-zip" aria-hidden="true" />
            <span>ZIP de unos <b class="num">{{ fileSize(size) }}</b></span>
            <span class="muted">· {{ size > 18 * 1024 * 1024 ? 'irá como enlace de descarga' : 'irá adjunto y con enlace' }}</span>
          </p>
          <div class="row gap-2">
            <UiButton variant="secondary" icon="ph:download-simple" :loading="busy === 'download'" :disabled="!!busy || nothing || !rangeOk" @click="download">Descargar ZIP</UiButton>
            <UiButton variant="primary" icon="ph:paper-plane-tilt" :loading="busy === 'send'" :disabled="!!busy || nothing || !rangeOk || !info.mail" @click="send">Enviar al gestor</UiButton>
          </div>
        </div>
      </div>

      <aside class="aside">
        <UiCard class="rise" style="--i: 2">
          <div class="adv">
            <span class="a-ic" aria-hidden="true"><Icon name="ph:briefcase" /></span>
            <div class="grow min0">
              <p class="eyebrow">Tu gestor</p>
              <template v-if="info.advisor">
                <p class="a-name truncate">{{ info.advisor.name || info.advisor.firm }}</p>
                <p v-if="info.advisor.name && info.advisor.firm" class="a-sub truncate">{{ info.advisor.firm }}</p>
                <p class="a-sub truncate">{{ info.advisor.email }}</p>
              </template>
              <p v-else class="a-sub">Guarda sus datos y el correo se rellenará solo cada vez.</p>
            </div>
          </div>
          <UiButton class="a-btn" :variant="info.advisor ? 'ghost' : 'primary'" size="sm" :icon="info.advisor ? 'ph:pencil-simple' : 'ph:plus'" block @click="advisorOpen = true">
            {{ info.advisor ? 'Editar datos' : 'Añadir a mi gestor' }}
          </UiButton>
        </UiCard>

        <UiCard title="Envíos anteriores" icon="ph:clock-counter-clockwise" padding="none" class="rise history" style="--i: 3">
          <UiEmpty v-if="!info.packs.length" compact icon="ph:paper-plane-tilt" title="Aún no has enviado nada" />
          <ul v-else class="packs">
            <li v-for="p in shownPacks" :key="p.id" class="pack">
              <div class="grow min0">
                <p class="pk-t">{{ p.label }}</p>
                <p class="pk-s truncate">
                  <template v-if="p.emailStatus === 'sent'">Enviado {{ relTime(p.sentAt!) }} a {{ p.sentTo }}</template>
                  <template v-else-if="p.emailStatus === 'failed'"><span class="bad">No se pudo enviar</span></template>
                  <template v-else>Descargado {{ relTime(p.createdAt) }}</template>
                </p>
                <p class="pk-m num">{{ p.contents?.files ?? 0 }} archivos · {{ fileSize(p.size) }}<template v-if="p.downloads"> · {{ p.downloads }} descarga{{ p.downloads > 1 ? 's' : '' }} del gestor</template><template v-if="expired(p)"> · enlace caducado</template></p>
              </div>
              <a v-if="p.available" :href="`/api/advisor/packs/${p.id}/download`" class="pk-btn" :aria-label="`Descargar ${p.label}`"><Icon name="ph:download-simple" /></a>
              <button type="button" class="pk-btn" :aria-label="`Borrar ${p.label}`" @click="removePack(p)"><Icon name="ph:trash" /></button>
            </li>
          </ul>
          <UiPager v-model="packPage" :pages="packPages" />
        </UiCard>
      </aside>
    </div>

    <UiModal v-model="advisorOpen" size="md" title="Tu gestor o asesoría" subtitle="A quién se envía la documentación de cada periodo">
      <SettingsAdvisorForm @saved="onAdvisorSaved" />
    </UiModal>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--s-5);
  align-items: start;
}

.main {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  min-width: 0;
}

.min0 {
  min-width: 0;
}

.small {
  font-size: var(--text-sm);
}

.block {
  padding: var(--s-5) var(--s-6);
}

.b-head {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  margin-bottom: var(--s-4);
}

.step {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.period {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-3);
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
  min-width: 48px;
  text-align: center;
  font-weight: 650;
}

.qs {
  display: inline-flex;
  gap: 4px;
}

.q {
  min-width: 46px;
  height: 34px;
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
}

.q:hover {
  border-color: var(--border-strong);
}

.q.on {
  color: var(--on-brand);
  background: var(--brand);
  border-color: var(--brand);
}

.month {
  width: 170px;
}

.date {
  width: 170px;
}

.p-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-3);
  font-size: var(--text-sm);
  color: var(--text-3);
}

.spinner-sm {
  width: 15px;
  height: 15px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.incl {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.opt {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 12px 14px;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.opt:hover {
  border-color: var(--border-strong);
}

.opt.on {
  border-color: color-mix(in srgb, var(--brand) 40%, var(--border));
  background: color-mix(in srgb, var(--brand) 4%, var(--surface));
}

input[type='checkbox'] {
  width: 16px;
  height: 16px;
  flex: none;
  accent-color: var(--brand);
  cursor: pointer;
}

.o-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  font-size: 18px;
  border-radius: var(--r-md);
}

.o-ic.issued { color: var(--brand); background: var(--brand-soft); }
.o-ic.received { color: var(--warning); background: var(--warning-soft); }
.o-ic.summary { color: var(--success); background: var(--success-soft); }

.o-t {
  display: block;
  font-weight: 600;
}

.o-s {
  display: block;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.vault {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  margin-top: var(--s-5);
  padding-top: var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.v-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.v-folder {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
}

.v-file {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 7px 10px;
  font-size: var(--text-sm);
  cursor: pointer;
  border-radius: var(--r-md);
  transition: background var(--t-fast);
}

.v-file:hover {
  background: var(--surface-hover);
}

.v-ic {
  flex: none;
  color: var(--text-3);
}

.v-meta {
  flex: none;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.dest {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-top: var(--s-2);
}

.form-grid .c-12 {
  grid-column: span 12;
}

.msg :deep(textarea) {
  min-height: 180px;
}

.warn-mail {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-3);
  font-size: var(--text-sm);
  color: var(--warning);
}

.actionbar {
  position: sticky;
  bottom: calc(var(--s-4) + var(--bnav) + var(--safe-b));
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--s-3);
  padding: 12px 12px 12px 18px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: saturate(1.6) blur(14px);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lg);
}

.ab-t {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: var(--text-sm);
}

.aside {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  position: sticky;
  top: calc(var(--topbar-h) + var(--s-4));
}

.adv {
  display: flex;
  gap: var(--s-3);
}

.a-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  font-size: 20px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-lg);
}

.a-name {
  font-weight: 650;
  font-size: var(--text-md);
}

.a-sub {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.a-btn {
  margin-top: var(--s-4);
}

.packs {
  list-style: none;
  padding: 0;
}

.pack {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: 12px var(--s-4);
}

.pack + .pack {
  border-top: 1px solid var(--border-subtle);
}

.pk-t {
  font-weight: 600;
}

.pk-s,
.pk-m {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.bad {
  color: var(--danger);
}

.pk-btn {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  color: var(--text-3);
  border-radius: var(--r-md);
  transition: background var(--t-fast), color var(--t-fast);
}

.pk-btn:hover {
  color: var(--text);
  background: var(--surface-hover);
}

/* Una columna: arriba «Tu gestor», luego los pasos y al final los envíos anteriores */
@media (max-width: 1100px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .aside {
    display: contents;
  }

  .aside > :first-child {
    order: -1;
  }

  .history {
    order: 1;
  }
}

@media (max-width: 640px) {
  .block {
    padding: var(--s-4);
  }

  .actionbar {
    flex-direction: column;
    align-items: stretch;
  }

  .actionbar {
    gap: var(--s-2);
    padding: 10px;
  }

  .actionbar .row > * {
    flex: 1;
  }

  .month,
  .date {
    width: 100%;
  }
}
</style>
