<script setup lang="ts">
import type { DroppedFile } from '~/components/docs/Dropzone.vue'
import type { ContactImportCommitResult, ContactImportJobView, ContactImportPhase, ContactImportRole, ContactImportUndoResult } from '#shared/types/contact-import'

/**
 * Importación masiva de clientes o proveedores: se sube un Excel, CSV, PDF, Word, foto o agenda (o se
 * pegan las filas copiadas de Excel), la IA ordena cada dato y se revisa todo antes de crear nada.
 */
const props = defineProps<{ role: 'client' | 'supplier' }>()

const toast = useToast()
const { confirm } = useConfirm()
const route = useRoute()
const router = useRouter()
const isClient = computed(() => props.role === 'client')
const base = computed(() => (isClient.value ? '/clientes' : '/proveedores'))
const { href: listHref, back } = useBackTo(base)
const noun = computed(() => (isClient.value ? 'clientes' : 'proveedores'))

const { data: ai } = await useFetch<{ configured: boolean }>('/api/ai/status', { default: () => ({ configured: true }) })

type Step = 'upload' | 'reading' | 'review' | 'done'
const step = ref<Step>('upload')

// ─── 1. Subir ───

const files = ref<File[]>([])
const text = ref('')
const roleChoice = ref<ContactImportRole>(props.role)
const starting = ref(false)
const startError = ref<string | null>(null)

const roleOptions = [
  { value: 'client', label: 'Clientes' },
  { value: 'supplier', label: 'Proveedores' },
  { value: 'both', label: 'Ambos' },
]
const roleModel = computed({ get: () => roleChoice.value, set: v => (roleChoice.value = v as ContactImportRole) })

function onFiles(list: DroppedFile[]) {
  startError.value = null
  const known = new Set(files.value.map(f => `${f.name}|${f.size}`))
  files.value.push(...list.map(d => d.file).filter(f => !known.has(`${f.name}|${f.size}`)).slice(0, 20 - files.value.length))
}

const canStart = computed(() => files.value.length > 0 || text.value.trim().length >= 3)

async function start() {
  if (!canStart.value) return
  starting.value = true
  startError.value = null
  try {
    const fd = new FormData()
    fd.append('role', roleChoice.value)
    for (const f of files.value) fd.append('file', f, f.name)
    if (text.value.trim()) fd.append('text', text.value)
    const { id } = await $fetch<{ id: string }>('/api/contacts/import', { method: 'POST', body: fd })
    await router.replace({ query: { ...route.query, lectura: id } })
    follow(id)
  }
  catch (err) {
    startError.value = errorMessage(err)
  }
  finally {
    starting.value = false
  }
}

// ─── 2. Leer (la página pregunta cómo va) ───

const job = ref<ContactImportJobView | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

async function follow(id: string) {
  step.value = 'reading'
  if (timer) clearTimeout(timer)
  try {
    job.value = await $fetch<ContactImportJobView>(`/api/contacts/import/${id}`)
  }
  catch (err) {
    stopReading(errorMessage(err))
    return
  }
  if (job.value.status === 'running') timer = setTimeout(() => follow(id), 900)
  else if (job.value.status === 'done') step.value = 'review'
  else stopReading(job.value.error ?? 'No se pudo leer')
}

function stopReading(message: string) {
  step.value = 'upload'
  startError.value = message
  router.replace({ query: { ...route.query, lectura: undefined } })
}

onMounted(() => {
  const id = route.query.lectura
  if (typeof id === 'string' && id) follow(id)
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

const PHASES: Array<{ key: ContactImportPhase[], label: string }> = [
  { key: ['read'], label: 'Abriendo los archivos' },
  { key: ['columns', 'extract'], label: 'Entendiendo qué dato va en cada sitio' },
  { key: ['review'], label: 'Revisando cada contacto: NIF, autónomos, erratas' },
  { key: ['postal'], label: 'Completando códigos postales y provincias' },
  { key: ['match'], label: 'Buscando repetidos y los que ya tienes' },
]
const phaseIndex = computed(() => PHASES.findIndex(p => p.key.includes(job.value?.phase ?? 'read')))
const percent = computed(() => (job.value?.total ? Math.round(job.value.done / job.value.total * 100) : 0))

function restart() {
  step.value = 'upload'
  job.value = null
  files.value = []
  text.value = ''
  router.replace({ query: { ...route.query, lectura: undefined } })
}

// ─── 4. Hecho ───

const done = ref<ContactImportCommitResult | null>(null)
const undoing = ref(false)

function onDone(r: ContactImportCommitResult) {
  done.value = r
  step.value = 'done'
  router.replace({ query: { ...route.query, lectura: undefined } })
  clearNuxtData(k => k.startsWith('contacts-'))
}

async function undo() {
  if (!done.value) return
  const ok = await confirm({
    title: '¿Deshacer la importación?',
    body: `Se borrarán los ${done.value.created} contactos creados que aún no tengan facturas ni gastos, y las fichas completadas volverán a como estaban (salvo lo que hayas cambiado después).`,
    confirmLabel: 'Deshacer',
    danger: true,
  })
  if (!ok) return
  undoing.value = true
  try {
    const r = await $fetch<ContactImportUndoResult>('/api/contacts/import/undo', { method: 'POST', body: { importId: done.value.importId } })
    toast.success('Importación deshecha', [r.removed ? `${r.removed} borrados` : '', r.restored ? `${r.restored} fichas restauradas` : '', r.kept ? `${r.kept} se quedan porque ya tienen documentos` : ''].filter(Boolean).join(' · ') || undefined)
    clearNuxtData(k => k.startsWith('contacts-'))
    navigateTo(base.value)
  }
  catch (err) {
    toast.error('No se pudo deshacer', errorMessage(err))
  }
  finally {
    undoing.value = false
  }
}

const CHECKS = [
  { icon: 'ph:identification-card', t: 'NIF comprobado', s: 'Letra de control, ceros que quita Excel, O por 0 y NIF-IVA europeos.' },
  { icon: 'ph:user-switch', t: 'Autónomos bien puestos', s: 'Si el NIF es un DNI, el nombre fiscal es la persona y el comercial va aparte.' },
  { icon: 'ph:map-pin', t: 'Direcciones completas', s: 'Provincia por el código postal y código postal por la dirección.' },
  { icon: 'ph:copy', t: 'Sin duplicados', s: 'Une las filas repetidas y completa los que ya tienes en vez de crearlos otra vez.' },
  { icon: 'ph:envelope-simple', t: 'Emails, teléfonos e IBAN', s: 'Erratas corregidas, varios valores separados y cuentas validadas.' },
]

useHead({ title: () => `Importar ${noun.value} · NUMIQ` })
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <a :href="listHref" class="ci-back" @click="back"><Icon name="ph:arrow-left" aria-hidden="true" /> {{ isClient ? 'Clientes' : 'Proveedores' }}</a>
        <h1>Importar {{ noun }}</h1>
        <p class="sub">Sube tu listado de cualquier programa o pégalo: la IA deja cada dato en su sitio y tú revisas antes de crear nada.</p>
      </div>
    </header>

    <!-- 1. Subir -->
    <div v-if="step === 'upload'" class="ci-grid">
      <section class="card ci-main rise" style="--i: 1" aria-label="Archivos del listado">
        <DocsDropzone
          title="Arrastra aquí tu listado"
          hint="Excel, CSV, PDF, Word, una foto o la agenda del móvil (.vcf). Varios archivos a la vez."
          accept=".xlsx,.xls,.ods,.csv,.tsv,.txt,.pdf,.doc,.docx,.odt,.vcf,.png,.jpg,.jpeg,.webp"
          :disabled="starting"
          @files="onFiles"
        />

        <ul v-if="files.length" class="ci-picked">
          <li v-for="(f, i) in files" :key="`${f.name}-${i}`">
            <span class="ci-p-ic" aria-hidden="true"><Icon :name="fileIcon(f.name, f.type)" /></span>
            <span class="ci-p-name">{{ f.name }}</span>
            <span class="ci-p-size">{{ fileSize(f.size) }}</span>
            <UiButton variant="ghost" size="sm" square icon="ph:x" :aria-label="`Quitar ${f.name}`" :disabled="starting" @click="files.splice(i, 1)" />
          </li>
        </ul>

        <div class="ci-or"><span>o pega las filas</span></div>
        <UiTextarea
          v-model="text"
          rows="5"
          class="ci-paste"
          placeholder="Copia las filas en Excel (Ctrl+C) y pégalas aquí, con o sin cabecera. También vale un listado escrito a mano."
          aria-label="Listado pegado"
        />

        <div class="ci-opts">
          <div>
            <p class="label">¿Qué son?</p>
            <UiSegmented v-model="roleModel" :options="roleOptions" label="Tipo de contactos" />
          </div>
          <p class="hint">Si el archivo trae una columna que lo dice, se respeta en cada fila.</p>
        </div>

        <p v-if="!ai?.configured" class="ci-noai">
          <Icon name="ph:warning-fill" aria-hidden="true" />
          Sin IA configurada solo se leen Excel y CSV con cabecera, y sin revisión inteligente.
        </p>
        <p v-if="startError" class="ci-err" role="alert"><Icon name="ph:warning-circle-fill" aria-hidden="true" /> {{ startError }}</p>

        <div class="ci-go">
          <UiButton variant="ai" size="lg" icon="ph:sparkle-fill" :loading="starting" :disabled="!canStart" @click="start">Leer {{ noun }}</UiButton>
        </div>
      </section>

      <aside class="ci-aside">
        <UiCard title="Qué revisa en cada contacto" icon="ph:shield-check" class="rise" style="--i: 2">
          <ul class="ci-checks">
            <li v-for="c in CHECKS" :key="c.t">
              <span class="ci-c-ic" aria-hidden="true"><Icon :name="c.icon" /></span>
              <span><b>{{ c.t }}</b><span class="ci-c-s">{{ c.s }}</span></span>
            </li>
          </ul>
        </UiCard>
        <UiCard title="Así funciona" icon="ph:lightbulb-filament" class="rise" style="--i: 3">
          <ol class="ci-steps">
            <li><span class="ci-n">1</span><span><b>Sube</b> el listado tal cual sale de tu programa anterior, de la gestoría o de tu Excel.</span></li>
            <li><span class="ci-n">2</span><span><b>Revisa</b> lo marcado: cada corrección se puede deshacer y cada fila editar.</span></li>
            <li><span class="ci-n">3</span><span><b>Importa</b> todos de una vez. Si algo no te convence, lo deshaces con un clic.</span></li>
          </ol>
        </UiCard>
      </aside>
    </div>

    <!-- 2. Leyendo -->
    <section v-else-if="step === 'reading'" class="card ci-reading rise" role="status" aria-live="polite">
      <div class="ci-orb" aria-hidden="true"><Icon name="ph:sparkle-fill" /></div>
      <h2 class="ci-r-t">Leyendo tus {{ noun }}…</h2>
      <p class="ci-r-s">Puedes seguir trabajando: si sales, vuelve a esta página para ver el resultado.</p>
      <ol class="ci-phases">
        <li v-for="(p, i) in PHASES" :key="p.label" :class="{ done: i < phaseIndex, now: i === phaseIndex }">
          <span class="ci-ph-ic" aria-hidden="true">
            <Icon v-if="i < phaseIndex" name="ph:check-bold" />
            <Icon v-else-if="i === phaseIndex" name="ph:circle-notch" class="spin" />
          </span>
          <span class="grow">{{ p.label }}</span>
          <span v-if="i === phaseIndex && job && job.total > 1" class="ci-ph-n num">{{ job.done }}/{{ job.total }}</span>
        </li>
      </ol>
      <div class="ci-bar"><span :style="{ width: `${Math.max(((phaseIndex + percent / 100) / PHASES.length) * 100, 4)}%` }" /></div>
    </section>

    <!-- 3. Revisar -->
    <ContactImportReview v-else-if="step === 'review' && job?.result" :result="job.result" :role="role" @done="onDone" @restart="restart" />

    <!-- 4. Hecho -->
    <section v-else-if="step === 'done' && done" class="card ci-done rise">
      <div class="ci-done-ic" aria-hidden="true"><Icon name="ph:check-bold" /></div>
      <h2 class="ci-r-t">Importación terminada</h2>
      <ul class="ci-done-n">
        <li v-if="done.created"><b class="num">{{ done.created }}</b> {{ done.created === 1 ? 'contacto nuevo' : 'contactos nuevos' }}</li>
        <li v-if="done.filled"><b class="num">{{ done.filled }}</b> {{ done.filled === 1 ? 'ficha completada' : 'fichas completadas' }}</li>
        <li v-if="done.updated"><b class="num">{{ done.updated }}</b> {{ done.updated === 1 ? 'ficha actualizada' : 'fichas actualizadas' }}</li>
        <li v-if="done.skipped"><b class="num">{{ done.skipped }}</b> ya al día</li>
      </ul>
      <div class="ci-done-a">
        <UiButton variant="primary" icon="ph:users" :to="base">Ver {{ noun }}</UiButton>
        <UiButton icon="ph:upload-simple" @click="restart">Importar más</UiButton>
        <UiButton variant="ghost" icon="ph:arrow-counter-clockwise" :loading="undoing" @click="undo">Deshacer</UiButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ci-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-3);
}

.ci-back:hover {
  color: var(--text);
}

.ci-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--s-5);
  align-items: start;
}

.ci-main {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  padding: var(--s-5);
}

.ci-picked {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  list-style: none;
}

.ci-picked li {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 8px 8px 8px 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.ci-p-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  font-size: 17px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-md);
}

.ci-p-name {
  flex: 1;
  min-width: 0;
  font-weight: 560;
  overflow-wrap: anywhere;
}

.ci-p-size {
  font-size: var(--text-xs);
  color: var(--text-3);
  white-space: nowrap;
}

.ci-or {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.ci-or::before,
.ci-or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

.ci-paste :deep(textarea) {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-sm);
  white-space: pre;
}

.ci-opts {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--s-2) var(--s-5);
}

.ci-opts .label {
  margin-bottom: 6px;
}

.ci-opts .hint {
  max-width: 300px;
}

.ci-noai,
.ci-err {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: var(--text-sm);
  border-radius: var(--r-lg);
}

.ci-noai {
  color: var(--warning);
  background: var(--warning-soft);
}

.ci-err {
  color: var(--danger);
  background: var(--danger-soft);
}

.ci-noai :deep(svg),
.ci-err :deep(svg) {
  flex: none;
}

.ci-go {
  display: flex;
  justify-content: flex-end;
}

.ci-aside {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.ci-checks {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
}

.ci-checks li {
  display: flex;
  gap: var(--s-3);
}

.ci-c-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  font-size: 16px;
  color: var(--ai-1);
  background: var(--ai-soft);
  border-radius: var(--r-md);
}

.ci-c-s {
  display: block;
  color: var(--text-3);
}

.ci-steps {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.ci-steps li {
  display: flex;
  gap: var(--s-3);
}

.ci-n {
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

/* ─── Leyendo ─── */

.ci-reading,
.ci-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 560px;
  margin: var(--s-6) auto 0;
  padding: var(--s-8) var(--s-6);
  text-align: center;
}

.ci-orb,
.ci-done-ic {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--s-4);
  font-size: 28px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: 50%;
  box-shadow: 0 10px 30px -10px rgb(79 70 229 / 0.6);
  animation: ci-pulse 1.8s ease-in-out infinite;
}

.ci-done-ic {
  background: var(--success-solid);
  box-shadow: 0 10px 30px -10px color-mix(in srgb, var(--success-solid) 70%, transparent);
  animation: none;
}

@keyframes ci-pulse {
  50% {
    transform: scale(1.06);
    box-shadow: 0 14px 40px -10px rgb(79 70 229 / 0.75);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ci-orb {
    animation: none;
  }
}

.ci-r-t {
  font-size: var(--text-xl);
  font-weight: 680;
  letter-spacing: -0.02em;
}

.ci-r-s {
  margin-top: 4px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.ci-phases {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  margin: var(--s-6) 0 var(--s-5);
  padding: 0;
  list-style: none;
  text-align: left;
  font-size: var(--text-sm);
  color: var(--text-4);
}

.ci-phases li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ci-phases li.done {
  color: var(--text-2);
}

.ci-phases li.now {
  font-weight: 600;
  color: var(--text);
}

.ci-ph-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  font-size: 12px;
  border: 1.5px solid var(--border);
  border-radius: 50%;
}

.done .ci-ph-ic {
  color: #fff;
  background: var(--success-solid);
  border-color: var(--success-solid);
}

.now .ci-ph-ic {
  color: var(--ai-1);
  border-color: var(--ai-1);
}

.spin {
  animation: spin 0.8s linear infinite;
}

.ci-ph-n {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ci-bar {
  width: 100%;
  height: 6px;
  overflow: hidden;
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.ci-bar span {
  display: block;
  height: 100%;
  background: var(--ai-grad);
  border-radius: inherit;
  transition: width var(--t-slow) var(--ease-out);
}

.ci-done-n {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 20px;
  margin: var(--s-4) 0 var(--s-6);
  padding: 0;
  list-style: none;
  color: var(--text-2);
}

.ci-done-n b {
  font-size: var(--text-lg);
  color: var(--text);
}

.ci-done-a {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--s-2);
}

@media (max-width: 1000px) {
  .ci-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 767px) {
  .ci-main {
    padding: var(--s-4);
  }

  .ci-go :deep(.btn) {
    width: 100%;
  }

  .ci-reading,
  .ci-done {
    margin-top: var(--s-2);
    padding: var(--s-6) var(--s-4);
  }
}
</style>
