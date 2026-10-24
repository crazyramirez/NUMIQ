<script setup lang="ts">
useHead({ title: 'Inicio · NUMIQ' })

const { me, companyName } = useMe()
const readOnly = computed(() => me.value?.company?.role === 'advisor')
// Lo que ya es una tarea de «Hoy» no se repite como recomendación del asesor
const TASK_INSIGHTS = /^(overdue|drafts|bank:)/
// «Aparta X para impuestos» ya lo cuenta «Tu dinero libre» cuando hay banco
const insights = computed(() => (data.value?.insights ?? []).filter(i => !TASK_INSIGHTS.test(i.key) && !(data.value?.money && i.key.startsWith('reserve:'))))
const { data, status, error, refresh } = await useFetch('/api/dashboard', { lazy: true })

const showAllInsights = ref(false)

// Todo con impuestos. Beneficio y margen (sobre bases) viven en Informes
const sum12 = computed(() => {
  const m = data.value?.monthly ?? []
  const income = m.reduce((s, x) => s + x.incomeTotal, 0)
  const expenses = m.reduce((s, x) => s + x.expensesTotal, 0)
  return { income, expenses, avg: m.length ? income / m.length : 0 }
})
const chart = computed(() => (data.value?.monthly ?? []).map(m => ({ month: m.month, income: m.incomeTotal, expenses: m.expensesTotal })))

const firstName = computed(() => me.value?.user.name.split(' ')[0] ?? '')
const greeting = computed(() => {
  const h = new Date().getHours()
  return h >= 6 && h < 13 ? 'Buenos días' : h >= 13 && h < 21 ? 'Buenas tardes' : 'Buenas noches'
})

const quarterLabel = computed(() => (data.value ? `${data.value.period.quarter}T ${data.value.period.year}` : ''))
const quarterRangeLabel = computed(() => {
  if (!data.value) return ''
  const f = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')
  return `${f(data.value.period.from)} – ${f(data.value.period.to)}`
})

const kpis = computed(() => {
  const k = data.value?.kpis
  if (!k) return []
  return [
    { key: 'income', label: 'Facturado este trimestre', icon: 'ph:arrow-circle-up-right', value: k.income.value, delta: delta(k.income.value, k.income.previous), invert: false, note: 'Importe total' },
    { key: 'expenses', label: 'Gastos este trimestre', icon: 'ph:arrow-circle-down-left', value: k.expenses.value, delta: delta(k.expenses.value, k.expenses.previous), invert: true, note: 'Importe total' },
  ]
})

const vatResult = computed(() => data.value?.kpis.vat303.result ?? 0)
const irpf = computed(() => data.value?.kpis.irpf130)
const reserve = computed(() => Math.max(0, vatResult.value) + (irpf.value?.applicable ? irpf.value.result : 0))

const total12 = computed(() => data.value?.monthly.reduce((s, m) => s + m.incomeTotal, 0) ?? 0)
const topMax = computed(() => data.value?.topClients[0]?.amount || 1)

const severity = {
  critical: { icon: 'ph:warning-octagon-fill', tone: 'danger' },
  warning: { icon: 'ph:warning-fill', tone: 'warning' },
  info: { icon: 'ph:lightbulb-fill', tone: 'brand' },
  success: { icon: 'ph:check-circle-fill', tone: 'success' },
} as const

const deadlineDay = (iso: string) => new Date(`${iso}T12:00:00`).getDate()
const deadlineMonth = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')
</script>

<template>
  <div class="page dash">
    <!-- Cabecera -->
    <header class="page-head rise">
      <div>
        <p class="eyebrow">{{ companyName }}<template v-if="quarterLabel"> · {{ quarterLabel }}</template></p>
        <h1>{{ greeting }}<template v-if="firstName">, {{ firstName }}</template></h1>
        <p class="sub">
          Así va tu negocio este trimestre<template v-if="quarterRangeLabel"> ({{ quarterRangeLabel }})</template>.
        </p>
      </div>
      <div class="page-actions">
        <UiButton icon="ph:wallet" to="/gastos?nuevo=1">Añadir gasto</UiButton>
        <UiButton variant="primary" icon="ph:plus-bold" to="/facturas/nueva">Nueva factura</UiButton>
      </div>
    </header>

    <!-- Error -->
    <UiCard v-if="error && !data" class="rise">
      <UiEmpty icon="ph:cloud-warning" title="No hemos podido cargar tu resumen" :text="errorMessage(error)">
        <UiButton icon="ph:arrow-clockwise" @click="refresh()">Reintentar</UiButton>
      </UiEmpty>
    </UiCard>

    <!-- Esqueleto -->
    <div v-else-if="status === 'pending' && !data" class="layout" aria-busy="true" aria-label="Cargando resumen">
      <div class="kpis">
        <div v-for="i in 4" :key="i" class="card kpi">
          <div class="skeleton" style="width: 55%; height: 12px" />
          <div class="skeleton" style="width: 70%; height: 30px; margin-top: 16px" />
          <div class="skeleton" style="width: 40%; height: 12px; margin-top: 14px" />
        </div>
      </div>
      <div class="row-main">
        <div class="card sk-block" style="height: 380px" />
        <div class="card sk-block" style="height: 380px" />
      </div>
      <div class="row-3">
        <div v-for="i in 3" :key="i" class="card sk-block" style="height: 260px" />
      </div>
    </div>

    <div v-else-if="data" class="layout">
      <!-- Hoy: lo que hay que hacer, con su botón -->
      <DashboardToday class="rise" :tasks="data.tasks" :read-only="readOnly" @done="refresh()" />

      <!-- Tu dinero libre: banco − Hacienda − pagos pendientes -->
      <DashboardMoney v-if="data.money" class="rise" style="--i: 1" :money="data.money" />

      <!-- KPIs -->
      <section class="kpis" aria-label="Indicadores del trimestre">
        <article v-for="(k, i) in kpis" :key="k.key" class="card kpi rise" :style="{ '--i': i + 1 }">
          <div class="kpi-top">
            <span class="kpi-label">{{ k.label }}</span>
            <span class="kpi-ic" :class="k.key" aria-hidden="true"><Icon :name="k.icon" /></span>
          </div>
          <p class="kpi-value" :class="{ neg: k.value < 0 }">{{ eur(k.value) }}</p>
          <div class="kpi-foot">
            <UiDelta :value="k.delta" :invert="k.invert" />
            <span class="muted">{{ k.delta != null ? 'vs. mismo tramo del trimestre anterior' : k.note }}</span>
          </div>
        </article>

        <NuxtLink to="/facturas?estado=open" class="card kpi kpi-link rise" :style="{ '--i': 3 }">
          <div class="kpi-top">
            <span class="kpi-label">Pendiente de cobro</span>
            <span class="kpi-ic receivable" aria-hidden="true"><Icon name="ph:hourglass-medium" /></span>
          </div>
          <p class="kpi-value">{{ eur(data.kpis.receivables.amount) }}</p>
          <div class="kpi-foot">
            <template v-if="data.kpis.receivables.overdueCount">
              <UiBadge tone="danger" dot>{{ data.kpis.receivables.overdueCount }} vencida{{ data.kpis.receivables.overdueCount === 1 ? '' : 's' }}</UiBadge>
              <span class="muted num">{{ eur(data.kpis.receivables.overdueAmount) }} fuera de plazo</span>
            </template>
            <span v-else class="muted">
              {{ data.kpis.receivables.count ? `${data.kpis.receivables.count} factura${data.kpis.receivables.count === 1 ? '' : 's'} al día` : 'Todo cobrado' }}
            </span>
          </div>
        </NuxtLink>

        <NuxtLink to="/gastos?estado=pending&periodo=all" class="card kpi kpi-link rise" :style="{ '--i': 4 }">
          <div class="kpi-top">
            <span class="kpi-label">Pendiente de pago</span>
            <span class="kpi-ic payable" aria-hidden="true"><Icon name="ph:clock-countdown" /></span>
          </div>
          <p class="kpi-value">{{ eur(data.kpis.payables.amount) }}</p>
          <div class="kpi-foot">
            <span class="muted">
              {{ data.kpis.payables.count ? `${data.kpis.payables.count} gasto${data.kpis.payables.count === 1 ? '' : 's'} sin pagar` : 'Todo pagado' }}
            </span>
          </div>
        </NuxtLink>
      </section>

      <!-- Gráfico + Asesor IA -->
      <div class="row-main">
        <UiCard class="rise chart-card" style="--i: 5" title="Ingresos y gastos" subtitle="Últimos 12 meses · importe total">
          <template #actions>
            <UiButton size="sm" variant="ghost" icon-right="ph:arrow-right" to="/informes">Informes</UiButton>
          </template>
          <ChartsIncomeChart :data="chart" :profit="false" />
          <dl class="chart-sum">
            <div><dt><i class="cs-dot inc" />Ingresos</dt><dd class="num">{{ eur(sum12.income, false) }}</dd></div>
            <div><dt><i class="cs-dot exp" />Gastos</dt><dd class="num">{{ eur(sum12.expenses, false) }}</dd></div>
            <div><dt>Media/mes</dt><dd class="num">{{ eur(sum12.avg, false) }}</dd></div>
          </dl>
        </UiCard>

        <UiCard ai class="rise advisor" style="--i: 6">
          <template #head>
            <div class="adv-head">
              <span class="adv-ic" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
              <div class="adv-titles">
                <h2 class="section-title adv-title"><span class="ai-text">Asesor NUMIQ</span></h2>
                <p class="adv-sub">Recomendaciones a partir de tus datos</p>
              </div>
              <UiButton class="adv-analyze" size="sm" variant="ai" icon="ph:magic-wand" :to="`/asistente?q=${encodeURIComponent('Analiza cómo va mi negocio este trimestre y dame 3 recomendaciones concretas para mejorar')}`">Analizar</UiButton>
            </div>
          </template>
          <ul v-if="insights.length" class="insights">
            <li v-for="(ins, i) in insights.slice(0, showAllInsights ? 8 : 3)" :key="ins.key" class="insight" :class="ins.severity" :style="{ '--i': i }">
              <span class="ins-ic" :class="`t-${severity[ins.severity].tone}`" aria-hidden="true">
                <Icon :name="ins.icon || severity[ins.severity].icon" />
              </span>
              <div class="grow">
                <p class="ins-title">{{ ins.title }}</p>
                <p class="ins-body">{{ ins.body }}</p>
                <NuxtLink v-if="ins.actionUrl" :to="ins.actionUrl" class="link ins-action">
                  {{ ins.actionLabel ?? 'Ver' }} <Icon name="ph:arrow-right" aria-hidden="true" />
                </NuxtLink>
              </div>
            </li>
          </ul>
          <button v-if="insights.length > 3" type="button" class="more-ins" @click="showAllInsights = !showAllInsights">
            {{ showAllInsights ? 'Ver menos' : `Ver ${insights.length - 3} recomendación${insights.length - 3 === 1 ? '' : 'es'} más` }}
            <Icon :name="showAllInsights ? 'ph:caret-up' : 'ph:caret-down'" aria-hidden="true" />
          </button>
          <div v-else-if="!insights.length" class="adv-empty">
            <span class="ok-ic" aria-hidden="true"><Icon name="ph:seal-check-fill" /></span>
            <div>
              <p class="ins-title">Todo en orden</p>
              <p class="ins-body">No hay nada urgente: sin facturas vencidas ni sorpresas fiscales a la vista.</p>
            </div>
          </div>
          <template #footer>
            <NuxtLink to="/asistente" class="adv-ask">
              <Icon name="ph:chat-circle-dots" aria-hidden="true" />
              <span class="grow">Pregunta lo que quieras sobre tu negocio</span>
              <Icon name="ph:arrow-right" aria-hidden="true" />
            </NuxtLink>
          </template>
        </UiCard>
      </div>

      <!-- Impuestos · Plazos · Clientes -->
      <div class="row-3">
        <UiCard class="rise" style="--i: 7" icon="ph:bank" :title="`Impuestos del ${quarterLabel}`" subtitle="Estimación con lo registrado hasta hoy">
          <div class="reserve">
            <p class="eyebrow">Aparta para Hacienda</p>
            <p class="reserve-value">{{ eur(reserve) }}</p>
          </div>
          <dl class="tax-list">
            <div class="tax-row">
              <dt>
                <span class="model">303</span>
                <span>IVA</span>
              </dt>
              <dd class="num">
                {{ eur(Math.abs(vatResult)) }}
                <span class="tax-tag" :class="vatResult >= 0 ? 'pay' : 'back'">{{ vatResult > 0 ? 'a ingresar' : vatResult < 0 ? 'a compensar' : 'sin cuota' }}</span>
              </dd>
            </div>
            <div v-if="irpf?.applicable" class="tax-row">
              <dt>
                <span class="model">130</span>
                <span>IRPF</span>
              </dt>
              <dd class="num">
                {{ eur(irpf.result) }}
                <span class="tax-tag" :class="irpf.result > 0 ? 'pay' : 'back'">{{ irpf.result > 0 ? 'a ingresar' : 'sin cuota' }}</span>
              </dd>
            </div>
          </dl>
          <template #footer>
            <NuxtLink to="/impuestos" class="link foot-link">Ver detalle de modelos <Icon name="ph:arrow-right" aria-hidden="true" /></NuxtLink>
          </template>
        </UiCard>

        <UiCard class="rise" style="--i: 8" icon="ph:calendar-dots" title="Próximos plazos" subtitle="Calendario de la AEAT">
          <ul class="deadlines">
            <li v-for="d in data.deadlines" :key="`${d.end}-${d.title}`" class="deadline" :class="{ soon: daysUntil(d.end) < 15 }">
              <div class="date-chip" aria-hidden="true">
                <span class="dd num">{{ deadlineDay(d.end) }}</span>
                <span class="mm">{{ deadlineMonth(d.end) }}</span>
              </div>
              <!-- El plazo va en la fila de modelos: el título usa todo el ancho y no se parte -->
              <div class="grow">
                <p class="dl-title">{{ d.title }} <span class="muted">· {{ d.period }}</span></p>
                <div class="models">
                  <span v-for="m in d.models" :key="m" class="model" :title="MODEL_NAMES[m]">{{ m }}</span>
                  <UiBadge class="dl-when" :tone="daysUntil(d.end) < 15 ? 'warning' : 'neutral'" size="sm">{{ relDays(d.end) }}</UiBadge>
                </div>
              </div>
            </li>
          </ul>
        </UiCard>

        <UiCard class="rise" style="--i: 9" icon="ph:crown-simple" title="Mejores clientes" subtitle="Últimos 12 meses · importe total">
          <ul v-if="data.topClients.length" class="clients">
            <li v-for="c in data.topClients" :key="c.id ?? c.name">
              <NuxtLink :to="c.id ? `/clientes/${c.id}` : '/clientes'" class="client">
                <UiAvatar :name="c.name" :size="32" :src="c.logoUrl" contain />
                <div class="grow">
                  <div class="client-line">
                    <span class="client-name">{{ c.name }}</span>
                    <span class="num client-amount">{{ eur(c.amount, false) }}</span>
                  </div>
                  <div class="share-track" :title="`${pct(total12 ? (c.amount / total12) * 100 : 0)} de tu facturación`">
                    <span class="share-fill" :style="{ width: `${Math.max(3, (c.amount / topMax) * 100)}%` }" />
                  </div>
                </div>
                <span class="share num">{{ pct(total12 ? (c.amount / total12) * 100 : 0) }}</span>
              </NuxtLink>
            </li>
          </ul>
          <UiEmpty v-else compact icon="ph:users" title="Aún sin facturación" text="Tus clientes con más volumen aparecerán aquí.">
            <UiButton size="sm" variant="soft" icon="ph:user-plus" to="/clientes?nuevo=1">Añadir cliente</UiButton>
          </UiEmpty>
        </UiCard>
      </div>

      <!-- Categorías · Actividad -->
      <div class="row-2">
        <UiCard class="rise" style="--i: 10" icon="ph:chart-bar-horizontal" title="Gastos por categoría" :subtitle="`${quarterLabel} · importe total`">
          <ChartsCategoryBars :rows="data.expensesByCategory" />
        </UiCard>

        <UiCard class="rise" style="--i: 11" icon="ph:clock-counter-clockwise" title="Actividad reciente" padding="none">
          <template #actions>
            <UiButton size="sm" variant="ghost" icon-right="ph:arrow-right" to="/facturas">Todas</UiButton>
          </template>
          <ul v-if="data.recent.length" class="recent desk">
            <li v-for="r in data.recent" :key="r.id">
              <NuxtLink :to="`/facturas/${r.id}`" class="recent-row">
                <span class="doc-ic" aria-hidden="true"><Icon :name="r.status === 'draft' ? 'ph:file-dashed' : 'ph:receipt'" /></span>
                <div class="grow">
                  <p class="recent-name">{{ r.contactName ?? 'Sin cliente' }}</p>
                  <p class="recent-sub">
                    <span class="mono">{{ r.number ?? 'Borrador' }}</span> · {{ fdate(r.issueDate) }}
                  </p>
                </div>
                <div class="recent-right">
                  <span class="num recent-amount">{{ eur(r.total) }}</span>
                  <UiBadge :tone="salesStatus(r.kind, r.status, r.overdue).tone" size="sm" dot>{{ salesStatus(r.kind, r.status, r.overdue).label }}</UiBadge>
                </div>
              </NuxtLink>
            </li>
          </ul>
          <!-- Móvil: nombre y concepto enteros; debajo, nº, fecha, estado e importe -->
          <ul v-if="data.recent.length" class="recent mob">
            <li v-for="r in data.recent" :key="r.id">
              <UiListRow :to="`/facturas/${r.id}`">
                <template #lead>
                  <span class="doc-ic" aria-hidden="true"><Icon :name="r.status === 'draft' ? 'ph:file-dashed' : 'ph:receipt'" /></span>
                </template>
                <template #title>{{ r.contactName ?? 'Sin cliente' }}</template>
                <template v-if="r.conceptPreview" #sub>{{ r.conceptPreview }}</template>
                <template #info>
                  <template v-if="r.number"><span class="mono">{{ r.number }}</span> · </template>{{ fdate(r.issueDate) }}
                </template>
                <template #status>
                  <UiBadge :tone="salesStatus(r.kind, r.status, r.overdue).tone" size="sm" dot>{{ salesStatus(r.kind, r.status, r.overdue).label }}</UiBadge>
                </template>
                <template #amount>{{ eur(r.total) }}</template>
              </UiListRow>
            </li>
          </ul>
          <UiEmpty v-else compact icon="ph:receipt" title="Tu primera factura te espera" text="Crea una factura en menos de un minuto: cliente, concepto y listo.">
            <UiButton size="sm" variant="primary" icon="ph:plus-bold" to="/facturas/nueva">Nueva factura</UiButton>
          </UiEmpty>
        </UiCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Las rejillas miran el ancho real del contenido, no el de la ventana: con la barra
   lateral abierta, una tableta en horizontal deja ~870 px y no 1180 */
.layout {
  container: dash / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

/* ─── KPIs ─── */

.kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-4);
}

@container dash (min-width: 1000px) {
  .kpis {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.kpi {
  display: flex;
  flex-direction: column;
  padding: var(--s-5);
  min-height: 148px;
}

.kpi-link {
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast) var(--ease-out);
}

.kpi-link:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

.kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
}

.kpi-label {
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-3);
}

.kpi-ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  font-size: 17px;
  border-radius: var(--r-md);
  color: var(--brand-text);
  background: var(--brand-soft);
}

.kpi-ic.expenses {
  color: var(--warning);
  background: var(--warning-soft);
}

.kpi-ic.payable {
  color: var(--text-2);
  background: var(--surface-2);
}

.kpi-ic.receivable {
  color: var(--info);
  background: var(--info-soft);
}

.kpi-value {
  margin-top: var(--s-3);
  font-size: var(--text-3xl);
  font-weight: 680;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: var(--text);
}

.kpi-value.neg {
  color: var(--danger);
}

.kpi-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-top: auto;
  padding-top: var(--s-3);
  font-size: var(--text-xs);
}

/* ─── Filas ─── */

/* Gráfico y asesor lado a lado solo si el asesor tiene sitio (≥ 340 px); si no, uno debajo del otro */
.row-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s-5);
}

@container dash (min-width: 1040px) {
  .row-main {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }
}

.more-ins {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-3);
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--ai-text);
}

.more-ins:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* Resumen de 12 meses anclado al pie: la tarjeta iguala la altura del asesor sin huecos */
.chart-card :deep(.body) {
  display: flex;
  flex-direction: column;
}

.chart-sum {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: auto 0 0;
  padding-top: var(--s-5);
}

.chart-sum div {
  padding: var(--s-3) var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
}

.chart-sum div:first-child {
  border-radius: var(--r-lg) 0 0 var(--r-lg);
}

.chart-sum div:last-child {
  border-radius: 0 var(--r-lg) var(--r-lg) 0;
}

.chart-sum dt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.chart-sum dd {
  margin: 2px 0 0;
  font-size: var(--text-lg);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.cs-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.cs-dot.inc {
  background: var(--chart-income);
}

.cs-dot.exp {
  background: var(--chart-expense);
}

@media (max-width: 640px) {
  .chart-sum div {
    padding: var(--s-3);
  }

  .chart-sum dd {
    font-size: var(--text-base);
  }
}

.row-3,
.row-2 {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s-5);
}

@container dash (min-width: 640px) {
  .row-3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .row-3 > :last-child {
    grid-column: span 2;
  }
}

@container dash (min-width: 760px) {
  .row-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container dash (min-width: 1040px) {
  .row-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .row-3 > :last-child {
    grid-column: auto;
  }
}

.sk-block {
  background: linear-gradient(90deg, var(--surface) 0, var(--surface-hover) 40%, var(--surface) 80%);
  background-size: 800px 100%;
  animation: shimmer 1.3s linear infinite;
}

/* ─── Asesor ─── */

.advisor {
  container: advisor / inline-size;
}

/* El texto baja de línea antes que el título; si ni así cabe, «Analizar» pasa abajo a todo el ancho */
.adv-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
}

.adv-titles {
  flex: 1 1 150px;
  min-width: 0;
}

.adv-title {
  white-space: nowrap;
}

.adv-analyze {
  margin-left: auto;
  flex: none;
}

@container advisor (max-width: 340px) {
  .adv-analyze {
    flex: 1 0 100%;
  }
}

.adv-ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  font-size: 17px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-md);
  box-shadow: 0 4px 14px -4px rgb(99 70 229 / 0.55);
}

.adv-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.insights {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  list-style: none;
  padding: 0;
}

.insight {
  display: flex;
  gap: var(--s-3);
  animation: rise 420ms var(--ease-out) both;
  animation-delay: calc(300ms + var(--i) * 70ms);
}

.insight + .insight {
  padding-top: var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.ins-ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  font-size: 15px;
  border-radius: var(--r-sm);
}

.t-danger { color: var(--danger); background: var(--danger-soft); }
.t-warning { color: var(--warning); background: var(--warning-soft); }
.t-brand { color: var(--brand-text); background: var(--brand-soft); }
.t-success { color: var(--success); background: var(--success-soft); }

.ins-title {
  font-weight: 600;
  line-height: 1.35;
  color: var(--text);
}

.ins-body {
  margin-top: 3px;
  font-size: var(--text-sm);
  color: var(--text-3);
  line-height: 1.5;
}

.ins-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: var(--text-sm);
}

/* Con todo en orden el aviso se centra en el alto que deje el gráfico de al lado */
.advisor :deep(.body) {
  display: flex;
  flex-direction: column;
}

.adv-empty {
  margin-block: auto;
  text-align: center;
  padding: var(--s-6) var(--s-2);
}

.ok-ic {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: var(--s-3);
  font-size: 22px;
  color: var(--success);
  background: var(--success-soft);
  border-radius: 50%;
}

/* Asesor a todo el ancho: recomendaciones en columnas y el «todo en orden» en una línea */
@container advisor (min-width: 760px) {
  .insights {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--s-5) var(--s-6);
  }

  .insight + .insight {
    padding-top: 0;
    border-top: 0;
  }

  .adv-empty {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0;
    text-align: left;
  }

  .ok-ic {
    flex: none;
    margin-bottom: 0;
  }
}

.adv-ask {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--ai-text);
}

.adv-ask:hover .grow {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ─── Impuestos ─── */

.reserve {
  padding: var(--s-4);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.reserve-value {
  margin-top: 4px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.025em;
}

.tax-list {
  margin-top: var(--s-4);
}

.tax-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: 10px 0;
}

.tax-row + .tax-row {
  border-top: 1px solid var(--border-subtle);
}

.tax-row dt {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 550;
}

.tax-row dd {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-weight: 620;
}

.tax-tag {
  font-size: var(--text-2xs);
  font-weight: 550;
  color: var(--text-3);
}

.tax-tag.pay {
  color: var(--warning);
}

.tax-tag.back {
  color: var(--success);
}

.model {
  display: inline-grid;
  place-items: center;
  min-width: 34px;
  height: 20px;
  padding: 0 6px;
  font-size: var(--text-2xs);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-xs);
}

.foot-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
}

/* ─── Plazos ─── */

.deadlines {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  list-style: none;
  padding: 0;
}

.deadline {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.deadline.soon {
  border-color: color-mix(in srgb, var(--warning-solid) 35%, transparent);
  background: var(--warning-soft);
}

.date-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 44px;
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  line-height: 1;
}

.dd {
  font-size: var(--text-lg);
  font-weight: 700;
}

.mm {
  margin-top: 2px;
  font-size: var(--text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-3);
}

.dl-title {
  font-size: var(--text-sm);
  font-weight: 580;
}

.models {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
}

.dl-when {
  margin-left: auto;
}

/* ─── Clientes ─── */

.clients {
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
  padding: 0;
}

.client {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 8px;
  margin: 0 -8px;
  border-radius: var(--r-md);
  transition: background var(--t-fast);
}

.client:hover {
  background: var(--surface-hover);
}

.client-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

/* Nombre entero: si no cabe, baja a otra línea en vez de cortarse */
.client-name {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: 560;
  overflow-wrap: anywhere;
}

.client-amount {
  flex: none;
  font-size: var(--text-sm);
  font-weight: 600;
}

.share-track {
  height: 6px;
  background: var(--surface-sunken);
  border-radius: 0 3px 3px 0;
}

.share-fill {
  display: block;
  height: 100%;
  background: var(--chart-income);
  border-radius: 0 3px 3px 0;
}

.share {
  width: 38px;
  text-align: right;
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* ─── Actividad ─── */

.recent {
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent.desk {
  padding: 0 var(--s-2) var(--s-2);
}

.recent.mob {
  display: none;
}

.recent-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 10px 12px;
  border-radius: var(--r-md);
  transition: background var(--t-fast);
}

.recent-row:hover {
  background: var(--surface-hover);
}

.recent-name {
  font-weight: 560;
  overflow-wrap: anywhere;
}

.recent-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.recent-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.recent-amount {
  font-weight: 620;
}

.doc-ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  font-size: 17px;
  color: var(--text-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

/* ─── Móvil ─── */

@media (max-width: 767px) {
  .recent.desk {
    display: none;
  }

  .recent.mob {
    display: block;
  }

  /* En el móvil crear va en el «+» de la barra inferior */
  .page-head .page-actions,
  .page-head .sub {
    display: none;
  }

  /* Cifras en 2 × 2, compactas: lo primero que se ve es «Hoy» */
  .kpis {
    gap: var(--s-3);
  }

  .kpi {
    padding: 14px;
    min-height: 0;
  }

  .kpi-top {
    margin-bottom: 0;
  }

  .kpi-label {
    font-size: var(--text-xs);
  }

  .kpi-ic {
    display: none;
  }

  .kpi-value {
    margin-top: 6px;
    font-size: var(--text-lg);
  }

  .kpi-foot .muted {
    display: none;
  }
}
</style>
