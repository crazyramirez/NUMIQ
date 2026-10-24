<script setup lang="ts">
/** Modal para consultar la información completa y todos los metadatos almacenados de un movimiento bancario */
interface Suggestion {
  kind: 'invoice' | 'expense' | 'payment' | 'new_expense' | 'ignore'
  id?: number | null
  label: string
  detail?: string | null
  confidence: number
  source: 'match' | 'rule' | 'ai'
  expenseKind?: string
  categoryId?: number | null
  supplier?: string | null
  vatRate?: number | null
  deductiblePct?: number | null
  vatDeductiblePct?: number | null
}

interface Tx {
  id: number
  accountId: number
  date: string
  valueDate?: string | null
  amount: number
  description: string
  counterparty: string | null
  reference?: string | null
  bankCode: string | null
  balance?: number | null
  status: 'pending' | 'matched' | 'ignored'
  suggestion?: Suggestion | null
  ignoreReason: string | null
  matchedAt?: string | null
  createdAt?: string | null
  link?: { kind: 'invoice' | 'expense', id: number, label: string, detail: string | null } | null
}

interface Account {
  id: number
  name: string
  bankName: string | null
  iban: string | null
}

const props = defineProps<{
  tx: Tx | null
  account?: Account | null
  bankCodes?: Record<string, string>
}>()

const emit = defineEmits<{
  accept: []
  openMatch: []
  openExpense: []
  ignore: []
  unmatch: []
}>()

const open = defineModel<boolean>({ default: false })
const toast = useToast()
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

async function copyText(text: string, label = 'Concepto copiado') {
  const ok = await copyToClipboard(text)
  if (ok) {
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied.value = false), 2000)
    toast.success(label)
  }
  else {
    toast.error('No se pudo copiar al portapapeles')
  }
}

const isIncome = computed(() => (props.tx?.amount ?? 0) > 0)
const bankCodeLabel = computed(() => {
  if (!props.tx?.bankCode) return null
  return props.bankCodes?.[props.tx.bankCode] ? `${props.tx.bankCode} · ${props.bankCodes[props.tx.bankCode]}` : props.tx.bankCode
})

const linkUrl = computed(() => {
  if (!props.tx?.link) return null
  return props.tx.link.kind === 'invoice' ? `/facturas/${props.tx.link.id}` : `/gastos?ver=${props.tx.link.id}`
})
</script>

<template>
  <UiModal v-model="open" title="Detalle del movimiento bancario" :subtitle="account ? `${account.name}${account.iban ? ` · ${account.iban}` : ''}` : undefined" size="lg">
    <div v-if="tx" class="detail-wrap">
      <!-- Cabecera con importe y estado -->
      <div class="amt-hero" :class="isIncome ? 'income' : 'expense'">
        <div class="amt-left">
          <span class="amt-symbol" aria-hidden="true"><Icon :name="isIncome ? 'ph:arrow-down-left-bold' : 'ph:arrow-up-right-bold'" /></span>
          <div>
            <span class="amt-type">{{ isIncome ? 'Abono / Ingreso en cuenta' : 'Cargo / Pago en cuenta' }}</span>
            <div class="amt-val num">{{ isIncome ? '+' : '' }}{{ eur(tx.amount) }}</div>
          </div>
        </div>
        <div class="amt-status">
          <UiBadge v-if="tx.status === 'matched'" tone="success" icon="ph:check-circle-fill">Conciliado</UiBadge>
          <UiBadge v-else-if="tx.status === 'ignored'" tone="neutral" icon="ph:eye-slash">{{ tx.ignoreReason || 'Ignorado' }}</UiBadge>
          <UiBadge v-else tone="warning" icon="ph:clock">Por revisar</UiBadge>
        </div>
      </div>

      <!-- Descripción completa del extracto bancario -->
      <div class="field-card">
        <div class="field-card-head">
          <div class="field-card-title">
            <Icon name="ph:text-align-left" aria-hidden="true" />
            <span>Concepto íntegro del extracto bancario</span>
          </div>
          <button type="button" class="copy-btn" :class="{ copied }" @click="copyText(tx.description, 'Concepto copiado')">
            <Icon :name="copied ? 'ph:check' : 'ph:copy'" aria-hidden="true" />
            <span>{{ copied ? 'Copiado' : 'Copiar concepto' }}</span>
          </button>
        </div>
        <p class="desc-full selectable">{{ tx.description }}</p>
        <div class="desc-meta">
          <span>Longitud: {{ tx.description.length }} caracteres</span>
          <span v-if="tx.description.length > 50" class="muted">Texto original sin abreviaciones tal como lo emitió el banco</span>
        </div>
      </div>

      <!-- Metadatos estructurados guardados -->
      <div class="info-grid">
        <div class="info-item">
          <span class="info-lbl"><Icon name="ph:calendar-blank" aria-hidden="true" /> Fecha de operación</span>
          <span class="info-val">{{ fdate(tx.date) }}</span>
        </div>

        <div class="info-item">
          <span class="info-lbl"><Icon name="ph:calendar-check" aria-hidden="true" /> Fecha valor</span>
          <span class="info-val">{{ tx.valueDate ? fdate(tx.valueDate) : fdate(tx.date) }}</span>
        </div>

        <div v-if="account" class="info-item">
          <span class="info-lbl"><Icon name="ph:bank" aria-hidden="true" /> Cuenta bancaria</span>
          <span class="info-val truncate">{{ account.name }}</span>
          <span v-if="account.iban" class="info-sub mono">{{ account.iban }}</span>
        </div>

        <div v-if="bankCodeLabel" class="info-item">
          <span class="info-lbl"><Icon name="ph:tag" aria-hidden="true" /> Código AEB (Norma 43)</span>
          <span class="info-val">{{ bankCodeLabel }}</span>
        </div>

        <div v-if="tx.counterparty" class="info-item">
          <span class="info-lbl"><Icon name="ph:user" aria-hidden="true" /> Contraparte / Ordenante</span>
          <span class="info-val">{{ tx.counterparty }}</span>
        </div>

        <div v-if="tx.reference" class="info-item">
          <span class="info-lbl"><Icon name="ph:hash" aria-hidden="true" /> Referencia bancaria</span>
          <div class="ref-row">
            <span class="info-val mono">{{ tx.reference }}</span>
            <button type="button" class="mini-copy" title="Copiar referencia" @click="copyText(tx.reference!, 'Referencia copiada')">
              <Icon name="ph:copy" />
            </button>
          </div>
        </div>

        <div v-if="tx.balance != null" class="info-item">
          <span class="info-lbl"><Icon name="ph:scales" aria-hidden="true" /> Saldo tras el movimiento</span>
          <span class="info-val num">{{ eur(tx.balance) }}</span>
        </div>

        <div v-if="tx.createdAt" class="info-item">
          <span class="info-lbl"><Icon name="ph:clock-clockwise" aria-hidden="true" /> Fecha de importación</span>
          <span class="info-val">{{ fdate(tx.createdAt.slice(0, 10)) }}</span>
        </div>
      </div>

      <!-- Bloque de conciliación o vinculación -->
      <div v-if="tx.status === 'matched' && tx.link" class="match-box ok">
        <div class="match-ic"><Icon name="ph:check-circle-fill" /></div>
        <div class="grow min0">
          <div class="match-top">
            <strong>Conciliado con {{ tx.link.kind === 'invoice' ? 'Factura' : 'Gasto' }}</strong>
            <span v-if="tx.matchedAt" class="match-date">el {{ fdate(tx.matchedAt.slice(0, 10)) }}</span>
          </div>
          <p class="match-label">{{ tx.link.label }}</p>
          <p v-if="tx.link.detail" class="match-detail">{{ tx.link.detail }}</p>
        </div>
        <div class="match-actions">
          <NuxtLink v-if="linkUrl" :to="linkUrl" class="match-btn">
            <span>Ver documento</span>
            <Icon name="ph:arrow-right" aria-hidden="true" />
          </NuxtLink>
          <button type="button" class="match-btn reassign" @click="emit('openMatch'); open = false">
            <Icon name="ph:arrows-left-right" aria-hidden="true" />
            <span>Reasignar</span>
          </button>
        </div>
      </div>

      <!-- Propuesta de coincidencia si está pendiente -->
      <div v-else-if="tx.status === 'pending' && tx.suggestion" class="match-box sug">
        <div class="match-ic"><Icon :name="tx.suggestion.source === 'ai' ? 'ph:sparkle-fill' : 'ph:lightbulb-filament-fill'" /></div>
        <div class="grow min0">
          <div class="match-top">
            <strong>{{ tx.suggestion.source === 'ai' ? 'Propuesta sugerida por IA' : 'Propuesta sugerida por regla' }}</strong>
            <UiBadge size="sm" :tone="tx.suggestion.confidence >= 85 ? 'success' : 'neutral'">{{ tx.suggestion.confidence }} % confianza</UiBadge>
          </div>
          <p class="match-label">{{ tx.suggestion.label }}</p>
          <p v-if="tx.suggestion.detail" class="match-detail">{{ tx.suggestion.detail }}</p>
        </div>
        <UiButton size="sm" variant="primary" icon="ph:check-bold" @click="emit('accept'); open = false">
          Aceptar propuesta
        </UiButton>
      </div>
    </div>

    <template #footer>
      <div class="modal-footer-actions">
        <div class="footer-left">
          <template v-if="tx && tx.status === 'pending'">
            <UiButton size="sm" icon="ph:magnifying-glass" @click="emit('openMatch'); open = false">
              Buscar documento…
            </UiButton>
            <UiButton v-if="(tx.amount ?? 0) < 0" size="sm" icon="ph:plus-circle" @click="emit('openExpense'); open = false">
              Crear gasto…
            </UiButton>
            <UiButton size="sm" variant="ghost" icon="ph:eye-slash" @click="emit('ignore'); open = false">
              Ignorar
            </UiButton>
          </template>
          <template v-else-if="tx && tx.status !== 'pending'">
            <UiButton v-if="tx.status === 'matched'" size="sm" icon="ph:arrows-left-right" @click="emit('openMatch'); open = false">
              {{ (tx.amount ?? 0) > 0 ? 'Reasignar a otra factura…' : 'Reasignar a otro gasto…' }}
            </UiButton>
            <UiButton size="sm" variant="ghost" icon="ph:arrow-counter-clockwise" @click="emit('unmatch'); open = false">
              {{ tx.status === 'matched' ? 'Deshacer conciliación' : 'Volver a pendiente' }}
            </UiButton>
          </template>
        </div>
        <UiButton variant="soft" @click="open = false">Cerrar</UiButton>
      </div>
    </template>
  </UiModal>
</template>

<style scoped>
.detail-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.amt-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-5);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-xl);
}

.amt-hero.income {
  border-left: 4px solid var(--success);
}

.amt-hero.expense {
  border-left: 4px solid var(--text-2);
}

.amt-left {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.amt-symbol {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  font-size: 20px;
  border-radius: var(--r-lg);
}

.amt-hero.income .amt-symbol {
  color: var(--success);
  background: var(--success-subtle);
}

.amt-hero.expense .amt-symbol {
  color: var(--text-2);
  background: var(--surface-sunken);
}

.amt-type {
  display: block;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.amt-val {
  font-size: var(--text-2xl);
  font-weight: 750;
  letter-spacing: -0.02em;
}

.amt-hero.income .amt-val {
  color: var(--success);
}

.amt-hero.expense .amt-val {
  color: var(--text);
}

.field-card {
  padding: var(--s-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xs);
}

.field-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  margin-bottom: var(--s-2);
}

.field-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--brand-text);
  background: var(--brand-subtle);
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: all var(--t-fast);
}

.copy-btn:hover {
  background: var(--surface-hover);
  border-color: var(--border);
}

.copy-btn.copied {
  color: var(--success);
  background: var(--success-subtle);
}

.desc-full {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 520;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
  white-space: pre-wrap;
  user-select: text;
}

.desc-meta {
  display: flex;
  justify-content: space-between;
  gap: var(--s-2);
  margin-top: var(--s-3);
  padding-top: var(--s-2);
  border-top: 1px dashed var(--border-subtle);
  font-size: 11px;
  color: var(--text-3);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: var(--s-3);
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.info-lbl {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 560;
  color: var(--text-3);
}

.info-val {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text);
}

.info-sub {
  font-size: 11px;
  color: var(--text-3);
}

.ref-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mini-copy {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  font-size: 12px;
  color: var(--text-3);
  background: none;
  border: 0;
  cursor: pointer;
  border-radius: var(--r-xs);
}

.mini-copy:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.match-box {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-4);
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
}

.match-box.ok {
  background: var(--surface-2);
  border-color: var(--border-subtle);
}

.match-box.sug {
  background: var(--surface-2);
  border-color: var(--brand-subtle);
}

.match-ic {
  display: grid;
  place-items: center;
  font-size: 24px;
}

.match-box.ok .match-ic {
  color: var(--success);
}

.match-box.sug .match-ic {
  color: var(--brand-text);
}

.match-top {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  font-size: var(--text-xs);
}

.match-date {
  color: var(--text-3);
}

.match-label {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  font-weight: 600;
}

.match-detail {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.match-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--brand-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  text-decoration: none;
  transition: all var(--t-fast);
}

.match-btn:hover {
  background: var(--surface-hover);
  border-color: var(--brand);
}

.match-actions {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.match-btn.reassign {
  color: var(--text-2);
  cursor: pointer;
}

.match-btn.reassign:hover {
  color: var(--brand-text);
  border-color: var(--brand);
}

.modal-footer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: var(--s-2);
}

.footer-left {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex-wrap: wrap;
}
</style>
