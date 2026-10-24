<script setup lang="ts">
/** Hoja de factura de solo lectura: pantalla, impresión y base del PDF */
export interface PaperParty {
  name: string
  nif?: string | null
  address?: string | null
  postalCode?: string | null
  city?: string | null
  province?: string | null
  email?: string | null
}

export interface PaperDoc {
  kind: string
  status: string
  number: string | null
  issueDate: string
  dueDate: string | null
  operationDate: string | null
  paymentMethod: string | null
  description?: RichDoc | null
  notes: string | null
  terms: string | null
  irpfRate: number
  rectificationCode: string | null
  rectificationReason: string | null
  customerReference?: string | null
  issuer: PaperParty | null
  customer: PaperParty | null
  contact: PaperParty | null
  lines: Array<{ id: number, description: string, quantity: number, unitPrice: number, discountPct: number, vatRate: number, surchargeRate: number, irpfApplies: boolean, base: number }>
  verifactu: { hash: string, qrUrl: string } | null
}

const props = defineProps<{
  doc: PaperDoc
  company: { legalName: string, tradeName: string | null, nif: string, address: string | null, postalCode: string | null, city: string | null, province: string | null, iban: string | null, brandColor: string | null, invoiceFooter: string | null }
  /** Diseño a medida de la empresa (estructura, color, tipografía, logo) */
  design?: InvoiceDesign | null
  logoUrl?: string | null
}>()

const d = computed(() => props.design ?? normalizeDesign(null, props.company.brandColor))
const paperStyle = computed(() => ({
  '--doc-accent': d.value.accentColor,
  '--p-on-accent': onColor(d.value.accentColor),
  '--doc-font': d.value.font === 'Inter' ? undefined : `'${d.value.font}', ${d.value.font === 'Lora' ? 'Georgia, serif' : 'system-ui, sans-serif'}`,
}))

// Emitida: datos congelados; borrador: los actuales
const issuer = computed<PaperParty>(() => props.doc.issuer ?? { name: props.company.legalName, nif: props.company.nif, address: props.company.address, postalCode: props.company.postalCode, city: props.company.city, province: props.company.province })
const customer = computed(() => props.doc.customer ?? props.doc.contact)
const brand = computed(() => props.company.tradeName || props.company.legalName)
const totals = computed(() => computeTotals(props.doc.lines, props.doc.irpfRate))
const show = computed(() => lineColumns(d.value, props.doc.lines))
const isQuote = computed(() => props.doc.kind === 'quote' || props.doc.kind === 'proforma')
/** Título de observaciones o condiciones según el diseño (vacío: sin título) */
const notesTitle = computed(() => (isQuote.value ? d.value.termsLabel : d.value.notesLabel).trim())
const title = computed(() => ({ invoice: 'Factura', rectifying: 'Factura rectificativa', quote: 'Presupuesto', proforma: 'Factura proforma' }[props.doc.kind] ?? 'Factura'))
const place = (p: PaperParty) => [[p.postalCode, p.city].filter(Boolean).join(' '), p.province ? `(${p.province})` : ''].filter(Boolean).join(' ')
</script>

<template>
  <article class="paper" :class="`l-${d.layout}`" :style="paperStyle">
    <header class="paper-head">
      <div class="paper-brand">
        <img v-if="logoUrl && d.showLogo" :src="logoUrl" :alt="brand" class="paper-logo">
        <template v-else>
          <span class="paper-mark">{{ initials(brand) }}</span>
          <div>
            <p class="paper-company">{{ brand }}</p>
            <p v-if="company.tradeName" class="paper-company-sub">{{ company.legalName }}</p>
          </div>
        </template>
      </div>
      <div class="head-right">
        <div class="paper-title">
          <h2>{{ title }}</h2>
          <p class="paper-number" :class="{ pending: !doc.number }">{{ doc.number ?? 'Borrador' }}</p>
        </div>
        <div v-if="doc.verifactu" class="paper-qr vf">
          <SalesVerifactuQr :url="doc.verifactu.qrUrl" :size="76" />
          <div>
            <strong>VERI*FACTU</strong>
            <span>Factura verificable en la sede electrónica de la AEAT</span>
          </div>
        </div>
      </div>
    </header>

    <div class="paper-meta">
      <div><span class="paper-label">Fecha</span>{{ fdateShort(doc.issueDate) }}</div>
      <div><span class="paper-label">{{ isQuote ? 'Válido hasta' : 'Vencimiento' }}</span>{{ fdateShort(doc.dueDate) }}</div>
      <div><span class="paper-label">Forma de pago</span>{{ PAYMENT_METHODS[doc.paymentMethod ?? ''] ?? '—' }}</div>
      <div v-if="doc.customerReference"><span class="paper-label">{{ d.customerReferenceLabel || 'Orden de Pedido' }}</span>{{ doc.customerReference }}</div>
    </div>

    <div class="paper-parties">
      <div class="paper-party">
        <span class="paper-label">Emisor</span>
        <p class="paper-party-name">{{ issuer.name }}</p>
        <p>NIF {{ issuer.nif }}</p>
        <p v-if="issuer.address">{{ issuer.address }}</p>
        <p v-if="place(issuer)">{{ place(issuer) }}</p>
      </div>
      <div class="paper-party">
        <span class="paper-label">Cliente</span>
        <template v-if="customer">
          <p class="paper-party-name">{{ customer.name }}</p>
          <p v-if="customer.nif">NIF {{ customer.nif }}</p>
          <p v-if="customer.address">{{ customer.address }}</p>
          <p v-if="place(customer)">{{ place(customer) }}</p>
        </template>
        <p v-else class="muted-p">Sin cliente</p>
      </div>
    </div>

    <p v-if="doc.kind === 'rectifying'" class="rect">
      <strong>Rectificativa {{ doc.rectificationCode }}</strong><template v-if="doc.rectificationReason"> · {{ doc.rectificationReason }}</template>
    </p>
    <p v-if="doc.operationDate" class="op-date">Fecha de la operación: {{ fdateShort(doc.operationDate) }}</p>

    <RichView :doc="doc.description" class="paper-desc" />

    <div v-if="!isConceptless(doc.lines)" class="lines-wrap">
    <table class="paper-lines">
      <thead>
        <tr>
          <th>Concepto</th>
          <th v-if="show.quantity" class="r">Cant.</th>
          <th v-if="show.price" class="r">Precio</th>
          <th v-if="show.discount" class="r">Dto.</th>
          <th v-if="show.vat" class="r">IVA</th>
          <th v-if="show.amount" class="r">Importe</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in doc.lines" :key="l.id">
          <td class="c-desc">
            <span class="paper-desc">{{ l.description }}</span>
            <span v-if="!l.irpfApplies && doc.irpfRate" class="paper-desc-sub">Sin retención</span>
          </td>
          <td v-if="show.quantity" class="r c-q">{{ num(l.quantity) }}</td>
          <td v-if="show.price" class="r c-p">{{ eur(l.unitPrice) }}</td>
          <td v-if="show.discount" class="r c-d">{{ l.discountPct ? `${num(l.discountPct)} %` : '' }}</td>
          <td v-if="show.vat" class="r c-v">{{ num(l.vatRate) }} %</td>
          <td v-if="show.amount" class="r c-a">{{ eur(l.base) }}</td>
        </tr>
      </tbody>
    </table>
    </div>

    <div class="paper-bottom">
      <div v-if="isQuote ? doc.terms : doc.notes">
        <span v-if="notesTitle" class="paper-label">{{ notesTitle }}</span>
        <p class="paper-notes">{{ isQuote ? doc.terms : doc.notes }}</p>
      </div>
      <div v-else />
      <div class="paper-totals">
        <div class="t-row"><span>Base imponible</span><span>{{ eur(totals.taxBase) }}</span></div>
        <div v-for="g in totals.groups" :key="`${g.vatRate}-${g.surchargeRate}`" class="t-row">
          <span>IVA {{ num(g.vatRate) }} %<small v-if="totals.groups.length > 1"> s/ {{ eur(g.base) }}</small></span><span>{{ eur(g.vat) }}</span>
        </div>
        <div v-if="totals.surchargeTotal" class="t-row"><span>Recargo de equivalencia</span><span>{{ eur(totals.surchargeTotal) }}</span></div>
        <div v-if="doc.irpfRate" class="t-row minus"><span>Retención IRPF {{ num(doc.irpfRate) }} %</span><span>{{ totals.irpfTotal ? '−' : '' }}{{ eur(totals.irpfTotal) }}</span></div>
        <div class="t-total"><span>Total</span><strong>{{ eur(totals.total) }}</strong></div>
      </div>
    </div>

    <!-- Datos de pago: debajo después del total con margen -->
    <div v-if="!isQuote && d.showPaymentInfo && (d.paymentText || (company.iban && (!doc.paymentMethod || doc.paymentMethod === 'transfer')))" class="paper-pay">
      <span class="paper-label">Datos de pago</span>
      <p v-if="d.paymentText" class="paper-notes">{{ d.paymentText }}</p>
      <p v-if="company.iban && (!doc.paymentMethod || doc.paymentMethod === 'transfer')" class="iban">{{ company.iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim() }}</p>
    </div>

    <footer class="paper-foot">
      <span class="legal">{{ d.footerText || company.invoiceFooter || `${issuer.name} · NIF ${issuer.nif}` }}</span>
      <span v-if="doc.verifactu" class="hash mono" :title="doc.verifactu.hash">Huella {{ doc.verifactu.hash.slice(0, 16) }}…</span>
    </footer>
  </article>
</template>

<style scoped>
.head-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
}

.vf {
  text-align: right;
  flex-direction: row-reverse;
}

.iban {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--p-text);
}

.legal {
  white-space: pre-line;
}

/* Clásica: título a la izquierda y QR a la derecha, bajo el doble filete */
.l-classic .head-right {
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-start;
  margin-top: 18px;
}

.vf div {
  max-width: 150px;
  font-size: 10.5px;
  line-height: 1.35;
  color: var(--p-text-3);
}

/* Cabecera de color: la leyenda VeriFactu en el color de texto sobre el acento */
.l-bold .vf div {
  color: color-mix(in srgb, var(--p-on-accent) 80%, transparent);
}

.muted-p {
  color: var(--p-text-3);
}

.rect {
  margin-top: 24px;
  padding: 10px 14px;
  color: #9a3412;
  background: #fff7ed;
  border-radius: 8px;
}

.op-date {
  margin-top: 16px;
  color: var(--p-text-2);
}

.t-row small {
  margin-left: 4px;
  font-size: 11.5px;
  color: var(--p-text-3);
}

.hash {
  font-size: 10.5px;
}

/* En móvil la tabla se desplaza dentro de la hoja, nunca la página */
.lines-wrap {
  overflow-x: auto;
}

.lines-wrap .paper-lines {
  min-width: 520px;
}

@media print {
  .lines-wrap {
    overflow: visible;
  }

  .lines-wrap .paper-lines {
    min-width: 0;
  }
}

@media (max-width: 767px) {
  .head-right {
    align-items: flex-start;
  }

  .vf {
    flex-direction: row;
    text-align: left;
  }
}
</style>
