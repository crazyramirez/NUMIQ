<script setup lang="ts">
import type { CtxItem, CtxSpec } from '~/composables/useContextMenu'

useHead({ title: 'Impuestos · NUMIQ' })
const { verifactu, readOnly, canUpload } = useMe()
// Registrar presentaciones: el gestor, si la empresa le deja llevar los impuestos (Ajustes → Equipo)
const canFile = computed(() => canUpload('taxes'))

const currentYear = new Date().getFullYear()
// Año en la URL (?anio=2025): al volver desde un modelo o un enlace se sigue en el mismo ejercicio. Sin él,
// el último año elegido en Facturas, Gastos, Contactos o Informes; y el que se elige aquí, se recuerda allí
const year = useQueryState('anio', currentYear, { parse: r => (Number.isInteger(Number(r)) && Number(r) >= 2000 && Number(r) <= currentYear ? Number(r) : undefined), remember: false })
const periodMemory = usePeriodMemory()
if (!hasPeriodQuery(useRoute().query) && periodMemory.value?.year) year.value = Math.min(periodMemory.value.year, currentYear)
watch(year, (y) => {
  const p = periodMemory.value
  // Mismo trimestre o mes, otro año; con «Todos los años» recordado, el año entero
  periodMemory.value = p?.year ? { ...p, year: y } : { year: y, quarter: null, month: null }
})
const { data, status, error, refresh } = await useFetch('/api/taxes', { query: { year }, lazy: true })

const open = ref(new Set<string>())
const toggle = (key: string) => {
  const s = new Set(open.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  open.value = s
}

type Quarter = NonNullable<typeof data.value>['quarters'][number]

function filingOf(q: Quarter, model: string) {
  return data.value?.filings.find(f => f.model === model && f.period === `${q.quarter}T` && (f.status === 'filed' || f.status === 'paid')) ?? null
}

function quarterState(q: Quarter) {
  const models = modelRows(q)
  const filed = models.length > 0 && models.every(r => filingOf(q, r.model) || (r.m.result === 0 && r.model !== '303' && r.model !== '130'))
  if (filed) return { label: 'Presentado', tone: 'success' as const, icon: 'ph:seal-check-fill' }
  if (!q.started) return { label: 'Próximo', tone: 'neutral' as const, icon: 'ph:hourglass' }
  if (!q.closed) return { label: 'En curso', tone: 'brand' as const, icon: 'ph:circle-dashed' }
  if (q.dueDate && daysUntil(q.dueDate) >= 0) return { label: 'Por presentar', tone: 'warning' as const, icon: 'ph:clock-countdown' }
  return { label: 'Plazo cerrado', tone: 'neutral' as const, icon: 'ph:check' }
}

const MODEL_EXPLAIN: Record<string, string> = {
  '303': 'El IVA que has cobrado en tus facturas (repercutido) menos el IVA de tus gastos que puedes deducir (soportado).',
  '130': 'Un adelanto del IRPF: el 20 % de tu beneficio acumulado en el año, menos las retenciones que te han hecho tus clientes y lo ya pagado en trimestres anteriores.',
  '111': 'Las retenciones de IRPF que tú aplicas a profesionales (gestoría, abogados…) o trabajadores, y que ingresas a Hacienda en su nombre.',
  '115': 'La retención del 19 % que aplicas al alquiler de tu local u oficina y que ingresas en nombre del propietario.',
}

// Primero en lenguaje de todos los días; el número de modelo va al lado como etiqueta
const MODEL_SHORT: Record<string, string> = { '303': 'IVA del trimestre', '130': 'Pago a cuenta del IRPF', '111': 'Retenciones a profesionales', '115': 'Retención del alquiler', '202': 'Pago a cuenta de Sociedades' }

type ModelData = { result: number, accrued?: number, deductible?: number, income?: number, expenses?: number, netIncome?: number, withheld?: number, base?: number, recipients?: number }

function modelRows(q: Quarter) {
  if (!q.models) return []
  return Object.entries(q.models as unknown as Record<string, ModelData>).map(([model, m]) => ({ model, m }))
}

function interpret(model: string, result: number, q: Quarter) {
  if (model === '303') {
    if (result > 0) return { text: 'A ingresar', cls: 'pay' }
    if (result < 0) return { text: q.quarter === 4 ? 'A devolver o compensar' : 'A compensar', cls: 'back' }
    return { text: 'Sin cuota', cls: 'zero' }
  }
  if (result > 0) return { text: 'A ingresar', cls: 'pay' }
  if (model === '111' || model === '115') return { text: 'Sin retenciones', cls: 'zero' }
  return { text: 'Sin cuota', cls: 'zero' }
}

function details(model: string, m: ModelData) {
  switch (model) {
    case '303':
      return [
        { label: 'IVA repercutido en tus facturas', value: m.accrued ?? 0 },
        { label: 'IVA deducible de tus gastos', value: -(m.deductible ?? 0) },
      ]
    case '130':
      return [
        { label: 'Ingresos acumulados del año', value: m.income ?? 0 },
        { label: 'Gastos deducibles acumulados', value: -(m.expenses ?? 0) },
        { label: 'Rendimiento neto', value: m.netIncome ?? 0, strong: true },
        { label: 'Retenciones que te han practicado', value: -(m.withheld ?? 0) },
      ]
    default:
      return [
        { label: 'Base sujeta a retención', value: m.base ?? 0 },
        { label: 'Perceptores', value: m.recipients ?? 0, count: true },
      ]
  }
}

const quarterTotal = (q: Quarter) => modelRows(q).reduce((s, r) => s + Math.max(0, r.m.result), 0)

// ─── Presentación guiada ───
const { confirm } = useConfirm()
const toast = useToast()
const viewer = useFileViewer()
const viewReceipt = (id: number) => viewer.open(storedFile({ id }))
const fileOpen = ref(false)
const fileModel = ref<string | null>(null)
const fileQuarter = ref<number | null>(null)
function present(quarter: number, model: string) {
  fileModel.value = model
  fileQuarter.value = quarter
  fileOpen.value = true
}
const ANNUAL = [
  { model: '390', label: 'Resumen anual de IVA', hint: 'Del 1 al 30 de enero' },
  { model: '190', label: 'Retenciones de profesionales', hint: 'Del 1 al 31 de enero' },
  { model: '180', label: 'Retenciones de alquileres', hint: 'Del 1 al 31 de enero' },
  { model: '347', label: 'Operaciones con terceros', hint: 'Durante febrero' },
]
const annualFiling = (model: string) => data.value?.filings.find(f => f.model === model && f.period === '0A' && (f.status === 'filed' || f.status === 'paid')) ?? null
function presentAnnual(model: string) {
  fileModel.value = model
  fileQuarter.value = null
  fileOpen.value = true
}

async function unfile(id: number, model: string) {
  const ok = await confirm({ title: `¿Deshacer la presentación del ${model}?`, body: 'Solo se borra la marca en NUMIQ; el justificante sigue en el archivo. No afecta a lo presentado en la AEAT.', confirmLabel: 'Deshacer' })
  if (!ok) return
  await $fetch(`/api/taxes/filings/${id}`, { method: 'DELETE' }).catch(err => toast.error('No se pudo deshacer', errorMessage(err)))
  await refresh()
}

// ─── Clic derecho en un modelo: presentar, justificante, desglose, copiar el importe ───

function filingItems(model: string, filing: { id: number, receiptFileId?: number | null, csv?: string | null } | null, presentFn: () => void): CtxItem[] {
  // El gestor sin permiso para los impuestos consulta las casillas, pero no registra ni deshace presentaciones
  if (!filing) return [canFile.value ? { label: 'Presentar en la AEAT…', icon: 'ph:seal-check', onClick: presentFn } : { label: 'Ver casillas', icon: 'ph:list-numbers', onClick: presentFn }]
  return [
    ...(filing.receiptFileId ? [{ label: 'Ver justificante', icon: 'ph:file-pdf', onClick: () => viewReceipt(filing.receiptFileId!) }] : []),
    ...(filing.csv ? [{ label: 'Copiar CSV', sub: filing.csv, icon: 'ph:copy', onClick: () => copyText(filing.csv, 'CSV') }] : []),
    ...(canFile.value ? [{ label: 'Deshacer presentación', icon: 'ph:arrow-counter-clockwise', onClick: () => unfile(filing.id, model) }] : []),
  ]
}

function modelCtx(q: Quarter, r: { model: string, m: ModelData }): CtxSpec {
  const key = `${q.quarter}-${r.model}`
  const filing = filingOf(q, r.model)
  return {
    title: `Modelo ${r.model} · ${q.quarter}T ${data.value?.year ?? ''}`,
    subtitle: `${eur(Math.abs(r.m.result))} ${interpret(r.model, r.m.result, q).text.toLowerCase()} · ${MODEL_SHORT[r.model] ?? MODEL_NAMES[r.model]}`,
    icon: filing ? 'ph:seal-check-fill' : 'ph:bank',
    items: [
      ...filingItems(r.model, filing, () => present(q.quarter, r.model)),
      { divider: true },
      { label: open.value.has(key) ? 'Ocultar desglose' : 'Ver desglose', icon: open.value.has(key) ? 'ph:caret-up' : 'ph:caret-down', onClick: () => toggle(key) },
      { label: 'Copiar resultado', sub: eur(r.m.result), icon: 'ph:currency-eur', onClick: () => copyText(plainAmount(r.m.result), 'Importe') },
      ...(q.dueDate ? [{ label: 'Ver plazo en el calendario', icon: 'ph:calendar-blank', to: `/calendario?fecha=${q.dueDate}` }] : []),
    ],
  }
}

function annualCtx(a: typeof ANNUAL[number]): CtxSpec {
  return {
    title: `Modelo ${a.model} · ${data.value?.year ?? ''}`,
    subtitle: a.label,
    icon: 'ph:calendar-check',
    items: filingItems(a.model, annualFiling(a.model), () => presentAnnual(a.model)),
  }
}

// ─── Impuesto sobre Sociedades (solo sociedades): pagos fraccionados 202 y declaración 200 ───
const corp = computed(() => data.value?.corporate ?? null)
const corpOpen = ref(false)
type CorpPayment = NonNullable<typeof corp.value>['payments'][number]
const SIZE_LABEL: Record<string, string> = { micro: 'Microempresa', erd: 'Reducida dimensión', general: 'Tipo general' }
const MONTH_TO: Record<number, string> = { 1: 'marzo', 2: 'septiembre', 3: 'noviembre' }

const corpRates = computed(() => {
  const c = corp.value
  if (!c) return ''
  if (c.settings.patrimonial) return 'Entidad patrimonial · 25 %'
  if (c.settings.newEntity) return 'Nueva creación · 15 %'
  const b = c.brackets
  return `${SIZE_LABEL[c.size]} · ${b.length > 1 ? `${b[0]!.rate} % hasta 50.000 € y ${b[1]!.rate} % el resto` : `${b[0]!.rate} %`}`
})
const needsQuota = computed(() => corp.value?.method === 'cuota' && corp.value.settings.lastQuota == null)

const corpFiling = (model: '200' | '202', period: string) =>
  data.value?.filings.find(f => f.model === model && f.period === period && (f.status === 'filed' || f.status === 'paid')) ?? null

function paymentDetails(p: CorpPayment) {
  if (p.method === 'cuota') {
    return [
      { label: 'Cuota de tu último Impuesto sobre Sociedades', value: p.lastQuota ?? 0 },
      { label: '18 % de esa cuota', value: p.estimated, strong: true },
    ]
  }
  return [
    { label: `Resultado de enero a ${MONTH_TO[p.n]}`, value: p.result ?? 0 },
    ...(p.compensation ? [{ label: 'Bases negativas compensadas', value: -p.compensation }] : []),
    { label: 'Base del pago fraccionado', value: p.base ?? 0, strong: true },
    ...p.lines.map(l => ({ label: l.upTo ? `${l.rate} % de los primeros 50.000 €` : p.lines.length > 1 ? `${l.rate} % del resto` : `${l.rate} % de la base`, value: l.amount })),
    ...(p.withheld ? [{ label: 'Retenciones que te han practicado', value: -p.withheld }] : []),
    ...(p.previousPaid ? [{ label: 'Pagos fraccionados anteriores', value: -p.previousPaid }] : []),
  ]
}

const annualDetails = computed(() => {
  const c = corp.value
  if (!c) return []
  return [
    { label: 'Ingresos del año', value: c.income },
    { label: 'Gastos deducibles', value: -c.expenses },
    { label: 'Resultado antes de impuestos', value: c.result, strong: true },
    ...(c.compensation ? [{ label: 'Bases negativas compensadas', value: -c.compensation }] : []),
    { label: 'Base imponible', value: c.base },
    ...c.lines.map(l => ({ label: l.upTo ? `Cuota al ${l.rate} % (primeros 50.000 €)` : c.lines.length > 1 ? `Cuota al ${l.rate} % (resto)` : `Cuota al ${l.rate} %`, value: l.amount })),
    { label: 'Cuota íntegra', value: c.quota, strong: true },
    ...(c.withheld ? [{ label: 'Retenciones que te han practicado', value: -c.withheld }] : []),
    ...(c.paid ? [{ label: 'Pagos fraccionados del año', value: -c.paid }] : []),
  ]
})

function presentCorp(model: '200' | '202', n: number | null) {
  fileModel.value = model
  fileQuarter.value = n
  fileOpen.value = true
}

const summary = computed(() => {
  const a = data.value?.annual
  if (!a) return []
  return [
    { label: 'Ingresos', value: a.income, icon: 'ph:arrow-circle-up-right' },
    { label: 'Gastos deducibles', value: a.deductibleExpenses, icon: 'ph:arrow-circle-down-left' },
    { label: 'Beneficio', value: a.profit, icon: 'ph:chart-line-up' },
    { label: 'IVA repercutido', value: a.vatCharged, icon: 'ph:receipt' },
    { label: 'IVA deducible', value: a.vatDeductible, icon: 'ph:wallet' },
    ...(corp.value ? [{ label: 'Sociedades estimado', value: corp.value.quota, icon: 'ph:buildings' }] : []),
  ]
})

const dayOf = (iso: string) => new Date(`${iso}T12:00:00`).getDate()
const monthOf = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')
const quarterMonths = ['ene – mar', 'abr – jun', 'jul – sep', 'oct – dic']
</script>

<template>
  <div class="page">
    <header class="page-head rise">
      <div>
        <h1>Impuestos</h1>
        <p class="sub">Tus modelos trimestrales calculados con lo que registras. Sin sorpresas al llegar el plazo.</p>
      </div>
      <div class="page-actions">
        <UiButton :variant="canFile ? 'primary' : 'secondary'" icon="ph:flag-checkered" to="/impuestos/cerrar">{{ canFile ? 'Cerrar trimestre' : 'Estado del trimestre' }}</UiButton>
        <div class="year" role="group" aria-label="Año fiscal">
          <UiButton variant="ghost" size="sm" square icon="ph:caret-left" aria-label="Año anterior" @click="year--" />
          <span class="year-l num" aria-live="polite">{{ year }}</span>
          <UiButton variant="ghost" size="sm" square icon="ph:caret-right" aria-label="Año siguiente" :disabled="year >= currentYear" @click="year++" />
        </div>
      </div>
    </header>

    <UiCard v-if="error && !data">
      <UiEmpty icon="ph:cloud-warning" title="No hemos podido calcular tus impuestos" :text="errorMessage(error)">
        <UiButton icon="ph:arrow-clockwise" @click="refresh()">Reintentar</UiButton>
      </UiEmpty>
    </UiCard>

    <template v-else-if="!data">
      <div class="summary card">
        <div v-for="i in 5" :key="i" class="sum-item">
          <div class="skeleton" style="width: 60%; height: 12px" />
          <div class="skeleton" style="width: 80%; height: 22px; margin-top: 10px" />
        </div>
      </div>
      <div class="quarters">
        <div v-for="i in 4" :key="i" class="card skeleton-card" />
      </div>
    </template>

    <div v-else class="content" :class="{ refreshing: status === 'pending' }">
      <!-- Resumen anual -->
      <section class="summary card rise" :class="{ six: summary.length > 5 }" :style="{ '--i': 1, '--cols': summary.length }" :aria-label="`Resumen del año ${data.year}`">
        <div v-for="s in summary" :key="s.label" class="sum-item">
          <p class="sum-label"><Icon :name="s.icon" aria-hidden="true" /> {{ s.label }}</p>
          <p class="sum-value" :class="{ neg: s.value < 0 }">{{ eur(s.value) }}</p>
        </div>
      </section>

      <div class="grid">
        <!-- Trimestres -->
        <section class="quarters" aria-label="Modelos por trimestre">
          <article v-for="(q, qi) in data.quarters" :key="q.quarter" class="card quarter rise" :class="{ future: !q.started, current: q.started && !q.closed }" :style="{ '--i': qi + 2 }">
            <header class="q-head">
              <div>
                <h2 class="q-title">{{ q.quarter }}.º trimestre</h2>
                <p class="q-range">{{ quarterMonths[q.quarter - 1] }} {{ data.year }}</p>
              </div>
              <UiBadge :tone="quarterState(q).tone" :icon="quarterState(q).icon">{{ quarterState(q).label }}</UiBadge>
            </header>

            <p v-if="q.dueDate" class="q-due">
              <Icon name="ph:calendar-blank" aria-hidden="true" />
              Plazo hasta el {{ fdate(q.dueDate) }}
              <span v-if="daysUntil(q.dueDate) >= 0" class="muted">· {{ relDays(q.dueDate) }}</span>
            </p>

            <div v-if="!q.started" class="q-future">
              <Icon name="ph:hourglass-simple" aria-hidden="true" />
              <p>Este trimestre aún no ha empezado.</p>
            </div>

            <template v-else>
              <ul class="models">
                <li v-for="r in modelRows(q)" :key="r.model" v-ctx="() => modelCtx(q, r)" class="model-row">
                  <button
                    type="button"
                    class="model-btn"
                    :aria-expanded="open.has(`${q.quarter}-${r.model}`)"
                    :aria-controls="`d-${q.quarter}-${r.model}`"
                    @click="toggle(`${q.quarter}-${r.model}`)"
                  >
                    <span class="model-chip num" :title="MODEL_NAMES[r.model]">{{ r.model }}</span>
                    <span class="grow model-name">
                      {{ MODEL_SHORT[r.model] ?? MODEL_NAMES[r.model] }}
                      <span class="interp" :class="interpret(r.model, r.m.result, q).cls">{{ interpret(r.model, r.m.result, q).text }}</span>
                    </span>
                    <Icon v-if="filingOf(q, r.model)" name="ph:seal-check-fill" class="filed-ic" aria-label="Presentado" />
                    <span class="model-amount num">{{ eur(Math.abs(r.m.result)) }}</span>
                    <Icon name="ph:caret-down" class="caret" aria-hidden="true" />
                  </button>
                  <div v-if="open.has(`${q.quarter}-${r.model}`)" :id="`d-${q.quarter}-${r.model}`" class="detail">
                    <p class="explain">{{ MODEL_EXPLAIN[r.model] }}</p>
                    <dl>
                      <div v-for="d in details(r.model, r.m)" :key="d.label" class="d-row" :class="{ strong: 'strong' in d && d.strong }">
                        <dt>{{ d.label }}</dt>
                        <dd class="num">{{ 'count' in d && d.count ? d.value : eur(d.value) }}</dd>
                      </div>
                      <div class="d-row total">
                        <dt>Resultado</dt>
                        <dd class="num">{{ eur(r.m.result) }}</dd>
                      </div>
                    </dl>
                    <div class="d-act">
                      <template v-if="filingOf(q, r.model)">
                        <p class="filed"><Icon name="ph:seal-check-fill" aria-hidden="true" /> Presentado{{ filingOf(q, r.model)!.csv ? ` · CSV ${filingOf(q, r.model)!.csv}` : '' }}</p>
                        <button v-if="filingOf(q, r.model)!.receiptFileId" type="button" class="link small" @click="viewReceipt(filingOf(q, r.model)!.receiptFileId!)">Justificante</button>
                        <button v-if="canFile" type="button" class="link small" @click="unfile(filingOf(q, r.model)!.id, r.model)">Deshacer</button>
                      </template>
                      <UiButton v-else size="sm" :variant="q.closed ? 'primary' : 'secondary'" icon="ph:seal-check" @click="present(q.quarter, r.model)">{{ canFile ? 'Presentar en la AEAT' : 'Ver casillas' }}</UiButton>
                    </div>
                  </div>
                </li>
              </ul>
              <footer class="q-foot">
                <span class="muted">Total a ingresar</span>
                <strong class="num">{{ eur(quarterTotal(q)) }}</strong>
              </footer>
            </template>
          </article>

          <!-- Impuesto sobre Sociedades: pagos fraccionados (202) y declaración anual (200) -->
          <article v-if="corp" class="card quarter corp rise" style="--i: 6">
            <header class="q-head">
              <div>
                <h2 class="q-title">Impuesto sobre Sociedades {{ corp.year }}</h2>
                <p class="q-range">{{ corpRates }}</p>
              </div>
              <UiButton v-if="!readOnly" size="sm" variant="ghost" icon="ph:sliders-horizontal" @click="corpOpen = true">Ajustes</UiButton>
            </header>

            <div v-if="needsQuota" class="corp-alert">
              <Icon name="ph:info-fill" aria-hidden="true" />
              <p class="grow">Para calcular los pagos fraccionados indica la cuota de tu último Impuesto sobre Sociedades.</p>
              <UiButton v-if="!readOnly" size="sm" variant="secondary" @click="corpOpen = true">Indicarla</UiButton>
            </div>

            <ul class="models">
              <li v-for="p in corp.payments" :key="p.period" class="model-row">
                <button
                  type="button"
                  class="model-btn"
                  :aria-expanded="open.has(`202-${p.n}`)"
                  :aria-controls="`d-202-${p.n}`"
                  @click="toggle(`202-${p.n}`)"
                >
                  <span class="model-chip num" :title="MODEL_NAMES['202']">202</span>
                  <span class="grow model-name">
                    Pago fraccionado {{ p.n }}P
                    <span class="interp" :class="p.amount > 0 ? 'pay' : 'zero'">{{ p.amount > 0 ? 'A ingresar' : 'Sin pago' }}<span v-if="p.dueDate && !corpFiling('202', p.period)" class="corp-due"> · {{ daysUntil(p.dueDate) < 0 ? 'plazo cerrado el' : 'hasta el' }} {{ fdate(p.dueDate) }}</span></span>
                  </span>
                  <Icon v-if="corpFiling('202', p.period)" name="ph:seal-check-fill" class="filed-ic" aria-label="Presentado" />
                  <span class="model-amount num">{{ eur(p.amount) }}</span>
                  <Icon name="ph:caret-down" class="caret" aria-hidden="true" />
                </button>
                <div v-if="open.has(`202-${p.n}`)" :id="`d-202-${p.n}`" class="detail">
                  <p class="explain">
                    Un adelanto del impuesto del año{{ p.method === 'cuota' ? ', calculado sobre la cuota de tu último Impuesto sobre Sociedades.' : `, calculado sobre lo que has ganado de enero a ${MONTH_TO[p.n]}.` }}
                  </p>
                  <dl>
                    <div v-for="d in paymentDetails(p)" :key="d.label" class="d-row" :class="{ strong: 'strong' in d && d.strong }">
                      <dt>{{ d.label }}</dt>
                      <dd class="num">{{ eur(d.value) }}</dd>
                    </div>
                    <div class="d-row total">
                      <dt>A ingresar</dt>
                      <dd class="num">{{ eur(p.amount) }}</dd>
                    </div>
                  </dl>
                  <div class="d-act">
                    <template v-if="corpFiling('202', p.period)">
                      <p class="filed"><Icon name="ph:seal-check-fill" aria-hidden="true" /> Presentado{{ corpFiling('202', p.period)!.csv ? ` · CSV ${corpFiling('202', p.period)!.csv}` : '' }}</p>
                      <button v-if="corpFiling('202', p.period)!.receiptFileId" type="button" class="link small" @click="viewReceipt(corpFiling('202', p.period)!.receiptFileId!)">Justificante</button>
                      <button v-if="canFile" type="button" class="link small" @click="unfile(corpFiling('202', p.period)!.id, '202')">Deshacer</button>
                    </template>
                    <UiButton v-else size="sm" :variant="p.started ? 'primary' : 'secondary'" icon="ph:seal-check" @click="presentCorp('202', p.n)">{{ canFile ? 'Presentar en la AEAT' : 'Ver casillas' }}</UiButton>
                  </div>
                </div>
              </li>

              <li class="model-row">
                <button type="button" class="model-btn" :aria-expanded="open.has('200')" aria-controls="d-200" @click="toggle('200')">
                  <span class="model-chip num" :title="MODEL_NAMES['200']">200</span>
                  <span class="grow model-name">
                    Declaración anual
                    <span class="interp" :class="corp.due > 0.005 ? 'pay' : corp.due < -0.005 ? 'back' : 'zero'">{{ corp.due > 0.005 ? 'A ingresar' : corp.due < -0.005 ? 'A devolver' : 'Sin cuota' }}<span v-if="corp.dueDate && !corpFiling('200', '0A')" class="corp-due"> · {{ daysUntil(corp.dueDate) < 0 ? 'plazo cerrado el' : 'hasta el' }} {{ fdate(corp.dueDate) }}</span></span>
                  </span>
                  <Icon v-if="corpFiling('200', '0A')" name="ph:seal-check-fill" class="filed-ic" aria-label="Presentado" />
                  <span class="model-amount num">{{ eur(Math.abs(corp.due)) }}</span>
                  <Icon name="ph:caret-down" class="caret" aria-hidden="true" />
                </button>
                <div v-if="open.has('200')" id="d-200" class="detail">
                  <p class="explain">
                    El impuesto del año sobre tu beneficio, menos retenciones y los pagos fraccionados ya hechos.{{ corp.partial ? ' El año no ha terminado: es una estimación con lo registrado hasta hoy.' : '' }}
                  </p>
                  <dl>
                    <div v-for="d in annualDetails" :key="d.label" class="d-row" :class="{ strong: 'strong' in d && d.strong }">
                      <dt>{{ d.label }}</dt>
                      <dd class="num">{{ eur(d.value) }}</dd>
                    </div>
                    <div class="d-row total">
                      <dt>{{ corp.due < 0 ? 'A devolver' : 'A ingresar' }}</dt>
                      <dd class="num">{{ eur(Math.abs(corp.due)) }}</dd>
                    </div>
                  </dl>
                  <div class="d-act">
                    <template v-if="corpFiling('200', '0A')">
                      <p class="filed"><Icon name="ph:seal-check-fill" aria-hidden="true" /> Presentado{{ corpFiling('200', '0A')!.csv ? ` · CSV ${corpFiling('200', '0A')!.csv}` : '' }}</p>
                      <button v-if="canFile" type="button" class="link small" @click="unfile(corpFiling('200', '0A')!.id, '200')">Deshacer</button>
                    </template>
                    <UiButton v-else size="sm" :variant="corp.partial ? 'secondary' : 'primary'" icon="ph:seal-check" @click="presentCorp('200', null)">{{ corp.partial ? 'Ver borrador' : canFile ? 'Presentar en la AEAT' : 'Ver casillas' }}</UiButton>
                  </div>
                </div>
              </li>
            </ul>
            <footer class="q-foot">
              <span class="muted">Cuota estimada del año{{ corp.effectiveRate ? ` · tipo efectivo ${num(corp.effectiveRate)} %` : '' }}</span>
              <strong class="num">{{ eur(corp.quota) }}</strong>
            </footer>
          </article>
        </section>

        <!-- Lateral: calendario y presentación -->
        <aside class="side">
          <UiCard class="rise cal" style="--i: 6" icon="ph:calendar-dots" title="Calendario fiscal" subtitle="Próximos plazos de la AEAT">
            <ol class="timeline">
              <li v-for="d in data.upcoming" :key="`${d.end}-${d.title}`" class="t-item" :class="{ soon: daysUntil(d.end) < 15 }">
                <div class="t-date" aria-hidden="true">
                  <span class="t-d num">{{ dayOf(d.end) }}</span>
                  <span class="t-m">{{ monthOf(d.end) }}</span>
                </div>
                <div class="grow">
                  <p class="t-title">{{ d.title }}</p>
                  <p class="t-sub">{{ d.period }} · <span class="sr-only">vence el {{ fdate(d.end) }}, </span>{{ relDays(d.end) }}</p>
                  <ul class="t-models">
                    <li v-for="m in d.models" :key="m" :title="MODEL_NAMES[m]"><span class="model-chip num">{{ m }}</span><span class="t-mname">{{ MODEL_NAMES[m] }}</span></li>
                  </ul>
                </div>
              </li>
            </ol>
          </UiCard>

          <UiCard class="rise annual-card" style="--i: 7" icon="ph:calendar-check" :title="`Resúmenes anuales ${data.year}`" subtitle="Se presentan a principios del año siguiente">
            <ul class="annual">
              <li v-for="a in ANNUAL" :key="a.model" v-ctx="() => annualCtx(a)" class="an-row">
                <span class="model-chip num">{{ a.model }}</span>
                <span class="grow min0">
                  <span class="an-t">{{ a.label }}</span>
                  <span class="an-s">{{ annualFiling(a.model) ? `Presentado${annualFiling(a.model)!.csv ? ` · CSV ${annualFiling(a.model)!.csv}` : ''}` : a.hint }}</span>
                </span>
                <UiButton v-if="annualFiling(a.model) && canFile" size="sm" variant="ghost" icon="ph:arrow-counter-clockwise" :aria-label="`Deshacer ${a.model}`" @click="unfile(annualFiling(a.model)!.id, a.model)" />
                <UiButton v-else-if="!annualFiling(a.model)" size="sm" variant="secondary" @click="presentAnnual(a.model)">{{ canFile ? 'Preparar' : 'Ver' }}</UiButton>
              </li>
            </ul>
          </UiCard>

          <div v-if="canFile" class="callout rise" style="--i: 8">
            <div class="callout-ic" aria-hidden="true"><Icon name="ph:seal-check-fill" /></div>
            <div>
              <p class="callout-title">Presentación guiada a la AEAT</p>
              <p class="callout-body">
                Abre un modelo y pulsa «Presentar en la AEAT»: NUMIQ calcula las casillas, te lleva al formulario oficial
                (Cl@ve, DNIe o certificado) y guarda el justificante con su CSV.
                <NuxtLink v-if="verifactu" to="/ajustes?s=verifactu" class="link">Envío de registros VeriFactu</NuxtLink>
              </p>
            </div>
          </div>

          <TaxesFileModal v-model="fileOpen" :model="fileModel" :year="year" :quarter="fileQuarter" @filed="refresh()" />
          <TaxesCorporateModal v-if="corp" v-model="corpOpen" :settings="corp.settings" :auto-size="corp.autoSize" :prev-turnover="corp.prevTurnover" :year="corp.year" @saved="refresh()" />

          <p class="disclaimer">
            <Icon name="ph:info" aria-hidden="true" />
            Estimaciones con criterio de devengo a partir de tus facturas y gastos. Revisa los importes antes de presentar.
          </p>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.annual {
  display: flex;
  flex-direction: column;
  padding: 0;
  list-style: none;
}

.an-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 9px 0;
}

.an-row + .an-row {
  border-top: 1px solid var(--border-subtle);
}

.an-t {
  display: block;
  font-size: var(--text-sm);
  font-weight: 580;
}

.an-s {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.min0 {
  min-width: 0;
}

.filed-ic {
  flex: none;
  color: var(--success);
}

.d-act {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-3);
  margin-top: var(--s-3);
}

.d-act .filed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--success);
}

.d-act .small {
  font-size: var(--text-sm);
}

.year {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xs);
}

.year-l {
  min-width: 52px;
  text-align: center;
  font-weight: 650;
  font-size: var(--text-md);
}

.content {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
  transition: opacity var(--t-base);
}

.content.refreshing {
  opacity: 0.6;
}

/* ─── Resumen anual ─── */

.summary {
  display: grid;
  grid-template-columns: repeat(var(--cols, 5), minmax(0, 1fr));
  padding: var(--s-5) 0;
  margin-bottom: var(--s-5);
}

.content .summary {
  margin-bottom: 0;
}

.sum-item {
  padding: 0 var(--s-5);
  min-width: 0;
}

.sum-item + .sum-item {
  border-left: 1px solid var(--border-subtle);
}

.sum-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.sum-label :deep(svg) {
  width: 15px;
  height: 15px;
}

.sum-value {
  margin-top: 6px;
  font-size: var(--text-xl);
  font-weight: 660;
  letter-spacing: -0.02em;
}

.sum-value.neg {
  color: var(--danger);
}

/* ─── Rejilla ─── */

/* Por el ancho real del contenido (la barra lateral resta 248 px). Con sitio, el calendario va a la
   derecha y lo demás del lateral (resúmenes anuales, aviso) baja bajo los trimestres: sin huecos */
.page {
  container: tax / inline-size;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s-5);
  align-items: start;
}

@container tax (min-width: 1000px) {
  .grid {
    grid-template-columns: minmax(0, 1fr) 340px;
  }

  .grid > .side {
    display: contents;
  }

  .quarters,
  .side > * {
    grid-column: 1;
  }

  .side > .cal {
    position: sticky;
    top: calc(var(--topbar-h) + var(--s-4));
    grid-column: 2;
    grid-row: 1 / span 4;
  }
}

/* Resumen del año: todo en una fila mientras quepa; con 6 cifras en una tableta, 3 + 3 */
@container tax (max-width: 999px) {
  .sum-item {
    padding: 0 var(--s-4);
  }

  .sum-value {
    font-size: var(--text-lg);
  }
}

@container tax (600px <= width < 860px) {
  .summary.six {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    row-gap: var(--s-4);
  }

  .summary.six .sum-item:nth-child(4) {
    border-left: 0;
  }
}

.annual-card {
  container: annual / inline-size;
}

/* Calendario a todo el ancho (tableta): los plazos en columnas, sin la línea que los une */
.cal {
  container: cal / inline-size;
}

@container cal (min-width: 640px) {
  .timeline {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: var(--s-2) var(--s-5);
  }

  .t-item:not(:last-child)::before {
    display: none;
  }
}

@container annual (min-width: 600px) {
  .annual {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--s-6);
  }

  .an-row:nth-child(2) {
    border-top: 0;
  }
}

.quarters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-4);
}

/* ─── Impuesto sobre Sociedades ─── */

.corp {
  grid-column: 1 / -1;
}

.corp-alert {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  margin-bottom: var(--s-3);
  padding: var(--s-3) var(--s-4);
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--brand-soft);
  border-radius: var(--r-lg);
}

.corp-alert > :deep(svg) {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--brand-text);
}

.corp-due {
  font-weight: 450;
  color: var(--text-3);
}

.skeleton-card {
  height: 300px;
  background: linear-gradient(90deg, var(--surface) 0, var(--surface-hover) 40%, var(--surface) 80%);
  background-size: 800px 100%;
  animation: shimmer 1.3s linear infinite;
}

.quarter {
  display: flex;
  flex-direction: column;
  padding: var(--s-5);
}

.quarter.current {
  border-color: color-mix(in srgb, var(--brand) 40%, var(--border));
  box-shadow: var(--shadow-sm), 0 0 0 3px var(--brand-soft);
}

.quarter.future {
  background: var(--surface-2);
}

.q-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-3);
}

.q-title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.q-range {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.q-due {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-3);
  font-size: var(--text-sm);
  color: var(--text-2);
}

.q-due :deep(svg) {
  width: 15px;
  height: 15px;
  color: var(--text-3);
}

.q-future {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: auto 0;
  padding: var(--s-7) 0;
  color: var(--text-3);
  font-size: var(--text-sm);
}

.q-future :deep(svg) {
  width: 26px;
  height: 26px;
  color: var(--text-4);
}

.models {
  list-style: none;
  padding: 0;
  margin-top: var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.model-row {
  border-bottom: 1px solid var(--border-subtle);
}

.model-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 8px 4px;
  text-align: left;
  border-radius: var(--r-sm);
  transition: background var(--t-fast);
}

.model-btn:hover {
  background: var(--surface-hover);
}

.model-chip {
  display: inline-grid;
  place-items: center;
  min-width: 36px;
  height: 22px;
  padding: 0 6px;
  font-size: var(--text-2xs);
  font-weight: 650;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-xs);
  flex-shrink: 0;
}

.model-name {
  display: flex;
  flex-direction: column;
  font-weight: 560;
  line-height: 1.3;
}

.interp {
  font-size: var(--text-xs);
  font-weight: 550;
  color: var(--text-3);
}

.interp.pay { color: var(--warning); }
.interp.back { color: var(--success); }

.model-amount {
  font-weight: 650;
}

.caret {
  width: 14px;
  height: 14px;
  color: var(--text-3);
  transition: transform var(--t-base) var(--ease-out);
}

[aria-expanded='true'] .caret {
  transform: rotate(180deg);
}

.detail {
  padding: 4px 4px 14px 50px;
  animation: rise 260ms var(--ease-out) both;
}

.explain {
  font-size: var(--text-sm);
  color: var(--text-3);
  line-height: 1.55;
  margin-bottom: 10px;
}

.d-row {
  display: flex;
  justify-content: space-between;
  gap: var(--s-3);
  padding: 4px 0;
  font-size: var(--text-sm);
}

.d-row dt {
  color: var(--text-2);
}

.d-row.strong dt,
.d-row.strong dd {
  font-weight: 600;
}

.d-row.total {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  font-weight: 650;
}

.q-foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: auto;
  padding-top: var(--s-4);
  font-size: var(--text-sm);
}

.q-foot strong {
  font-size: var(--text-lg);
  font-weight: 680;
}

/* ─── Lateral ─── */

.side {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.timeline {
  list-style: none;
  padding: 0;
}

.t-item {
  position: relative;
  display: flex;
  gap: var(--s-3);
  padding-bottom: var(--s-4);
}

.t-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 20px;
  top: 46px;
  bottom: 4px;
  width: 1px;
  background: var(--border);
}

.t-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 41px;
  height: 44px;
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  line-height: 1;
}

.soon .t-date {
  border-color: color-mix(in srgb, var(--warning-solid) 45%, transparent);
  background: var(--warning-soft);
}

.t-d {
  font-size: var(--text-lg);
  font-weight: 700;
}

.t-m {
  margin-top: 2px;
  font-size: var(--text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-3);
}

.t-title {
  font-weight: 600;
  font-size: var(--text-sm);
}

.t-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.soon .t-sub {
  color: var(--warning);
  font-weight: 550;
}

.t-models {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  list-style: none;
  padding: 0;
}

.t-models li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* Nombre del modelo entero: baja de línea antes que cortarse */
.t-mname {
  min-width: 0;
  font-size: var(--text-xs);
  line-height: 1.35;
  color: var(--text-2);
}

.callout {
  display: flex;
  gap: var(--s-3);
  padding: var(--s-4);
  background: var(--ai-soft);
  border: 1px solid rgb(124 58 237 / 0.18);
  border-radius: var(--r-xl);
}

.callout-ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  font-size: 17px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-md);
}

.callout-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-weight: 620;
}

.callout-body {
  margin-top: 4px;
  font-size: var(--text-sm);
  color: var(--text-2);
  line-height: 1.55;
}

.disclaimer {
  display: flex;
  gap: 8px;
  font-size: var(--text-xs);
  color: var(--text-3);
  line-height: 1.5;
}

.disclaimer :deep(svg) {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 2px;
}

/* ─── Responsive ─── */

@media (max-width: 767px) {
  .quarters {
    grid-template-columns: minmax(0, 1fr);
  }

  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sum-item:nth-child(n) {
    border-left: 0;
    padding: 0 var(--s-4);
  }

  .sum-item:nth-child(even) {
    border-left: 1px solid var(--border-subtle);
  }

  /* La cifra que queda sola en la última fila ocupa las dos columnas */
  .sum-item:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }

  .summary {
    row-gap: var(--s-4);
  }

  .detail {
    padding-left: 4px;
  }
}
</style>
