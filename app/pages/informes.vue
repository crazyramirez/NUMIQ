<script setup lang="ts">
import type { MenuItem } from '~/components/ui/Menu.vue'

useHead({ title: 'Informes · NUMIQ' })

// Periodo en la URL (?anio=2024&t=3 o &mes=9): enlaces directos y atrás del navegador. Sin él, el último
// elegido en Facturas, Gastos, Contactos o Impuestos; un informe siempre es de un año, trimestre o mes
const { period } = usePeriodQuery({ allowAll: false })

const query = computed(() => ({
  year: period.value.year ?? new Date().getFullYear(),
  ...(period.value.quarter ? { quarter: period.value.quarter } : {}),
  ...(period.value.month ? { month: period.value.month } : {}),
}))

const { data, status, error, refresh } = await useFetch('/api/reports/summary', { query, lazy: true })

const isFuture = computed(() => periodIsFuture(period.value))

// ─── Descargas ───

const qs = computed(() => new URLSearchParams(Object.entries(query.value).map(([k, v]) => [k, String(v)])).toString())
const exportUrl = (format: string, book?: string) => `/api/reports/export?${qs.value}&format=${format}${book ? `&book=${book}` : ''}`
const download = (format: string, book?: string) => {
  window.location.href = exportUrl(format, book)
}
const exportItems = computed<MenuItem[]>(() => [
  { heading: 'Informe completo' },
  { label: 'PDF con tu marca', icon: 'ph:file-pdf', onClick: () => window.open(exportUrl('pdf'), '_blank', 'noopener') },
  { label: 'Excel: resumen, libros e IVA', icon: 'ph:file-xls', onClick: () => download('xlsx') },
  { divider: true },
  { heading: 'CSV para tu gestoría' },
  { label: 'Libro de facturas emitidas', icon: 'ph:file-csv', onClick: () => download('csv', 'issued') },
  { label: 'Libro de facturas recibidas', icon: 'ph:file-csv', onClick: () => download('csv', 'received') },
  { label: 'Cuenta de resultados', icon: 'ph:file-csv', onClick: () => download('csv', 'summary') },
])

// ─── Cifras ───

type Report = NonNullable<typeof data.value>
type Column = Report['columns'][number]

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const periodTitle = computed(() => (data.value ? cap(data.value.period.label) : ''))
const rangeText = computed(() => {
  const p = data.value?.period
  if (!p) return ''
  const f = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')
  return `Del ${f(p.from)} al ${f(p.to)} ${p.year}`
})

const compareText = (label: string) => `vs. ${label}${data.value?.period.partial ? ' (mismo tramo)' : ''}`

const kpis = computed(() => {
  const d = data.value
  if (!d) return []
  const prev = d.compare.previous
  const last = d.compare.lastYear
  return [
    { key: 'income', label: 'Ingresos (base imponible)', icon: 'ph:arrow-circle-up-right', value: d.pnl.income, delta: delta(d.pnl.income, prev.income), yoy: last ? delta(d.pnl.income, last.income) : null, invert: false },
    { key: 'expenses', label: 'Gastos (base imponible)', icon: 'ph:arrow-circle-down-left', value: d.pnl.expenses, delta: delta(d.pnl.expenses, prev.expenses), yoy: last ? delta(d.pnl.expenses, last.expenses) : null, invert: true },
    { key: 'profit', label: 'Beneficio', icon: 'ph:chart-line-up', value: d.pnl.profit, delta: delta(d.pnl.profit, prev.profit), yoy: last ? delta(d.pnl.profit, last.profit) : null, invert: false },
  ]
})

const indicators = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    { label: 'Facturas emitidas', value: String(d.counters.invoices), hint: d.counters.rectifying ? `+ ${d.counters.rectifying} rectificativa${d.counters.rectifying === 1 ? '' : 's'}` : null, icon: 'ph:receipt' },
    { label: 'Ticket medio', value: d.pnl.avgTicket != null ? eur(d.pnl.avgTicket) : '—', hint: 'Base imponible por factura', icon: 'ph:tag' },
    { label: 'Clientes facturados', value: String(d.counters.clients), hint: null, icon: 'ph:users' },
    { label: 'Días medios de cobro', value: d.counters.avgCollectionDays != null ? `${d.counters.avgCollectionDays} días` : '—', hint: 'Desde la fecha de la factura', icon: 'ph:timer' },
    { label: 'Margen', value: d.pnl.margin != null ? pct(d.pnl.margin, 1) : '—', hint: 'Beneficio sobre ingresos', icon: 'ph:percent' },
    { label: 'Rendimiento neto', value: eur(d.pnl.netIncome), hint: 'Ingresos − gastos deducibles', icon: 'ph:scales' },
  ]
})

interface PnlRow { key: string, label: string, pick: (c: Column) => number | null, total: number | null, kind?: 'pct', strong?: boolean, sub?: boolean, tone?: 'income' | 'expense' }

const pnlRows = computed<PnlRow[]>(() => {
  const d = data.value
  if (!d) return []
  const rows: PnlRow[] = [
    { key: 'income', label: 'Ingresos', pick: c => c.metrics.income, total: d.pnl.income, tone: 'income' },
    { key: 'expenses', label: 'Gastos', pick: c => c.metrics.expenses, total: d.pnl.expenses, tone: 'expense' },
    { key: 'ded', label: 'de ellos, deducibles', pick: c => c.metrics.deductibleExpenses, total: d.pnl.deductibleExpenses, sub: true },
    { key: 'profit', label: 'Beneficio', pick: c => c.profit, total: d.pnl.profit, strong: true },
    { key: 'margin', label: 'Margen', pick: c => (c.metrics.income ? (c.profit / c.metrics.income) * 100 : null), total: d.pnl.margin, kind: 'pct', sub: true },
    // Sociedades: impuesto estimado y lo que queda después
    ...(d.corporate
      ? [
          { key: 'is', label: 'Impuesto sobre Sociedades (est.)', pick: (c: Column) => c.corporateTax, total: d.corporate.tax, tone: 'expense' as const },
          { key: 'after', label: 'Beneficio después de impuestos', pick: (c: Column) => round2(c.profit - (c.corporateTax ?? 0)), total: d.corporate.afterTax, strong: true },
        ]
      : []),
    { key: 'vat', label: 'IVA a ingresar (303)', pick: c => c.vatResult, total: d.vat.totals.result },
  ]
  if (d.company.applies130 && d.period.granularity !== 'month') rows.push({ key: '130', label: 'Pago fraccionado (130)', pick: c => c.m130, total: d.irpf.m130 })
  return rows
})

const cell = (r: PnlRow, v: number | null) => (v == null ? '—' : r.kind === 'pct' ? pct(v, 1) : eur(v))

const vatTotals = computed(() => {
  const d = data.value
  if (!d) return null
  return {
    chargedBase: round2(d.vat.charged.reduce((s, g) => s + g.base, 0)),
    supportedBase: round2(d.vat.supported.reduce((s, g) => s + g.base, 0)),
  }
})

const aging = computed(() => data.value?.receivables ?? null)
const AGING_TONE: Record<string, string> = { current: 'var(--chart-income)', d30: 'var(--warning-solid)', d60: 'color-mix(in srgb, var(--warning-solid) 55%, var(--danger-solid))', d90: 'var(--danger-solid)', d90p: 'color-mix(in srgb, var(--danger-solid) 70%, var(--text))' }

const hasActivity = computed(() => !!data.value && (data.value.pnl.income !== 0 || data.value.pnl.expenses !== 0))
</script>

<template>
  <div class="page reports">
    <header class="page-head rise">
      <div>
        <p class="eyebrow">{{ data?.company.name ?? 'Informes' }}</p>
        <h1>{{ periodTitle ? `Informe ${data?.period.granularity === 'month' ? 'de ' : ''}${data?.period.granularity === 'month' ? data?.period.label : periodTitle}` : 'Informes' }}</h1>
        <p class="sub">
          {{ rangeText || 'Cuenta de resultados, IVA y libros registro' }}
          <UiBadge v-if="data?.period.partial" tone="brand" size="sm" dot>En curso</UiBadge>
        </p>
      </div>
      <div class="page-actions">
        <UiMenu :items="exportItems" :width="260">
          <template #default="{ toggle }">
            <UiButton variant="primary" icon="ph:download-simple" icon-right="ph:caret-down" :disabled="!data" @click="toggle">Exportar</UiButton>
          </template>
        </UiMenu>
      </div>
    </header>

    <!-- Selector de periodo -->
    <div class="period-bar card rise" style="--i: 1" role="group" aria-label="Periodo del informe">
      <UiPeriod v-model="period" :allow-all="false" />
      <p v-if="data" class="cmp muted">
        <Icon name="ph:arrows-left-right" aria-hidden="true" />
        Comparado con {{ data.compare.previous.label }}<template v-if="data.compare.lastYear"> y {{ data.compare.lastYear.label }}</template>
      </p>
    </div>

    <UiCard v-if="error && !data" class="rise">
      <UiEmpty icon="ph:cloud-warning" title="No hemos podido preparar el informe" :text="errorMessage(error)">
        <UiButton icon="ph:arrow-clockwise" @click="refresh()">Reintentar</UiButton>
      </UiEmpty>
    </UiCard>

    <!-- Esqueleto -->
    <div v-else-if="!data" class="layout" aria-busy="true" aria-label="Cargando informe">
      <div class="kpis">
        <div v-for="i in 4" :key="i" class="card kpi">
          <div class="skeleton" style="width: 50%; height: 12px" />
          <div class="skeleton" style="width: 72%; height: 30px; margin-top: 16px" />
          <div class="skeleton" style="width: 45%; height: 12px; margin-top: 14px" />
        </div>
      </div>
      <div class="row-main">
        <div class="card sk-block" style="height: 360px" />
        <div class="card sk-block" style="height: 360px" />
      </div>
      <div class="card sk-block" style="height: 300px" />
    </div>

    <div v-else class="layout" :class="{ refreshing: status === 'pending' }">
      <div v-if="isFuture && !hasActivity" class="future rise">
        <Icon name="ph:hourglass-simple" aria-hidden="true" />
        <p>Este periodo aún no ha empezado: el informe se irá llenando con lo que factures y gastes.</p>
      </div>

      <!-- KPIs -->
      <section class="kpis" aria-label="Cifras clave del periodo">
        <article v-for="(k, i) in kpis" :key="k.key" class="card kpi rise" :style="{ '--i': i + 2 }">
          <div class="kpi-top">
            <span class="kpi-label">{{ k.label }}</span>
            <span class="kpi-ic" :class="k.key" aria-hidden="true"><Icon :name="k.icon" /></span>
          </div>
          <p class="kpi-value num" :class="{ neg: k.value < 0 }">{{ eur(k.value) }}</p>
          <div class="kpi-foot">
            <span class="cmp-line">
              <UiDelta :value="k.delta" :invert="k.invert" />
              <span class="muted">{{ k.delta != null ? compareText(data.compare.previous.label) : `Sin datos en ${data.compare.previous.label}` }}</span>
            </span>
            <span v-if="data.compare.lastYear && k.yoy != null" class="cmp-line">
              <UiDelta :value="k.yoy" :invert="k.invert" />
              <span class="muted">vs. {{ data.compare.lastYear.label }}</span>
            </span>
          </div>
        </article>

        <article class="card kpi vat-kpi rise" style="--i: 5">
          <div class="kpi-top">
            <span class="kpi-label">IVA del periodo</span>
            <span class="kpi-ic vat" aria-hidden="true"><Icon name="ph:bank" /></span>
          </div>
          <p class="kpi-value num">{{ eur(Math.abs(data.vat.totals.result)) }}</p>
          <div class="kpi-foot">
            <span class="tax-tag" :class="data.vat.totals.result > 0 ? 'pay' : data.vat.totals.result < 0 ? 'back' : 'zero'">
              {{ data.vat.totals.result > 0 ? 'A ingresar' : data.vat.totals.result < 0 ? 'A compensar' : 'Sin cuota' }}
            </span>
            <span class="muted">Repercutido {{ eur(data.vat.totals.charged, false) }} · deducible {{ eur(data.vat.totals.deductible, false) }}</span>
          </div>
        </article>
      </section>

      <!-- Evolución + indicadores -->
      <div class="row-main">
        <UiCard class="rise" style="--i: 6" icon="ph:chart-bar" :title="`Evolución mensual ${data.period.year}`" subtitle="Ingresos y gastos · base imponible">
          <ChartsIncomeChart :data="data.monthly" />
        </UiCard>

        <UiCard class="rise" style="--i: 7" icon="ph:gauge" title="Indicadores" :subtitle="periodTitle">
          <ul class="indicators">
            <li v-for="it in indicators" :key="it.label">
              <span class="ind-ic" aria-hidden="true"><Icon :name="it.icon" /></span>
              <div class="grow">
                <p class="ind-label">{{ it.label }}</p>
                <p v-if="it.hint" class="ind-hint">{{ it.hint }}</p>
              </div>
              <span class="ind-value num">{{ it.value }}</span>
            </li>
          </ul>
        </UiCard>
      </div>

      <!-- Cuenta de resultados -->
      <UiCard padding="none" class="rise" style="--i: 8" icon="ph:calculator" title="Cuenta de resultados" :subtitle="data.columns.length ? (data.period.granularity === 'year' ? 'Por trimestres · base imponible, sin IVA' : 'Por meses · base imponible, sin IVA') : 'Base imponible, sin IVA'">
        <div class="table-wrap pnl-wrap">
          <table class="table pnl">
            <caption class="sr-only">Cuenta de resultados de {{ periodTitle }}</caption>
            <thead>
              <tr>
                <th scope="col">Concepto</th>
                <th v-for="c in data.columns" :key="c.key" scope="col" class="r" :class="{ dim: c.future }">{{ cap(c.label) }}</th>
                <th scope="col" class="r total-col">{{ data.columns.length ? 'Total' : periodTitle }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in pnlRows" :key="r.key" :class="{ 'is-strong': r.strong, 'is-sub': r.sub }">
                <th scope="row">
                  <span class="row-l"><i v-if="r.tone" class="dot" :class="r.tone" aria-hidden="true" />{{ r.label }}</span>
                </th>
                <td v-for="c in data.columns" :key="c.key" class="r num" :class="{ dim: c.future, neg: !c.future && (r.pick(c) ?? 0) < 0 && r.kind !== 'pct' }">
                  {{ c.future ? '—' : cell(r, r.pick(c)) }}
                </td>
                <td class="r num total-col" :class="{ neg: (r.total ?? 0) < 0 && r.kind !== 'pct' }">{{ cell(r, r.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>

      <!-- IVA + retenciones -->
      <div class="row-2">
        <UiCard class="rise vat-card" style="--i: 9" icon="ph:receipt" title="IVA por tipo" subtitle="Repercutido en tus facturas y soportado en tus gastos">
          <div class="vat-grid">
            <div>
              <p class="mini-title">Repercutido</p>
              <table v-if="data.vat.charged.length" class="mini">
                <thead><tr><th scope="col">Tipo</th><th scope="col" class="r">Base</th><th scope="col" class="r">Cuota</th></tr></thead>
                <tbody>
                  <tr v-for="g in data.vat.charged" :key="`${g.rate}-${g.surchargeRate}`">
                    <td><span class="rate num">{{ num(g.rate) }} %</span><span v-if="g.surchargeRate" class="re num">+ RE {{ num(g.surchargeRate) }} %</span></td>
                    <td class="r num">{{ eur(g.base) }}</td>
                    <td class="r num">{{ eur(g.vat + g.surcharge) }}</td>
                  </tr>
                </tbody>
                <tfoot><tr><td>Total</td><td class="r num">{{ eur(vatTotals?.chargedBase) }}</td><td class="r num">{{ eur(data.vat.totals.charged) }}</td></tr></tfoot>
              </table>
              <p v-else class="none">Sin facturas emitidas</p>
            </div>
            <div>
              <p class="mini-title">Soportado</p>
              <table v-if="data.vat.supported.length" class="mini">
                <thead><tr><th scope="col">Tipo</th><th scope="col" class="r">Cuota</th><th scope="col" class="r">Deducible</th></tr></thead>
                <tbody>
                  <tr v-for="g in data.vat.supported" :key="g.rate">
                    <td><span class="rate num">{{ num(g.rate) }} %</span><span class="re num">s/ {{ eur(g.base, false) }}</span></td>
                    <td class="r num">{{ eur(g.vat) }}</td>
                    <td class="r num">{{ eur(g.deductible) }}</td>
                  </tr>
                </tbody>
                <tfoot><tr><td>Total</td><td class="r num">{{ eur(data.vat.totals.supported) }}</td><td class="r num">{{ eur(data.vat.totals.deductible) }}</td></tr></tfoot>
              </table>
              <p v-else class="none">Sin gastos con IVA</p>
            </div>
          </div>
          <div class="vat-result" :class="data.vat.totals.result > 0 ? 'pay' : 'back'">
            <span>
              <strong>{{ data.vat.totals.result > 0 ? 'A ingresar' : data.vat.totals.result < 0 ? 'A compensar o devolver' : 'Sin cuota' }}</strong>
              <span class="muted"> · repercutido − deducible</span>
            </span>
            <strong class="num">{{ eur(Math.abs(data.vat.totals.result)) }}</strong>
          </div>
          <p v-if="data.vat.totals.nonDeductible > 0" class="note">
            <Icon name="ph:info" aria-hidden="true" />
            {{ eur(data.vat.totals.nonDeductible) }} de IVA soportado no es deducible (vehículo, uso mixto…).
          </p>
        </UiCard>

        <UiCard class="rise" style="--i: 10" icon="ph:hand-coins" :title="data.corporate ? 'Retenciones e impuestos' : 'Retenciones e IRPF'">
          <ul class="irpf">
            <template v-if="data.corporate">
              <li>
                <span class="model" title="Impuesto sobre Sociedades">200</span>
                <div class="grow">
                  <p class="irpf-l">Impuesto sobre Sociedades estimado</p>
                  <p class="irpf-h">Tipo efectivo {{ num(data.corporate.effectiveRate) }} % sobre el resultado del periodo</p>
                </div>
                <span class="num irpf-v">{{ eur(data.corporate.tax) }}</span>
              </li>
              <li>
                <span class="model" title="Pagos fraccionados de Sociedades">202</span>
                <div class="grow">
                  <p class="irpf-l">Pagos fraccionados de {{ data.period.year }}</p>
                  <p class="irpf-h">{{ data.corporate.year.partial ? 'Estimados' : 'Del año' }} · en el 200, {{ data.corporate.year.due < 0 ? `a devolver ${eur(-data.corporate.year.due)}` : `a ingresar ${eur(data.corporate.year.due)}` }}</p>
                </div>
                <span class="num irpf-v">{{ eur(data.corporate.year.paid) }}</span>
              </li>
            </template>
            <li>
              <span class="model" title="Retenciones soportadas"><Icon name="ph:user-circle" aria-hidden="true" /></span>
              <div class="grow">
                <p class="irpf-l">Te retienen tus clientes</p>
                <p class="irpf-h">A descontar en {{ data.corporate ? 'Sociedades' : 'tu IRPF' }} · s/ {{ eur(data.irpf.withheld.base, false) }}</p>
              </div>
              <span class="num irpf-v">{{ eur(data.irpf.withheld.amount) }}</span>
            </li>
            <li>
              <span class="model">111</span>
              <div class="grow">
                <p class="irpf-l">Retienes a profesionales</p>
                <p class="irpf-h">{{ data.irpf.m111.recipients ? `${data.irpf.m111.recipients} perceptor${data.irpf.m111.recipients === 1 ? '' : 'es'} · s/ ${eur(data.irpf.m111.base, false)}` : 'Sin retenciones en el periodo' }}</p>
              </div>
              <span class="num irpf-v">{{ eur(data.irpf.m111.amount) }}</span>
            </li>
            <li>
              <span class="model">115</span>
              <div class="grow">
                <p class="irpf-l">Retienes en alquileres</p>
                <p class="irpf-h">{{ data.irpf.m115.recipients ? `${data.irpf.m115.recipients} arrendador${data.irpf.m115.recipients === 1 ? '' : 'es'} · s/ ${eur(data.irpf.m115.base, false)}` : 'Sin retenciones en el periodo' }}</p>
              </div>
              <span class="num irpf-v">{{ eur(data.irpf.m115.amount) }}</span>
            </li>
            <li v-if="data.irpf.m130 != null">
              <span class="model">130</span>
              <div class="grow">
                <p class="irpf-l">Pago fraccionado estimado</p>
                <p class="irpf-h">20 % del rendimiento acumulado − retenciones</p>
              </div>
              <span class="num irpf-v">{{ eur(data.irpf.m130) }}</span>
            </li>
          </ul>
          <template #footer>
            <NuxtLink to="/impuestos" class="link foot-link">Ver modelos y plazos <Icon name="ph:arrow-right" aria-hidden="true" /></NuxtLink>
          </template>
        </UiCard>
      </div>

      <!-- Rankings -->
      <div class="row-3">
        <UiCard class="rise" style="--i: 11" icon="ph:crown-simple" title="Principales clientes" subtitle="Base imponible e importe total">
          <ReportsRankList v-if="data.topClients.length" :rows="data.topClients" :total="data.pnl.income" kind="client" />
          <UiEmpty v-else compact icon="ph:users" title="Sin facturación" text="No hay facturas emitidas en este periodo." />
        </UiCard>
        <UiCard class="rise" style="--i: 12" icon="ph:storefront" title="Principales proveedores" subtitle="Base imponible e importe total">
          <ReportsRankList v-if="data.topSuppliers.length" :rows="data.topSuppliers" :total="data.pnl.expenses" kind="supplier" />
          <UiEmpty v-else compact icon="ph:storefront" title="Sin gastos" text="No hay gastos registrados en este periodo." />
        </UiCard>
        <UiCard class="rise" style="--i: 13" icon="ph:chart-pie-slice" title="Gastos por categoría" subtitle="Base imponible e importe total">
          <ChartsCategoryBars v-if="data.expensesByCategory.length" :rows="data.expensesByCategory" :max="7" show-total />
          <UiEmpty v-else compact icon="ph:wallet" title="Sin gastos" text="Registra tus gastos para verlos por categoría." />
        </UiCard>
      </div>

      <!-- Pendiente de cobro -->
      <UiCard v-if="aging" class="rise" style="--i: 14" icon="ph:hourglass-medium" title="Pendiente de cobro" :subtitle="`Antigüedad de la deuda de tus clientes a ${fdate(data.period.today)}`">
        <template #actions>
          <UiButton size="sm" variant="ghost" icon-right="ph:arrow-right" to="/facturas?estado=open&anio=todos">Ver facturas</UiButton>
        </template>
        <div v-if="aging.total > 0" class="aging">
          <div class="aging-head">
            <p class="aging-total num">{{ eur(aging.total) }}</p>
            <p class="muted">
              {{ aging.count }} factura{{ aging.count === 1 ? '' : 's' }} pendiente{{ aging.count === 1 ? '' : 's' }}<template v-if="aging.overdue > 0"> · <strong class="late">{{ eur(aging.overdue) }} vencido</strong></template>
            </p>
          </div>
          <div class="aging-bar" role="img" :aria-label="aging.buckets.filter(b => b.amount > 0).map(b => `${b.label}: ${eur(b.amount)}`).join(', ')">
            <span v-for="b in aging.buckets.filter(x => x.amount > 0)" :key="b.key" :style="{ flexGrow: b.amount, background: AGING_TONE[b.key] }" :title="`${b.label}: ${eur(b.amount)}`" />
          </div>
          <ul class="aging-legend">
            <li v-for="b in aging.buckets" :key="b.key" :class="{ empty: !b.count }">
              <span class="sw" :style="{ background: AGING_TONE[b.key] }" aria-hidden="true" />
              <span class="grow">
                <span class="al">{{ b.label }}</span>
                <span class="ac">{{ b.count }} factura{{ b.count === 1 ? '' : 's' }}</span>
              </span>
              <span class="num av">{{ eur(b.amount, false) }}</span>
            </li>
          </ul>
        </div>
        <UiEmpty v-else compact icon="ph:check-circle" title="Todo cobrado" text="No tienes facturas pendientes de cobro." />
      </UiCard>

      <!-- Libros registro -->
      <ReportsBooks class="rise" style="--i: 15" :query="query" :label="periodTitle" />

      <p class="disclaimer">
        <Icon name="ph:info" aria-hidden="true" />
        Criterio de devengo: cada factura cuenta en la fecha en que se expide. Importes sin IVA salvo indicación; las estimaciones de impuestos son orientativas.
      </p>
    </div>
  </div>
</template>

<style scoped>
.page-head .sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

/* Rejillas por el ancho real del contenido (la barra lateral resta 248 px) */
.layout {
  container: rep / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
  transition: opacity var(--t-base);
}

.layout.refreshing {
  opacity: 0.6;
}

/* ─── Periodo ─── */

.period-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-3);
  padding: var(--s-3);
  margin-bottom: var(--s-5);
}

.cmp {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: var(--text-sm);
}

.cmp :deep(svg) {
  width: 15px;
  height: 15px;
}

.future {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-lg);
}

.future :deep(svg) {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--text-3);
}

/* ─── KPIs ─── */

.kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-4);
}

@container rep (min-width: 1000px) {
  .kpis {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.kpi {
  display: flex;
  flex-direction: column;
  padding: var(--s-5);
  min-height: 156px;
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

.kpi-ic.profit {
  color: var(--success);
  background: var(--success-soft);
}

.kpi-ic.vat {
  color: var(--info);
  background: var(--info-soft);
}

.kpi-value {
  margin-top: var(--s-3);
  font-size: var(--text-3xl);
  font-weight: 680;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.kpi-value.neg {
  color: var(--danger);
}

.kpi-foot {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: auto;
  padding-top: var(--s-3);
  font-size: var(--text-xs);
}

.vat-kpi .kpi-foot {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}

.cmp-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cmp-line .muted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tax-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  font-weight: 600;
  border-radius: var(--r-full);
}

.tax-tag.pay {
  color: var(--warning);
  background: var(--warning-soft);
}

.tax-tag.back {
  color: var(--success);
  background: var(--success-soft);
}

.tax-tag.zero {
  color: var(--text-3);
  background: var(--surface-sunken);
}

/* ─── Filas ─── */

.row-main,
.row-2,
.row-3 {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s-5);
}

@container rep (min-width: 640px) {
  .row-3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .row-3 > :last-child {
    grid-column: span 2;
  }
}

/* Lado a lado solo cuando la columna estrecha pasa de ~340 px */
@container rep (min-width: 1040px) {
  .row-main {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }

  .row-2 {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  }

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

/* ─── Indicadores ─── */

.indicators {
  display: flex;
  flex-direction: column;
  list-style: none;
  padding: 0;
}

.indicators li {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 10px 0;
}

.indicators li + li {
  border-top: 1px solid var(--border-subtle);
}

.ind-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  font-size: 16px;
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-md);
}

.ind-label {
  font-size: var(--text-sm);
  font-weight: 550;
}

.ind-hint {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ind-value {
  font-weight: 640;
  white-space: nowrap;
}

/* ─── Cuenta de resultados ─── */

.pnl-wrap {
  container: pnl / inline-size;
  border-top: 1px solid var(--border-subtle);
}

/* Con 12 meses la tabla se desplaza: concepto y total se quedan fijos a los lados */
.pnl thead th:first-child {
  left: 0;
  z-index: 2;
}

@container pnl (max-width: 860px) {
  .pnl th,
  .pnl td {
    padding-inline: 10px;
  }

  .pnl thead th:first-child {
    padding-left: 16px;
  }
}

/* En el móvil dos columnas fijas dejarían una rendija: solo se queda fijo el concepto */
@container pnl (max-width: 520px) {
  .pnl .total-col {
    position: static;
  }
}

.pnl th[scope='row'] {
  position: sticky;
  top: auto;
  left: 0;
  z-index: 1;
  padding: 12px 16px;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text);
  text-align: left;
  background: var(--surface);
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
}

.pnl td {
  white-space: nowrap;
}

.row-l {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.dot.income {
  background: var(--chart-income);
}

.dot.expense {
  background: var(--chart-expense);
}

.pnl .is-sub th[scope='row'] {
  padding-left: 32px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.pnl .is-sub td {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.pnl .is-strong th[scope='row'],
.pnl .is-strong td {
  font-weight: 650;
  background: var(--surface-2);
}

.pnl .total-col {
  position: sticky;
  right: 0;
  font-weight: 620;
  background: var(--surface);
  border-left: 1px solid var(--border-subtle);
}

.pnl thead .total-col {
  z-index: 2;
  background: var(--surface-2);
}

.pnl .dim {
  color: var(--text-4);
}

.pnl td.neg {
  color: var(--danger);
}

.pnl tbody tr:last-child th {
  border-bottom: 0;
}

/* ─── IVA ─── */

/* Repercutido y soportado en paralelo solo si cada tabla tiene sitio para sus tres columnas */
.vat-card {
  container: vat / inline-size;
}

.vat-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s-5);
}

@container vat (min-width: 600px) {
  .vat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.mini-title {
  margin-bottom: var(--s-2);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}

.mini {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.mini th {
  padding: 0 0 6px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.mini td {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.mini .r {
  text-align: right;
}

.mini th + th,
.mini td + td {
  padding-left: 10px;
}

.mini tfoot td {
  font-weight: 620;
  border-bottom: 0;
}

.rate {
  font-weight: 600;
}

.re {
  display: block;
  font-size: var(--text-2xs);
  color: var(--text-3);
}

.none {
  padding: var(--s-3) 0;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.vat-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  margin-top: var(--s-4);
  padding: 12px 14px;
  font-size: var(--text-sm);
  border-radius: var(--r-lg);
  background: var(--warning-soft);
}

.vat-result.back {
  background: var(--success-soft);
}

.vat-result > strong {
  font-size: var(--text-lg);
}

.note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: var(--s-3);
  font-size: var(--text-xs);
  color: var(--text-3);
}

.note :deep(svg) {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 1px;
}

/* ─── IRPF ─── */

.irpf {
  display: flex;
  flex-direction: column;
  list-style: none;
  padding: 0;
}

.irpf li {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 11px 0;
}

.irpf li + li {
  border-top: 1px solid var(--border-subtle);
}

.model {
  display: grid;
  place-items: center;
  flex: none;
  min-width: 38px;
  height: 24px;
  padding: 0 6px;
  font-size: var(--text-2xs);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-sm);
}

.model :deep(svg) {
  width: 15px;
  height: 15px;
}

.irpf-l {
  font-size: var(--text-sm);
  font-weight: 550;
}

.irpf-h {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.irpf-v {
  font-weight: 640;
  white-space: nowrap;
}

.foot-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
}

/* ─── Cobros ─── */

.aging-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 14px;
}

.aging-total {
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.02em;
}

.late {
  color: var(--danger);
  font-weight: 600;
}

.aging-bar {
  display: flex;
  gap: 3px;
  height: 12px;
  margin: var(--s-4) 0;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--surface-sunken);
}

.aging-bar span {
  min-width: 6px;
  flex-basis: 0;
  animation: grow-x 620ms var(--ease-out) both;
  transform-origin: left;
}

@keyframes grow-x {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

.aging-legend {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--s-3);
  list-style: none;
  padding: 0;
}

.aging-legend li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.aging-legend li.empty {
  opacity: 0.55;
}

.sw {
  flex: none;
  width: 9px;
  height: 9px;
  margin-top: 4px;
  border-radius: 3px;
}

.al {
  display: block;
  font-size: var(--text-sm);
  font-weight: 550;
}

.ac {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.av {
  font-size: var(--text-sm);
  font-weight: 620;
  white-space: nowrap;
}

.disclaimer {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.disclaimer :deep(svg) {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 1px;
}

/* ─── Responsive ─── */

@media (max-width: 1279px) {
  .aging-legend {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1023px) {
  .cmp {
    width: 100%;
    margin-left: 0;
  }
}

@media (max-width: 767px) {
  .page-actions {
    width: 100%;
  }

  .page-actions > * {
    flex: 1;
  }

  .page-actions :deep(.btn) {
    width: 100%;
  }

  .period-bar {
    padding: var(--s-2);
  }

  .kpis {
    gap: var(--s-3);
  }

  /* Cifras en 2 × 2 compactas, como en Inicio */
  .kpi {
    padding: 14px;
    min-height: 0;
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

  .aging-legend {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-2);
  }

  .aging-legend li {
    align-items: center;
  }

  .sw {
    margin-top: 0;
  }

  .al,
  .ac {
    display: inline;
  }

  .ac::before {
    content: ' · ';
  }
}
</style>
