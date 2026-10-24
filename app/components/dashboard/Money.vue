<script setup lang="ts">
/**
 * «Tu dinero libre»: el saldo del banco no es todo tuyo. Se ve de un vistazo qué parte es de
 * Hacienda (IVA y retenciones ya cobrados) y qué parte se va en facturas por pagar.
 */
interface Money {
  bank: number
  bankAt: string | null
  accounts: number
  taxes: { amount: number, items: Array<{ label: string, amount: number }> }
  payables: number
  free: number
  receivables: number
}

const props = defineProps<{ money: Money }>()
const showTaxes = ref(false)

// Barra: libre · impuestos · pagos (sobre el saldo; si los compromisos lo superan, se ve en rojo)
const parts = computed(() => {
  const m = props.money
  const total = Math.max(m.bank, m.taxes.amount + m.payables, 1)
  const pct = (n: number) => `${Math.max(0, (n / total) * 100)}%`
  return { free: pct(Math.max(0, m.free)), taxes: pct(m.taxes.amount), pay: pct(m.payables) }
})
</script>

<template>
  <section class="card money" aria-label="Tu dinero libre">
    <div class="m-main">
      <p class="m-l">Tu dinero libre</p>
      <p class="m-v num" :class="{ neg: money.free < 0 }">{{ eur(money.free) }}</p>
      <p class="m-s">
        De {{ eur(money.bank, false) }} en {{ money.accounts === 1 ? 'tu cuenta' : `tus ${money.accounts} cuentas` }}<template v-if="money.bankAt"> (al {{ fdate(money.bankAt) }})</template>
      </p>
    </div>

    <div class="m-side">
      <div class="m-bar" role="img" :aria-label="`Libre ${eur(money.free)}, impuestos ${eur(money.taxes.amount)}, por pagar ${eur(money.payables)}`">
        <span class="seg free" :style="{ width: parts.free }" />
        <span class="seg tax" :style="{ width: parts.taxes }" />
        <span class="seg pay" :style="{ width: parts.pay }" />
      </div>
      <dl class="m-legend">
        <div>
          <dt><i class="dot tax" />Para Hacienda</dt>
          <dd class="num">
            <button v-if="money.taxes.items.length" type="button" class="tax-btn" :aria-expanded="showTaxes" @click="showTaxes = !showTaxes">
              {{ eur(money.taxes.amount, false) }} <Icon name="ph:caret-down" class="caret" :class="{ open: showTaxes }" aria-hidden="true" />
            </button>
            <template v-else>{{ eur(0, false) }}</template>
          </dd>
        </div>
        <div>
          <dt><i class="dot pay" />Por pagar</dt>
          <dd class="num">{{ eur(money.payables, false) }}</dd>
        </div>
        <div v-if="money.receivables > 0">
          <dt><i class="dot recv" />Por cobrar</dt>
          <dd class="num recv-v">+{{ eur(money.receivables, false) }}</dd>
        </div>
      </dl>
      <ul v-if="showTaxes" class="tax-list">
        <li v-for="t in money.taxes.items" :key="t.label"><span>{{ t.label }}</span><span class="num">{{ eur(t.amount) }}</span></li>
        <li class="tax-note">IVA y retenciones que ya has cobrado o devengado: guárdalos para el plazo.</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.money {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.4fr);
  align-items: center;
  gap: var(--s-6);
  padding: var(--s-5) var(--s-6);
}

.m-l {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-3);
}

.m-v {
  margin-top: 4px;
  font-size: var(--text-3xl);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--success);
}

.m-v.neg {
  color: var(--danger);
}

.m-s {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.m-bar {
  display: flex;
  gap: 3px;
  height: 12px;
  overflow: hidden;
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.seg {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width var(--t-slow) var(--ease-out);
}

.seg.free {
  background: var(--success-solid);
}

.seg.tax {
  background: var(--warning-solid);
}

.seg.pay {
  background: var(--text-4);
}

.m-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2) var(--s-6);
  margin: var(--s-3) 0 0;
}

.m-legend dt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.m-legend dd {
  margin: 2px 0 0;
  font-weight: 650;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.dot.tax {
  background: var(--warning-solid);
}

.dot.pay {
  background: var(--text-4);
}

.dot.recv {
  background: var(--info);
}

.recv-v {
  color: var(--info);
}

.tax-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 650;
  color: var(--text);
}

.caret {
  width: 12px;
  height: 12px;
  color: var(--text-3);
  transition: transform var(--t-fast);
}

.caret.open {
  transform: rotate(180deg);
}

.tax-list {
  margin: var(--s-3) 0 0;
  padding: var(--s-3);
  list-style: none;
  font-size: var(--text-sm);
  background: var(--surface-2);
  border-radius: var(--r-md);
}

.tax-list li {
  display: flex;
  justify-content: space-between;
  gap: var(--s-3);
  padding: 2px 0;
}

.tax-list .tax-note {
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

@media (max-width: 900px) {
  .money {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-4);
    padding: var(--s-4);
  }

  .m-v {
    font-size: var(--text-2xl);
  }
}
</style>
