<script setup lang="ts">
/**
 * Cerrar el trimestre, paso a paso: dejar los datos al día, presentar y pagar cada modelo, y
 * mandarlo a la gestoría. Cada paso dice por qué importa y lleva su botón.
 */
interface Step { key: string, title: string, why: string, state: 'done' | 'todo' | 'warn', detail: string, action?: { label: string, to: string } }
interface Model { model: string, name: string, result: number, nothing: boolean, filing: { id: number, status: 'draft' | 'ready' | 'filed' | 'paid', csv: string | null, filedAt: string | null } | null, fileQuarter?: number }
interface Close {
  year: number
  quarter: number
  from: string
  to: string
  dueDate: string | null
  closed: boolean
  checks: Step[]
  models: Model[]
  toPayTotal: number
  advisor: { sent: boolean, sentAt: string | null, sentTo: string | null, configured: boolean, to: string }
  progress: { done: number, total: number }
}

const route = useRoute()
const router = useRouter()
const { href: taxesHref, back, label: backText } = useBackTo('/impuestos')
const toast = useToast()
const { readOnly, canUpload } = useMe()
// Presentar y marcar pagado: el gestor, si la empresa le deja llevar los impuestos
const canFile = computed(() => canUpload('taxes'))

const sel = ref<{ year?: number, quarter?: number }>({
  year: Number(route.query.anio) || undefined,
  quarter: Number(route.query.t) || undefined,
})
const { data, status, refresh, error } = useFetch<Close>('/api/taxes/close', {
  key: 'tax-close',
  query: computed(() => ({ year: sel.value.year, quarter: sel.value.quarter })),
  lazy: true,
})
useHead({ title: computed(() => (data.value ? `Cerrar ${data.value.quarter}T ${data.value.year} · NUMIQ` : 'Cerrar trimestre · NUMIQ')) })

function move(delta: -1 | 1) {
  if (!data.value) return
  let q = data.value.quarter + delta
  let y = data.value.year
  if (q < 1) {
    q = 4
    y--
  }
  if (q > 4) {
    q = 1
    y++
  }
  sel.value = { year: y, quarter: q }
  router.replace({ query: { anio: y, t: q } })
}
const isFuture = computed(() => !!data.value && data.value.from > todayISO())

const pct = computed(() => (data.value ? Math.round((data.value.progress.done / Math.max(1, data.value.progress.total)) * 100) : 0))
const complete = computed(() => !!data.value && data.value.progress.done >= data.value.progress.total)
const dueText = computed(() => {
  if (!data.value?.dueDate) return ''
  const d = daysUntil(data.value.dueDate)
  return d < 0 ? `El plazo terminó el ${fdate(data.value.dueDate)}` : d === 0 ? 'Hoy es el último día para presentar' : `Plazo hasta el ${fdate(data.value.dueDate)} · quedan ${d} ${d === 1 ? 'día' : 'días'}`
})

// ─── Modelos ───
const fileOpen = ref(false)
const fileModel = ref<string | null>(null)
const fileQuarter = ref<number | null>(null)
function present(m: Model) {
  fileModel.value = m.model
  fileQuarter.value = m.fileQuarter ?? data.value?.quarter ?? null
  fileOpen.value = true
}

const busy = ref<string | null>(null)
async function setPaid(m: Model, paid: boolean) {
  if (!m.filing) return
  busy.value = m.model
  try {
    await $fetch(`/api/taxes/filings/${m.filing.id}` as string, { method: 'PATCH', body: { status: paid ? 'paid' : 'filed' } })
    await refresh()
    if (paid) toast.success(`${m.name} pagado`, complete.value ? '¡Trimestre cerrado!' : undefined)
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

const modelState = (m: Model) => {
  if (m.nothing) return { label: 'Nada que declarar', tone: 'neutral' as const, icon: 'ph:minus-circle' }
  if (m.filing?.status === 'paid') return { label: 'Pagado', tone: 'success' as const, icon: 'ph:seal-check-fill' }
  if (m.filing?.status === 'filed') return m.result > 0 ? { label: 'Presentado · falta pagar', tone: 'warning' as const, icon: 'ph:hand-coins' } : { label: 'Presentado', tone: 'success' as const, icon: 'ph:seal-check-fill' }
  return { label: 'Por presentar', tone: 'brand' as const, icon: 'ph:circle-dashed' }
}
const outcome = (m: Model) => (m.result > 0 ? 'a ingresar' : m.result < 0 ? (m.model === '303' ? 'a compensar o devolver' : 'a devolver') : 'resultado cero')
</script>

<template>
  <div class="page page-narrow">
    <a :href="taxesHref" class="back" @click="back"><Icon name="ph:arrow-left" aria-hidden="true" /> {{ backText }}</a>

    <header class="page-head">
      <div>
        <p class="eyebrow">Paso a paso</p>
        <h1>Cerrar el trimestre</h1>
        <p class="sub">Deja los datos al día, presenta cada modelo y avisa a tu gestoría. Sin olvidarte de nada.</p>
      </div>
      <div v-if="data" class="q-nav" role="group" aria-label="Trimestre">
        <UiButton variant="ghost" size="sm" square icon="ph:caret-left" aria-label="Trimestre anterior" @click="move(-1)" />
        <span class="q-l num" aria-live="polite">{{ data.quarter }}T {{ data.year }}</span>
        <UiButton variant="ghost" size="sm" square icon="ph:caret-right" aria-label="Trimestre siguiente" :disabled="isFuture" @click="move(1)" />
      </div>
    </header>

    <UiCard v-if="error && !data">
      <UiEmpty icon="ph:cloud-warning" title="No hemos podido preparar el cierre" :text="errorMessage(error)">
        <UiButton icon="ph:arrow-clockwise" @click="refresh()">Reintentar</UiButton>
      </UiEmpty>
    </UiCard>

    <div v-else-if="status === 'pending' && !data" class="stack gap-4" aria-busy="true">
      <div class="card sk" style="height: 110px" />
      <div class="card sk" style="height: 300px" />
    </div>

    <template v-else-if="data">
      <!-- Progreso -->
      <section class="card progress rise" :class="{ complete }">
        <div class="pr-ring" :style="{ '--p': pct }" aria-hidden="true">
          <Icon v-if="complete" name="ph:confetti-fill" class="pr-done" />
          <span v-else class="num">{{ pct }}%</span>
        </div>
        <div class="grow min0">
          <p class="pr-t">{{ complete ? `${data.quarter}T ${data.year} cerrado` : `${data.progress.done} de ${data.progress.total} pasos hechos` }}</p>
          <p class="pr-s">{{ complete ? 'Todo presentado, pagado y enviado. Hasta el próximo trimestre.' : dueText }}</p>
        </div>
        <div v-if="data.toPayTotal > 0" class="pr-pay">
          <span class="pr-pay-l">A pagar</span>
          <strong class="num">{{ eur(data.toPayTotal) }}</strong>
        </div>
      </section>

      <p v-if="!data.closed" class="note"><Icon name="ph:info" aria-hidden="true" /> El trimestre aún no ha terminado: las cifras pueden cambiar hasta el {{ fdate(data.to) }}.</p>

      <!-- 1 · Datos al día -->
      <section class="block rise" style="--i: 1">
        <h2 class="block-t"><span class="num-badge">1</span> Deja los datos al día</h2>
        <ul class="card steps">
          <li v-for="s in data.checks" :key="s.key" class="step" :class="s.state">
            <span class="st-ic" aria-hidden="true">
              <Icon :name="s.state === 'done' ? 'ph:check-circle-fill' : s.state === 'warn' ? 'ph:warning-circle-fill' : 'ph:circle-dashed'" />
            </span>
            <div class="grow min0">
              <p class="st-t">{{ s.title }}</p>
              <p class="st-d">{{ s.detail }}</p>
              <p v-if="s.state !== 'done'" class="st-why">{{ s.why }}</p>
            </div>
            <UiButton v-if="s.action" size="sm" icon-right="ph:arrow-right" compact :to="s.action.to">{{ s.action.label }}</UiButton>
          </li>
        </ul>
      </section>

      <!-- 2 · Modelos -->
      <section class="block rise" style="--i: 2">
        <h2 class="block-t"><span class="num-badge">2</span> Presenta y paga los modelos</h2>
        <ul class="card steps">
          <li v-for="m in data.models" :key="m.model" class="step model" :class="{ muted: m.nothing }">
            <span class="model-chip num" :title="MODEL_NAMES[m.model]">{{ m.model }}</span>
            <div class="grow min0">
              <p class="st-t">{{ m.name }}</p>
              <p class="st-d">
                <UiBadge :tone="modelState(m).tone" size="sm" :icon="modelState(m).icon">{{ modelState(m).label }}</UiBadge>
                <span v-if="!m.nothing" class="st-amt num">{{ eur(Math.abs(m.result)) }} {{ outcome(m) }}</span>
                <span v-if="m.filing?.csv" class="st-csv mono">CSV {{ m.filing.csv }}</span>
              </p>
            </div>
            <!-- El gestor sin permiso para los impuestos ve las casillas, pero no registra presentaciones ni pagos -->
            <div v-if="!canFile && !m.nothing" class="st-acts">
              <UiButton size="sm" variant="ghost" icon="ph:list-numbers" @click="present(m)">Ver casillas</UiButton>
            </div>
            <div v-else-if="!m.nothing" class="st-acts">
              <UiButton v-if="!m.filing || m.filing.status === 'draft' || m.filing.status === 'ready'" size="sm" variant="primary" icon="ph:paper-plane-tilt" @click="present(m)">Presentar</UiButton>
              <UiButton v-else-if="m.filing.status === 'filed' && m.result > 0" size="sm" variant="secondary" icon="ph:hand-coins" :loading="busy === m.model" @click="setPaid(m, true)">Marcar pagado</UiButton>
              <UiButton v-else-if="m.filing.status === 'paid'" size="sm" variant="ghost" :loading="busy === m.model" @click="setPaid(m, false)">Deshacer pago</UiButton>
            </div>
          </li>
        </ul>
        <p v-if="canFile" class="hint">«Presentar» te da las casillas ya calculadas y te lleva al formulario oficial de la AEAT. Al terminar, sube el justificante y queda guardado.</p>
      </section>

      <!-- 3 · Gestoría -->
      <section class="block rise" style="--i: 3">
        <h2 class="block-t"><span class="num-badge">3</span> Avisa a tu gestoría</h2>
        <div class="card step advisor" :class="{ done: data.advisor.sent }">
          <span class="st-ic" aria-hidden="true">
            <Icon :name="data.advisor.sent ? 'ph:check-circle-fill' : 'ph:paper-plane-tilt'" />
          </span>
          <div class="grow min0">
            <p class="st-t">{{ data.advisor.sent ? 'Documentación enviada' : 'Envía la documentación del trimestre' }}</p>
            <p class="st-d">
              <template v-if="data.advisor.sent">El {{ fdate(data.advisor.sentAt!) }}{{ data.advisor.sentTo ? ` a ${data.advisor.sentTo}` : '' }}</template>
              <template v-else>Facturas, gastos con sus justificantes y libros registro, en un ZIP y con el correo preparado.</template>
            </p>
            <p v-if="!data.advisor.sent && !data.advisor.configured" class="st-why">Si presentas tú los impuestos, este paso es opcional.</p>
          </div>
          <UiButton v-if="!data.advisor.sent && !readOnly" size="sm" :variant="data.advisor.configured ? 'primary' : 'secondary'" icon-right="ph:arrow-right" compact :to="data.advisor.to">Preparar envío</UiButton>
        </div>
      </section>

      <TaxesFileModal v-model="fileOpen" :model="fileModel" :year="data.year" :quarter="fileQuarter" @filed="refresh()" />
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--s-4);
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-3);
}

.back:hover {
  color: var(--text);
}

.q-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}

.q-l {
  min-width: 80px;
  font-weight: 650;
  text-align: center;
}

.progress {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  padding: var(--s-5);
}

.progress.complete {
  background: linear-gradient(135deg, color-mix(in srgb, var(--success-soft) 80%, var(--surface)), var(--surface));
  border-color: color-mix(in srgb, var(--success) 25%, var(--border));
}

/* Anillo de progreso */
.pr-ring {
  --p: 0;
  display: grid;
  place-items: center;
  flex: none;
  width: 64px;
  height: 64px;
  font-size: var(--text-sm);
  font-weight: 700;
  background:
    radial-gradient(closest-side, var(--surface) 76%, transparent 78%),
    conic-gradient(var(--brand) calc(var(--p) * 1%), var(--surface-sunken) 0);
  border-radius: 50%;
}

.complete .pr-ring {
  background:
    radial-gradient(closest-side, var(--surface) 76%, transparent 78%),
    conic-gradient(var(--success-solid) 100%, var(--surface-sunken) 0);
}

.pr-done {
  width: 28px;
  height: 28px;
  color: var(--success);
}

.pr-t {
  font-size: var(--text-lg);
  font-weight: 680;
}

.pr-s {
  margin-top: 2px;
  color: var(--text-3);
}

.pr-pay {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
}

.pr-pay-l {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.pr-pay strong {
  font-size: var(--text-xl);
  letter-spacing: -0.02em;
}

.note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--s-3);
  font-size: var(--text-sm);
  color: var(--text-3);
}

.block {
  margin-top: var(--s-6);
}

.block-t {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--s-3);
  font-size: var(--text-md);
  font-weight: 650;
}

.num-badge {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 50%;
}

.steps {
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
}

.step {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px var(--s-5);
}

.steps .step + .step {
  border-top: 1px solid var(--border-subtle);
}

.st-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  font-size: 22px;
  color: var(--text-4);
}

.done .st-ic {
  color: var(--success);
}

.warn .st-ic {
  color: var(--warning);
}

.todo .st-ic {
  color: var(--brand);
}

.st-t {
  font-weight: 600;
}

.done .st-t {
  color: var(--text-2);
}

.st-d {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.st-why {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-4);
}

.st-amt {
  font-weight: 600;
  color: var(--text-2);
}

.st-csv {
  font-size: var(--text-xs);
}

.st-acts {
  flex: none;
}

.model-chip {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 32px;
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-md);
}

.model.muted .model-chip {
  color: var(--text-4);
  background: var(--surface-sunken);
}

.model.muted .st-t {
  color: var(--text-3);
}

.advisor {
  border-radius: var(--r-xl);
}

.hint {
  margin-top: var(--s-2);
  font-size: var(--text-xs);
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
  .page-head {
    flex-wrap: wrap;
  }

  .progress {
    flex-wrap: wrap;
    padding: var(--s-4);
  }

  .pr-pay {
    flex-direction: row;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding-left: calc(64px + var(--s-4));
  }

  .step {
    align-items: flex-start;
    padding: 14px var(--s-4);
  }

  /* Los modelos llevan su botón debajo, a todo el ancho; las comprobaciones, la flecha a la derecha */
  .step.model {
    flex-wrap: wrap;
  }

  .step.model .grow {
    flex-basis: calc(100% - 60px);
  }

  .st-acts {
    width: 100%;
    padding-left: 58px;
  }

  .st-acts :deep(.btn) {
    width: 100%;
  }
}
</style>
