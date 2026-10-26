<script setup lang="ts">
import type { AiCategory, AiMoney, AiUsageGroup, AiUsageReport, AiUsageTotals } from '#shared/utils/ai-usage'
import type { Period } from '~/utils/period'

/**
 * Coste de la IA: lo que ha costado cada lectura, importación y respuesta del asistente, con los tokens
 * reales que devuelve OpenAI y su tarifa oficial. Por días, semanas o meses y desglosado por categoría,
 * tarea, modelo y usuario (o empresa, para el titular de la app).
 */
const now = new Date()
const period = ref<Period>({ year: now.getFullYear(), quarter: null, month: now.getMonth() + 1 })
const autoGroup = computed<AiUsageGroup>(() => (period.value.month ? 'day' : period.value.quarter ? 'week' : 'month'))
const groupChoice = ref<AiUsageGroup | null>(null)
watch(period, () => (groupChoice.value = null))
const group = computed<AiUsageGroup>({ get: () => groupChoice.value ?? autoGroup.value, set: v => (groupChoice.value = v) })
const currency = ref<'eur' | 'usd'>('eur')
const scope = ref<AiUsageReport['scope']>('company')

const query = computed(() => ({ ...periodRange(period.value), group: group.value, scope: scope.value }))
const { data, status, error, refresh } = await useFetch<AiUsageReport>('/api/ai/usage', { query, lazy: true })

// Sin cambio del BCE disponible, todo en dólares (la moneda en que factura OpenAI)
const cur = computed(() => (data.value && !data.value.usdPerEur ? 'usd' : currency.value))
const v = (m: AiMoney | AiUsageTotals) => (cur.value === 'eur' ? m.eur : m.usd)
const money = (m: AiMoney | AiUsageTotals | null | undefined) => (m ? aiMoney(v(m), cur.value) : '—')

const GROUPS = [{ value: 'day', label: 'Días' }, { value: 'week', label: 'Semanas' }, { value: 'month', label: 'Meses' }]
const CURRENCIES = [{ value: 'eur', label: '€' }, { value: 'usd', label: '$' }]
// «Mi clave»: lo que OpenAI cobra a la clave de quien mira, en todas sus empresas (lo comparable con su panel de OpenAI)
const scopes = computed(() => [
  { value: 'company', label: 'Esta empresa' },
  ...(data.value?.keyHint ? [{ value: 'key', label: 'Mi clave' }] : []),
  ...(data.value?.canSeeApp ? [{ value: 'app', label: 'Toda la app' }] : []),
])

const totals = computed(() => data.value?.totals)
const delta = computed(() => {
  const d = data.value
  if (!d || !period.value.year || !v(d.previous)) return null
  return (v(d.totals) - v(d.previous)) / v(d.previous)
})

const kpis = computed(() => {
  const k = data.value?.kpis
  if (!k) return []
  return [
    { key: 'today', label: 'Hoy', icon: 'ph:sun', value: k.today, foot: 'En lo que va de día' },
    { key: 'week', label: 'Últimos 7 días', icon: 'ph:calendar-dots', value: k.last7, foot: `Media diaria ${aiMoney(v(k.last7) / 7, cur.value)}` },
    { key: 'month', label: 'Este mes', icon: 'ph:calendar-blank', value: k.month, foot: `Previsión del mes ${aiMoney(v(k.monthProjection), cur.value)}` },
    { key: 'all', label: 'Desde el principio', icon: 'ph:infinity', value: k.allTime, foot: data.value?.totals.estimatedUsd || k.allTime.usd ? 'Todo lo registrado' : 'Aún sin consumo' },
  ]
})

const unit = computed(() => {
  const k = data.value?.kpis
  return [
    { label: 'Por documento leído', icon: 'ph:file-text', value: k?.perDocument ?? null },
    { label: 'Por respuesta del asistente', icon: 'ph:chat-circle-dots', value: k?.perAnswer ?? null },
  ]
})

const cats = computed(() => {
  const list = data.value?.categories ?? []
  const top = Math.max(...list.map(v), 0) || 1
  const sum = list.reduce((s, c) => s + v(c), 0) || 1
  return list.map(c => ({ ...c, meta: aiCategoryOf(c.key), width: (v(c) / top) * 100, share: v(c) / sum }))
})

function shareRows(rows: Array<AiUsageTotals & { key: string, name?: string }>) {
  const top = Math.max(...rows.map(v), 0) || 1
  return rows.map(r => ({ ...r, width: (v(r) / top) * 100 }))
}
const models = computed(() => shareRows(data.value?.models ?? []))
const byCompany = computed(() => data.value?.scope === 'app' || data.value?.scope === 'key')
const people = computed(() => shareRows(byCompany.value ? data.value!.companies : data.value?.users ?? []))
const keySinceText = computed(() => (data.value?.keySince ? fdate(data.value.keySince) : null))

const cacheText = (r: AiUsageTotals) => (r.input ? pct((r.cached / r.input) * 100) : '—')
const perCall = (r: AiUsageTotals) => aiMoney(v(r) / Math.max(1, r.calls), cur.value)

const exactSinceText = computed(() => (data.value?.exactSince ? fdate(data.value.exactSince) : null))
const rateText = computed(() => (data.value?.usdPerEur ? `1 € = ${data.value.usdPerEur.toLocaleString('es-ES', { maximumFractionDigits: 4 })} $` : null))

const time = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '')
const shortModel = (m: string) => m.replace(/-\d{4}-\d{2}-\d{2}$/, '')
const categoryColor = (c: string) => AI_CATEGORIES[c as AiCategory]?.color ?? AI_CATEGORIES.otros.color
</script>

<template>
  <UiCard class="ai-cost" icon="ph:coins" title="Coste de la IA" subtitle="Calculado con los tokens reales de cada llamada a OpenAI y su tarifa oficial: entrada, caché, salida y razonamiento.">
    <div class="cost">
      <div v-if="scopes.length > 1 || data?.usdPerEur" class="head-ctl">
        <UiSegmented v-if="scopes.length > 1" v-model="scope" :options="scopes" label="Alcance" />
        <UiSegmented v-if="data?.usdPerEur" v-model="currency" :options="CURRENCIES" label="Moneda" />
      </div>

      <UiEmpty v-if="error && !data" icon="ph:cloud-warning" title="No hemos podido calcular el coste" :text="errorMessage(error)">
        <UiButton icon="ph:arrow-clockwise" @click="refresh()">Reintentar</UiButton>
      </UiEmpty>

      <div v-else-if="!data" class="sk" aria-busy="true" aria-label="Calculando el coste">
        <div class="kpis">
          <div v-for="i in 4" :key="i" class="kpi"><div class="skeleton" style="width: 50%; height: 12px" /><div class="skeleton" style="width: 70%; height: 26px; margin-top: 14px" /></div>
        </div>
        <div class="skeleton" style="height: 260px; margin-top: 20px; border-radius: 12px" />
      </div>

      <template v-else>
        <!-- Indicadores fijos -->
        <section class="kpis" aria-label="Coste acumulado">
          <article v-for="k in kpis" :key="k.key" class="kpi">
            <div class="kpi-top">
              <span class="kpi-label">{{ k.label }}</span>
              <span class="kpi-ic" aria-hidden="true"><Icon :name="k.icon" /></span>
            </div>
            <p class="kpi-value num">{{ money(k.value) }}</p>
            <p class="kpi-foot muted num">{{ k.foot }}</p>
          </article>
        </section>

        <!-- Periodo -->
        <div class="toolbar" :class="{ refreshing: status === 'pending' }">
          <UiPeriod v-model="period" />
          <UiSegmented v-model="group" :options="GROUPS" label="Agrupar por" />
          <div class="period-total">
            <span class="pt-v num">{{ money(totals) }}</span>
            <UiDelta v-if="delta != null" :value="delta" invert />
            <span class="muted num">{{ num(totals?.calls) }} {{ totals?.calls === 1 ? 'llamada' : 'llamadas' }}{{ period.year ? ` · ${periodPhrase(period)}` : '' }}</span>
          </div>
        </div>

        <ChartsAiCostChart :series="data.series" :group="data.group" :currency="cur" :class="{ refreshing: status === 'pending' }" />

        <div class="units">
          <div v-for="u in unit" :key="u.label" class="unit">
            <Icon :name="u.icon" class="u-ic" aria-hidden="true" />
            <span class="muted">{{ u.label }}</span>
            <strong class="num">{{ money(u.value) }}</strong>
          </div>
          <div class="unit">
            <Icon name="ph:lightning" class="u-ic" aria-hidden="true" />
            <span class="muted">Entrada leída de la caché (90 % más barata)</span>
            <strong class="num">{{ data.kpis.cacheRate != null ? pct(data.kpis.cacheRate * 100) : '—' }}</strong>
          </div>
        </div>

        <!-- Desgloses -->
        <div v-if="totals?.calls" class="split">
          <section class="block">
            <h3 class="block-t">Por categoría</h3>
            <ul class="bars">
              <li v-for="c in cats" :key="c.key" class="bar-row" :style="{ '--c': c.meta.color }">
                <span class="b-ic" aria-hidden="true"><Icon :name="c.meta.icon" /></span>
                <div class="b-main">
                  <div class="b-line">
                    <span class="b-name truncate">{{ c.meta.label }}</span>
                    <span class="b-val num">{{ money(c) }}</span>
                  </div>
                  <div class="track"><span class="fill" :style="{ width: `${Math.max(2, c.width)}%` }" /></div>
                  <p class="b-meta muted num">{{ num(c.calls) }} {{ c.calls === 1 ? 'llamada' : 'llamadas' }} · {{ perCall(c) }} de media · {{ pct(c.share * 100) }} del total</p>
                </div>
              </li>
            </ul>
          </section>

          <div class="side">
            <section class="block">
              <h3 class="block-t">Por modelo</h3>
              <ul class="bars">
                <li v-for="m in models" :key="m.key" class="bar-row plain">
                  <div class="b-main">
                    <div class="b-line">
                      <span class="b-name mono truncate">{{ m.key }}</span>
                      <span class="b-val num">{{ money(m) }}</span>
                    </div>
                    <div class="track"><span class="fill" :style="{ width: `${Math.max(2, m.width)}%` }" /></div>
                    <p class="b-meta muted num">{{ num(m.calls) }} llamadas · {{ aiTokens(m.input) }} de entrada ({{ cacheText(m) }} en caché) · {{ aiTokens(m.output) }} de salida</p>
                  </div>
                </li>
              </ul>
            </section>
            <section v-if="people.length" class="block">
              <h3 class="block-t">{{ byCompany ? 'Por empresa' : 'Por usuario' }}</h3>
              <ul class="bars">
                <li v-for="p in people" :key="p.key" class="bar-row plain">
                  <div class="b-main">
                    <div class="b-line">
                      <span class="b-name truncate">{{ p.name }}</span>
                      <span class="b-val num">{{ money(p) }}</span>
                    </div>
                    <div class="track"><span class="fill" :style="{ width: `${Math.max(2, p.width)}%` }" /></div>
                  </div>
                </li>
              </ul>
            </section>
          </div>
        </div>

        <!-- Detalle por tarea -->
        <section v-if="data.tasks.length" class="block">
          <h3 class="block-t">Detalle por tarea</h3>
          <div class="table-wrap tbl">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Tarea</th>
                  <th scope="col" class="r opt2">Llamadas</th>
                  <th scope="col" class="r opt">Entrada</th>
                  <th scope="col" class="r opt">En caché</th>
                  <th scope="col" class="r opt">Salida</th>
                  <th scope="col" class="r opt2">Media</th>
                  <th scope="col" class="r">Coste</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in data.tasks" :key="t.key">
                  <td>
                    <span class="task"><span class="dot" :style="{ background: categoryColor(t.category) }" aria-hidden="true" />
                      <span class="truncate">{{ aiTaskLabel(t.task) }}</span></span>
                    <span class="sub muted">{{ aiCategoryOf(t.category).label }}<span class="only-narrow num"> · {{ num(t.calls) }} {{ t.calls === 1 ? 'llamada' : 'llamadas' }}</span></span>
                  </td>
                  <td class="r num opt2">{{ num(t.calls) }}</td>
                  <td class="r num opt">{{ aiTokens(t.input) }}</td>
                  <td class="r num opt">{{ cacheText(t) }}</td>
                  <td class="r num opt">{{ aiTokens(t.output) }}</td>
                  <td class="r num opt2">{{ perCall(t) }}</td>
                  <td class="r num strong">{{ money(t) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Últimas llamadas -->
        <section v-if="data.recent.length" class="block">
          <h3 class="block-t">Últimas llamadas del periodo</h3>
          <ul class="calls">
            <li v-for="r in data.recent" :key="r.id" class="call">
              <span class="dot" :style="{ background: categoryColor(r.category) }" aria-hidden="true" />
              <div class="c-main">
                <p class="c-t">
                  <span class="truncate">{{ aiTaskLabel(r.task) }}</span>
                  <UiBadge v-if="r.estimated" size="sm" tone="neutral">Estimado</UiBadge>
                  <UiBadge v-if="!r.ok" size="sm" tone="warning">{{ r.estimated ? 'Cortada' : 'Sin resultado' }}</UiBadge>
                </p>
                <p class="c-sub muted num">
                  {{ time(r.at) }} · <span class="mono">{{ shortModel(r.model) }}</span> · {{ aiTokens(r.input) }} entrada{{ r.cached ? ` (${aiTokens(r.cached)} en caché)` : '' }} · {{ aiTokens(r.output) }} salida{{ r.reasoning ? ` (${aiTokens(r.reasoning)} razonando)` : '' }}{{ r.ms ? ` · ${(r.ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s` : '' }}{{ r.user ? ` · ${r.user}` : '' }}
                </p>
              </div>
              <strong class="c-v num">{{ aiMoney(cur === 'eur' ? r.eur : r.usd, cur) }}</strong>
            </li>
          </ul>
        </section>

        <footer class="notes muted">
          <p>
            <Icon name="ph:info" class="n-ic" aria-hidden="true" />
            <span>
              Tarifas de OpenAI por millón de tokens (entrada / caché / salida):
              <template v-for="(p, i) in data.prices" :key="p.model">{{ i ? ' · ' : '' }}<span class="mono">{{ p.model }}</span> {{ p.input.toLocaleString('es-ES') }} / {{ p.cached.toLocaleString('es-ES') }} / {{ p.output.toLocaleString('es-ES') }} $</template>.
              <template v-if="rateText"> Cada llamada se pasa a euros con el cambio del BCE de su día (hoy {{ rateText }}).</template>
              No incluye el IVA de la factura de OpenAI.
            </span>
          </p>
          <p v-if="data.scope === 'key'">
            <Icon name="ph:key" class="n-ic" aria-hidden="true" />
            <span>
              Lo pagado con tu clave <span class="mono">{{ data.keyHint }}</span> en todas tus empresas, también por quien del equipo la usa{{ keySinceText ? ` (cada llamada guarda su clave desde el ${keySinceText})` : '' }}.
              Al compararlo con el uso de OpenAI: allí se suma lo que esa clave gaste fuera de esta app (otras instalaciones, pruebas, otros programas) y los días van en hora UTC; aquí, en hora de Madrid.
            </span>
          </p>
          <p v-else-if="data.keyHint">
            <Icon name="ph:key" class="n-ic" aria-hidden="true" />
            <span>Para compararlo con lo que te cobra OpenAI, elige «Mi clave»: OpenAI factura por clave, no por empresa.</span>
          </p>
          <p v-if="totals && totals.estimatedUsd - totals.cutUsd > 1e-9">
            <Icon name="ph:clock-counter-clockwise" class="n-ic" aria-hidden="true" />
            <span>
              {{ money({ usd: totals.estimatedUsd - totals.cutUsd, eur: totals.estimatedEur - totals.cutEur }) }} de este periodo es una estimación de lo anterior al registro exacto{{ exactSinceText ? ` (desde el ${exactSinceText} cada llamada guarda su coste real)` : '' }}: los documentos con los tokens que se guardaron al leerlos; el asistente y el banco, por la longitud de lo enviado.
            </span>
          </p>
          <p v-if="totals?.cutUsd">
            <Icon name="ph:scissors" class="n-ic" aria-hidden="true" />
            <span>
              {{ money({ usd: totals.cutUsd, eur: totals.cutEur }) }} son respuestas del asistente cortadas a medias (se cerró el chat o se cambió de app): OpenAI cobra lo que ya había procesado sin decir cuánto, así que se estima por lo enviado y lo recibido.
            </span>
          </p>
        </footer>
      </template>
    </div>
  </UiCard>
</template>

<style scoped>
.ai-cost {
  container: aicost / inline-size;
}

.head-ctl {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-bottom: calc(var(--s-2) * -1);
}

.cost {
  display: flex;
  flex-direction: column;
  gap: var(--s-6);
}

/* ─── Indicadores ─── */

.kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-3);
}

@container aicost (min-width: 720px) {
  .kpis {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.kpi {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
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
  width: 28px;
  height: 28px;
  font-size: 16px;
  color: var(--ai-text);
  background: var(--ai-soft);
  border-radius: var(--r-md);
}

.kpi-value {
  margin-top: var(--s-3);
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.03em;
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.kpi-foot {
  margin-top: var(--s-2);
  font-size: var(--text-xs);
}

/* ─── Periodo ─── */

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
  margin-bottom: calc(var(--s-2) * -1);
}

.period-total {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--s-2);
  margin-left: auto;
  font-size: var(--text-sm);
}

.pt-v {
  font-size: var(--text-lg);
  font-weight: 680;
  letter-spacing: -0.02em;
  color: var(--text);
}

@container aicost (max-width: 560px) {
  .period-total {
    margin-left: 0;
    width: 100%;
  }
}

.refreshing {
  opacity: 0.6;
  transition: opacity var(--t-fast);
}

.units {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s-2);
}

@container aicost (min-width: 720px) {
  .units {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.unit {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-width: 0;
  padding: 10px 12px;
  font-size: var(--text-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.unit .muted {
  flex: 1;
  min-width: 0;
}

.unit strong {
  font-weight: 650;
  white-space: nowrap;
}

.u-ic {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--text-3);
}

/* ─── Desgloses ─── */

.side {
  display: flex;
  flex-direction: column;
  gap: var(--s-6);
  min-width: 0;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s-6);
}

@container aicost (min-width: 760px) {
  .split {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.block-t {
  margin-bottom: var(--s-3);
  font-size: var(--text-sm);
  font-weight: 620;
  color: var(--text);
}

.bars {
  display: flex;
  flex-direction: column;
  gap: 14px;
  list-style: none;
  padding: 0;
}

.bar-row {
  --c: var(--ai-2);
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.bar-row.plain {
  --c: var(--text-4);
}

.b-ic {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  font-size: 16px;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 13%, transparent);
  border-radius: var(--r-md);
}

.b-main {
  flex: 1;
  min-width: 0;
}

.b-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.b-name {
  font-size: var(--text-sm);
  font-weight: 540;
  color: var(--text);
}

.b-val {
  font-size: var(--text-sm);
  font-weight: 620;
  color: var(--text);
  white-space: nowrap;
}

.track {
  height: 8px;
  background: var(--surface-sunken);
  border-radius: 0 4px 4px 0;
}

.fill {
  display: block;
  height: 100%;
  background: var(--c);
  border-radius: 0 4px 4px 0;
}

.b-meta {
  margin-top: 5px;
  font-size: var(--text-xs);
}

/* ─── Tabla de tareas ─── */

.tbl {
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.tbl .table {
  font-size: var(--text-sm);
}

.tbl .table td {
  padding: 10px 14px;
}

.tbl .table th {
  padding: 9px 14px;
}

.tbl .r {
  text-align: right;
  white-space: nowrap;
}

.tbl .strong {
  font-weight: 640;
}

.task {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-weight: 540;
}

.sub {
  display: block;
  margin-top: 2px;
  padding-left: 16px;
  font-size: var(--text-xs);
}

.dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
}

/* La tabla entera desde 760 px; más estrecho, sin tokens (están en «Por modelo») y, en móvil, sin la media */
@container aicost (max-width: 759px) {
  .opt {
    display: none;
  }
}

.only-narrow {
  display: none;
}

@container aicost (max-width: 479px) {
  .opt2 {
    display: none;
  }

  .only-narrow {
    display: inline;
  }
}

/* ─── Últimas llamadas ─── */

.calls {
  display: flex;
  flex-direction: column;
  max-height: 420px;
  overflow-y: auto;
  list-style: none;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.call {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.call:last-child {
  border-bottom: 0;
}

.c-main {
  flex: 1;
  min-width: 0;
}

.c-t {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: 540;
}

.c-sub {
  margin-top: 2px;
  font-size: var(--text-xs);
}

.c-v {
  font-size: var(--text-sm);
  font-weight: 620;
  white-space: nowrap;
}

/* ─── Notas ─── */

.notes {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding-top: var(--s-4);
  font-size: var(--text-xs);
  line-height: 1.55;
  border-top: 1px solid var(--border-subtle);
}

.notes p {
  display: flex;
  gap: 8px;
}

.n-ic {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-top: 2px;
}
</style>
