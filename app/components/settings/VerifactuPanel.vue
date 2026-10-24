<script setup lang="ts">
import type { Tone } from '~/utils/labels'

/** Envío de registros VeriFactu a la AEAT: entorno, envío automático, estado y detalle de cada registro */
interface VfRecord {
  id: number
  invoiceNumber: string
  invoiceDate: string
  invoiceType: string
  total: number
  status: 'pending' | 'sent' | 'accepted' | 'accepted_with_errors' | 'rejected'
  error: string | null
  sentAt: string | null
  aeatCsv: string | null
  salesDocumentId: number
  customer: string | null
}

interface State {
  enabled: boolean
  settings: { environment: 'test' | 'production', autoSend: boolean }
  endpoint: string
  certificate: { holderName: string, holderNif: string | null, validTo: string, expired: boolean, matchesCompany: boolean } | null
  counts: Partial<Record<VfRecord['status'], number>>
  records: VfRecord[]
}

const props = defineProps<{ canEdit: boolean }>()
const toast = useToast()
const { confirm } = useConfirm()
const { data, refresh } = await useFetch<State>('/api/verifactu')

const STATUS: Record<VfRecord['status'], { label: string, tone: Tone }> = {
  pending: { label: 'Pendiente', tone: 'warning' },
  sent: { label: 'Enviando', tone: 'info' },
  accepted: { label: 'Aceptado', tone: 'success' },
  accepted_with_errors: { label: 'Aceptado con avisos', tone: 'warning' },
  rejected: { label: 'Rechazado', tone: 'danger' },
}

const saving = ref(false)
async function saveSettings(patch: Partial<State['settings']>) {
  if (!data.value) return
  const next = { ...data.value.settings, ...patch }
  if (patch.environment === 'production') {
    const ok = await confirm({
      title: '¿Enviar a la AEAT real?',
      body: 'Los registros pendientes y los de cada factura que emitas se remitirán a la Agencia Tributaria en producción. Hazlo cuando hayas probado el envío en el entorno de pruebas.',
      confirmLabel: 'Pasar a producción',
    })
    if (!ok) return
  }
  saving.value = true
  try {
    await $fetch('/api/verifactu/settings', { method: 'PUT', body: next })
    data.value.settings = next
    toast.success('Ajustes de VeriFactu guardados')
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

const sending = ref(false)
async function sendNow() {
  sending.value = true
  try {
    const r = await $fetch<{ sent: number, rejected: number, message: string, csv: string | null }>('/api/verifactu/send', { method: 'POST' })
    if (!r.sent) toast.info(r.message)
    else if (r.rejected) toast.error(r.message, r.csv ? `CSV ${r.csv}` : undefined)
    else toast.success(r.message, r.csv ? `CSV ${r.csv}` : undefined)
  }
  catch (err) {
    toast.error('No se pudo enviar', errorMessage(err))
  }
  finally {
    sending.value = false
    await refresh()
  }
}

const envModel = computed({
  get: () => data.value?.settings.environment ?? 'test',
  set: (v: string) => saveSettings({ environment: v as 'test' | 'production' }),
})
const autoModel = computed({
  get: () => data.value?.settings.autoSend ?? false,
  set: (v: boolean) => saveSettings({ autoSend: v }),
})
const pending = computed(() => data.value?.counts.pending ?? 0)
const filter = ref<'all' | VfRecord['status']>('all')
const rows = computed(() => (data.value?.records ?? []).filter(r => filter.value === 'all' || r.status === filter.value))
const filterOptions = computed(() => [
  { value: 'all', label: 'Todos', count: data.value?.records.length ?? null },
  ...(['pending', 'accepted', 'accepted_with_errors', 'rejected'] as const).filter(s => data.value?.counts[s]).map(s => ({ value: s, label: STATUS[s].label, count: data.value?.counts[s] ?? null })),
])
const filterModel = computed({ get: () => filter.value as string, set: (v: string) => { filter.value = v as typeof filter.value } })
</script>

<template>
  <div v-if="data" class="vf">
    <UiCard class="rise" style="--i: 3">
      <div class="head">
        <div class="grow">
          <h3 class="section-title">Envío a la AEAT</h3>
          <p class="muted small">Remisión de los registros con tu certificado digital, con respuesta de la AEAT para cada factura.</p>
        </div>
        <UiButton v-if="props.canEdit && pending" variant="primary" icon="ph:paper-plane-tilt" :loading="sending" :disabled="!data.certificate" @click="sendNow">Enviar {{ pending }} pendiente{{ pending > 1 ? 's' : '' }}</UiButton>
      </div>

      <div v-if="!data.certificate" class="need">
        <Icon name="ph:certificate" aria-hidden="true" />
        <span class="grow">Para enviar a la AEAT necesitas tu certificado digital.</span>
        <UiButton size="sm" variant="secondary" to="/ajustes?s=certificado">Subir certificado</UiButton>
      </div>

      <div class="grid">
        <div class="field">
          <span class="label">Entorno</span>
          <UiSegmented v-model="envModel" :options="[{ value: 'test', label: 'Pruebas' }, { value: 'production', label: 'Producción' }]" label="Entorno de la AEAT" />
          <span class="hint">{{ data.settings.environment === 'test' ? 'Entorno de pruebas de la AEAT: sin efectos fiscales' : 'AEAT real: los registros tienen validez fiscal' }}</span>
        </div>
        <UiSwitch v-model="autoModel" :disabled="!props.canEdit || saving || !data.certificate" label="Enviar automáticamente" hint="Cada factura emitida se remite sola en unos minutos" />
      </div>

      <div class="counts">
        <div v-for="s in (['pending', 'accepted', 'accepted_with_errors', 'rejected'] as const)" :key="s" class="count">
          <span class="c-n num">{{ data.counts[s] ?? 0 }}</span>
          <UiBadge :tone="STATUS[s].tone" size="sm" dot>{{ STATUS[s].label }}</UiBadge>
        </div>
      </div>
    </UiCard>

    <UiCard v-if="data.records.length" class="rise" style="--i: 4" padding="none">
      <div class="r-head">
        <h3 class="section-title">Registros de facturación</h3>
        <UiSegmented v-model="filterModel" :options="filterOptions" label="Filtrar registros" />
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Factura</th><th>Cliente</th><th>Fecha</th><th class="r">Importe</th><th>Estado</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td><NuxtLink :to="`/facturas/${r.salesDocumentId}`" class="link">{{ r.invoiceNumber }}</NuxtLink> <span class="muted small">{{ r.invoiceType }}</span></td>
              <td class="truncate max">{{ r.customer ?? '—' }}</td>
              <td>{{ fdateShort(r.invoiceDate) }}</td>
              <td class="r num">{{ eur(r.total) }}</td>
              <td>
                <UiBadge :tone="STATUS[r.status].tone" size="sm">{{ STATUS[r.status].label }}</UiBadge>
                <span v-if="r.error" class="sub err" :title="r.error">{{ r.error }}</span>
                <span v-else-if="r.aeatCsv" class="sub">CSV {{ r.aeatCsv }}</span>
              </td>
              <td class="r"><a :href="`/api/verifactu/records/${r.id}/xml`" class="xml" :aria-label="`XML del registro ${r.invoiceNumber}`" title="Descargar XML"><Icon name="ph:file-code" /></a></td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.vf {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.small {
  font-size: var(--text-sm);
}

.head {
  display: flex;
  align-items: flex-start;
  gap: var(--s-4);
  flex-wrap: wrap;
}

.need {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  margin-top: var(--s-4);
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: var(--r-lg);
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--s-6);
  align-items: start;
  margin-top: var(--s-5);
}

.field {
  align-items: flex-start;
}

.counts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--s-3);
  margin-top: var(--s-5);
}

.count {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.c-n {
  font-size: var(--text-xl);
  font-weight: 680;
}

.r-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-5);
}

.table-wrap {
  max-height: 460px;
  overflow: auto;
  border-top: 1px solid var(--border-subtle);
}

.max {
  max-width: 220px;
}

.err {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--danger);
}

.xml {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--text-3);
  border-radius: var(--r-sm);
}

.xml:hover {
  color: var(--text);
  background: var(--surface-hover);
}

@media (max-width: 720px) {
  .grid,
  .counts {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
