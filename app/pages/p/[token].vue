<script setup lang="ts">
import type { PaperDoc } from '~/components/sales/Paper.vue'

/** Vista pública de un documento para el cliente: ver y descargar el presupuesto, o ver y pagar la factura */
definePageMeta({ layout: 'blank' })

interface PublicDoc {
  doc: PaperDoc & { total: number }
  company: {
    legalName: string, tradeName: string | null, nif: string, address: string | null, postalCode: string | null, city: string | null, province: string | null
    iban: string | null, brandColor: string | null, invoiceFooter: string | null, email: string | null, phone: string | null, website: string | null
  }
  design: InvoiceDesign
  logoUrl: string | null
  signature: { url: string, label: string, signer: string } | null
  pdfUrl: string
  payment: { paid: boolean, pending: number, paidTotal: number, dueDate: string | null, method: string | null, iban: string | null, cancelled: boolean, online?: { link: string | null, linkLabel: string | null, bizum: string | null } } | null
}

const route = useRoute()
const toast = useToast()
const token = String(route.params.token ?? '')
const { data, error } = await useFetch<PublicDoc>(`/api/public/doc/${token}/info`)

const brand = computed(() => (data.value ? data.value.company.tradeName || data.value.company.legalName : ''))
const kindLabel = computed(() => KIND_LABEL[data.value?.doc.kind ?? 'invoice'] ?? 'Documento')
const accent = computed(() => data.value?.design?.accentColor || data.value?.company.brandColor || null)
useHead({
  title: computed(() => (data.value ? `${kindLabel.value} ${data.value.doc.number ?? ''} · ${brand.value}` : 'Documento')),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const pay = computed(() => data.value?.payment ?? null)
const overdue = computed(() => !!pay.value && !pay.value.paid && !!pay.value.dueDate && daysUntil(pay.value.dueDate) < 0)
// Bizum: el móvil sin prefijo, y para leerlo en grupos de tres (612 345 678)
const bizumPlain = (phone: string) => phone.replace(/^\+34/, '')
const bizumPretty = (phone: string) => bizumPlain(phone).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
const ibanText = computed(() => pay.value?.iban?.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim() ?? '')
const website = computed(() => {
  const w = data.value?.company.website
  return w ? (/^https?:\/\//i.test(w) ? w : `https://${w}`) : null
})

// ─── Copiar datos de pago ───
const copied = ref<string | null>(null)
async function copy(key: string, text: string) {
  const ok = await copyToClipboard(text)
  if (ok) {
    copied.value = key
    setTimeout(() => {
      if (copied.value === key) copied.value = null
    }, 1800)
  }
  else {
    toast.error('No se pudo copiar', 'Selecciona el texto y cópialo a mano')
  }
}
</script>

<template>
  <div class="pub" :style="accent ? { '--pub-accent': accent } : undefined">
    <template v-if="data">
      <header class="pub-top">
        <div class="pub-in pub-bar">
          <div class="pub-brand min0">
            <img v-if="data.logoUrl" :src="data.logoUrl" :alt="brand" class="pub-logo">
            <span v-else class="pub-mark" aria-hidden="true">{{ initials(brand) }}</span>
            <div v-if="!data.logoUrl" class="min0">
              <p class="pub-name truncate">{{ brand }}</p>
              <p class="pub-sub truncate">{{ kindLabel }} {{ data.doc.number }}</p>
            </div>
          </div>
          <UiButton :to="`${data.pdfUrl}?download=1`" external icon="ph:download-simple" class="dl">
            <span class="hide-xs">Descargar PDF</span><span class="show-xs">PDF</span>
          </UiButton>
        </div>
      </header>

      <main class="pub-in pub-body">
        <aside class="pub-side">
          <section class="card sum rise" style="--i: 0">
            <p class="eyebrow">{{ kindLabel }} {{ data.doc.number }}</p>
            <p class="sum-total num">{{ eur(data.doc.total) }}</p>
            <p class="sum-meta">
              {{ data.doc.kind === 'quote' ? 'Emitido' : 'Emitida' }} el {{ fdate(data.doc.issueDate) }}<template v-if="data.doc.customer?.name"> para <strong>{{ data.doc.customer.name }}</strong></template>
            </p>

            <!-- Presupuesto: su validez (se acepta por email, no desde aquí) -->
            <p v-if="!pay && data.doc.dueDate" class="due">
              <Icon name="ph:calendar-blank" aria-hidden="true" />
              Válido hasta el {{ fdate(data.doc.dueDate) }}
            </p>

            <!-- Factura: estado del pago -->
            <template v-if="pay">
              <div v-if="pay.cancelled" class="state t-neutral">
                <span class="state-ic" aria-hidden="true"><Icon name="ph:prohibit-fill" /></span>
                <p class="state-t">Factura anulada</p>
              </div>
              <div v-else-if="pay.paid" class="state t-success">
                <span class="state-ic" aria-hidden="true"><Icon name="ph:check-circle-fill" /></span>
                <div>
                  <p class="state-t">Pagada</p>
                  <p class="state-s">No tienes nada pendiente. ¡Gracias!</p>
                </div>
              </div>
              <template v-else>
                <div class="rows">
                  <div class="r"><span>Pendiente de pago</span><strong class="num">{{ eur(pay.pending) }}</strong></div>
                  <div v-if="pay.paidTotal > 0" class="r"><span>Ya pagado</span><span class="num">{{ eur(pay.paidTotal) }}</span></div>
                </div>
                <p v-if="pay.dueDate" class="due" :class="{ late: overdue }">
                  <Icon :name="overdue ? 'ph:warning-circle-fill' : 'ph:calendar-blank'" aria-hidden="true" />
                  {{ overdue ? 'Venció' : 'Vence' }} el {{ fdate(pay.dueDate) }} · {{ relDays(pay.dueDate) }}
                </p>
              </template>
            </template>
          </section>

          <!-- Pagar en un toque: enlace de pago del negocio o Bizum -->
          <section v-if="pay && !pay.paid && !pay.cancelled && (pay.online?.link || pay.online?.bizum)" class="card side-card pay-now rise" style="--i: 1">
            <h2 class="side-t">Paga ahora</h2>
            <p class="side-s">{{ eur(pay.pending) }} · Factura {{ data.doc.number }}</p>
            <a v-if="pay.online?.link" :href="pay.online.link" target="_blank" rel="noopener" class="pay-btn">
              <Icon name="ph:credit-card" aria-hidden="true" />
              {{ pay.online.linkLabel ? `Pagar con ${pay.online.linkLabel}` : 'Pagar online' }}
              <Icon name="ph:arrow-up-right" class="pay-out" aria-hidden="true" />
            </a>
            <button v-if="pay.online?.bizum" type="button" class="copy" @click="copy('bizum', bizumPlain(pay.online.bizum))">
              <span class="min0">
                <span class="copy-l">Bizum</span>
                <span class="copy-v num">{{ bizumPretty(pay.online.bizum) }}</span>
              </span>
              <Icon :name="copied === 'bizum' ? 'ph:check-bold' : 'ph:copy'" :class="{ ok: copied === 'bizum' }" aria-hidden="true" />
            </button>
            <p v-if="pay.online?.bizum" class="side-s small">En el concepto de Bizum pon «Factura {{ data.doc.number }}».</p>
          </section>

          <section v-if="pay && !pay.paid && !pay.cancelled && pay.iban" class="card side-card rise" style="--i: 1">
            <h2 class="side-t">Cómo pagar</h2>
            <p class="side-s">Por transferencia bancaria. Toca un dato para copiarlo.</p>
            <button type="button" class="copy" @click="copy('iban', pay.iban.replace(/\s/g, ''))">
              <span class="min0">
                <span class="copy-l">IBAN</span>
                <span class="copy-v mono">{{ ibanText }}</span>
              </span>
              <Icon :name="copied === 'iban' ? 'ph:check-bold' : 'ph:copy'" :class="{ ok: copied === 'iban' }" aria-hidden="true" />
            </button>
            <button type="button" class="copy" @click="copy('amount', String(pay.pending).replace('.', ','))">
              <span class="min0">
                <span class="copy-l">Importe</span>
                <span class="copy-v num">{{ eur(pay.pending) }}</span>
              </span>
              <Icon :name="copied === 'amount' ? 'ph:check-bold' : 'ph:copy'" :class="{ ok: copied === 'amount' }" aria-hidden="true" />
            </button>
            <button type="button" class="copy" @click="copy('concept', `Factura ${data.doc.number}`)">
              <span class="min0">
                <span class="copy-l">Concepto</span>
                <span class="copy-v">Factura {{ data.doc.number }}</span>
              </span>
              <Icon :name="copied === 'concept' ? 'ph:check-bold' : 'ph:copy'" :class="{ ok: copied === 'concept' }" aria-hidden="true" />
            </button>
            <p v-if="copied" class="sr-only" role="status">Copiado</p>
          </section>
          <section v-else-if="pay && !pay.paid && !pay.cancelled && pay.method && pay.method !== 'transfer'" class="card side-card rise" style="--i: 1">
            <h2 class="side-t">Forma de pago</h2>
            <p class="side-s">{{ PAYMENT_METHODS[pay.method] ?? pay.method }}</p>
          </section>

          <section v-if="data.company.email || data.company.phone || website" class="card side-card rise" style="--i: 2">
            <h2 class="side-t">¿Alguna duda?</h2>
            <p class="side-s">Habla directamente con {{ brand }}.</p>
            <div class="contact">
              <a v-if="data.company.email" :href="`mailto:${data.company.email}?subject=${encodeURIComponent(`${kindLabel} ${data.doc.number ?? ''}`)}`" class="c-link">
                <Icon name="ph:envelope-simple" aria-hidden="true" /><span class="truncate">{{ data.company.email }}</span>
              </a>
              <a v-if="data.company.phone" :href="`tel:${data.company.phone.replace(/\s/g, '')}`" class="c-link">
                <Icon name="ph:phone" aria-hidden="true" /><span>{{ data.company.phone }}</span>
              </a>
              <a v-if="website" :href="website" target="_blank" rel="noopener" class="c-link">
                <Icon name="ph:globe-simple" aria-hidden="true" /><span class="truncate">{{ data.company.website }}</span>
              </a>
            </div>
          </section>
        </aside>

        <div class="pub-paper rise" style="--i: 1">
          <SalesPaper :doc="data.doc" :company="data.company" :design="data.design" :logo-url="data.logoUrl" :signature="data.signature" />
        </div>
      </main>

      <footer class="pub-in pub-foot">
        <span><Icon name="ph:lock-simple" aria-hidden="true" /> Enlace privado de {{ brand }}</span>
        <span>Facturación con <a href="/" class="numiq">NUMIQ</a></span>
      </footer>
    </template>

    <div v-else-if="error" class="missing rise">
      <span class="miss-ic" aria-hidden="true"><Icon name="ph:link-break" /></span>
      <h1>Este enlace no está disponible</h1>
      <p>Puede que el enlace esté incompleto o que el documento ya no exista. Pide a quien te lo envió que te lo mande de nuevo.</p>
    </div>

    <div v-else class="pub-in pub-body" aria-busy="true">
      <div class="pub-side">
        <div class="skeleton" style="height: 260px; border-radius: var(--r-xl)" />
      </div>
      <div class="skeleton" style="height: 70vh; border-radius: 14px" />
    </div>
  </div>
</template>

<style scoped>
.pub {
  --pub-accent: var(--brand);
  min-height: 100dvh;
  background: var(--bg);
  background-image: var(--bg-grad);
}

.pub-in {
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding-inline: var(--s-6);
}

.pub-top {
  position: sticky;
  top: 0;
  z-index: 10;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  backdrop-filter: saturate(1.4) blur(14px);
  border-bottom: 1px solid var(--border-subtle);
}

.pub-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  height: 64px;
}

.pub-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* El logo suele estar pensado para fondo blanco: en modo oscuro va en su propia ficha clara */
.pub-logo {
  max-width: 180px;
  max-height: 40px;
  padding: 4px 8px;
  object-fit: contain;
  background: #fff;
  border-radius: 9px;
}

.pub-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: var(--pub-accent);
  border-radius: 11px;
}

.pub-name {
  font-weight: 650;
  line-height: 1.25;
}

.pub-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.pub-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: var(--s-6);
  align-items: start;
  padding-block: var(--s-7) var(--s-6);
}

.pub-paper {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
}

.pub-side {
  grid-column: 2;
  position: sticky;
  top: calc(64px + var(--s-6));
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.sum {
  padding: var(--s-6);
}

.sum-total {
  margin: 6px 0 4px;
  font-size: var(--text-3xl);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.sum-meta {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.sum-meta strong {
  font-weight: 600;
  color: var(--text-2);
}

.due {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: var(--s-4) 0 var(--s-2);
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-md);
}

.due.late {
  color: var(--danger);
  background: var(--danger-soft);
}

.state {
  display: flex;
  gap: 12px;
  margin-top: var(--s-5);
  padding: 14px;
  border-radius: var(--r-lg);
  background: var(--surface-sunken);
}

.state-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  font-size: 22px;
  border-radius: 50%;
  background: var(--surface);
}

.state-t {
  font-weight: 650;
  line-height: 1.35;
}

.state-s {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.state.t-success {
  background: var(--success-soft);
}

.state.t-success .state-ic {
  color: var(--success-solid);
}

.state.t-neutral .state-ic {
  color: var(--text-3);
}

.rows {
  margin-top: var(--s-4);
}

.r {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.r strong {
  font-size: var(--text-md);
  color: var(--text);
}

.side-card {
  padding: var(--s-5);
}

.side-t {
  font-size: var(--text-md);
  font-weight: 650;
}

.side-s {
  margin: 2px 0 var(--s-3);
  font-size: var(--text-sm);
  color: var(--text-3);
}

.side-s.small {
  margin: var(--s-2) 0 0;
  font-size: var(--text-xs);
}

.pay-now {
  border-color: color-mix(in srgb, var(--brand) 30%, var(--border));
}

.pay-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 48px;
  margin-bottom: var(--s-3);
  font-size: var(--text-md);
  font-weight: 650;
  color: var(--on-brand);
  background: var(--brand);
  border-radius: var(--r-lg);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--brand) 30%, transparent);
  transition: background var(--t-fast), transform var(--t-fast);
}

.pay-btn:hover {
  background: var(--brand-hover);
}

.pay-btn:active {
  transform: scale(0.98);
}

.pay-btn :deep(svg) {
  width: 20px;
  height: 20px;
}

.pay-btn .pay-out {
  width: 16px;
  height: 16px;
  opacity: 0.8;
}

.copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: border-color var(--t-fast), background var(--t-fast);
}

.copy + .copy {
  margin-top: 8px;
}

.copy:hover {
  border-color: var(--border-strong);
}

.copy:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.copy > :deep(svg) {
  flex: none;
  color: var(--text-3);
  transition: color var(--t-fast), transform var(--t-fast);
}

.copy > :deep(svg.ok) {
  color: var(--success-solid);
  transform: scale(1.15);
}

.copy-l {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-4);
}

.copy-v {
  display: block;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text);
  overflow-wrap: anywhere;
}

.contact {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.c-link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 6px 10px;
  margin-inline: -10px;
  font-size: var(--text-sm);
  color: var(--text-2);
  border-radius: var(--r-md);
  transition: background var(--t-fast), color var(--t-fast);
}

.c-link:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.c-link :deep(svg) {
  flex: none;
  color: var(--text-3);
}

.pub-foot {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--s-2) var(--s-4);
  padding-block: var(--s-4) var(--s-7);
  font-size: var(--text-xs);
  color: var(--text-4);
}

.pub-foot span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.numiq {
  font-weight: 700;
  color: var(--text-3);
}

.missing {
  max-width: 440px;
  margin: 0 auto;
  padding: 18vh var(--s-5) 0;
  text-align: center;
}

.miss-ic {
  display: inline-grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--s-5);
  font-size: 30px;
  color: var(--text-3);
  background: var(--surface-sunken);
  border-radius: 20px;
}

.missing h1 {
  font-size: var(--text-xl);
  letter-spacing: -0.02em;
}

.missing p {
  margin-top: var(--s-2);
  color: var(--text-3);
}

.min0 {
  min-width: 0;
}

.show-xs {
  display: none;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

@media (max-width: 1080px) {
  .pub-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .pub-side {
    grid-column: 1;
    position: static;
  }

  .pub-paper {
    grid-row: auto;
  }
}

@media (max-width: 640px) {
  .pub-in {
    padding-inline: var(--s-4);
  }

  .pub-body {
    padding-block: var(--s-5);
    gap: var(--s-4);
  }

  .sum {
    padding: var(--s-5);
  }

  .hide-xs {
    display: none;
  }

  .show-xs {
    display: inline;
  }
}
</style>
