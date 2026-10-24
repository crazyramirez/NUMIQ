<script setup lang="ts">
import type { MenuItem } from '~/components/ui/Menu.vue'
import type { PaperDoc } from './Paper.vue'
import type { LinkCandidate, LinkCandidatesResult, SalesInvoiceLink, SalesSourceLink } from '#shared/types/sales-links'

type Doc = PaperDoc & {
  id: number
  contactId: number | null
  total: number
  paidTotal: number
  taxBase: number
  vatTotal: number
  sourceId: number | null
  invoices: SalesInvoiceLink[]
  source: SalesSourceLink | null
  rectifiesId: number | null
  payments: Array<{ id: number, amount: number, date: string, method: string, notes: string | null }>
  contact: (PaperDoc['contact'] & { id: number, logoUrl?: string | null, phone?: string | null }) | null
  verifactu: { hash: string, qrUrl: string, status: string, invoiceType: string, generatedAt: string, sentAt: string | null, error: string | null } | null
  imported: boolean
  fileId: number | null
  publicToken: string | null
  viewedAt: string | null
  viewCount: number
  emails: Array<{ id: number, kind: 'document' | 'reminder', to: string, subject: string, status: 'sent' | 'failed', error: string | null, withPdf: boolean, createdAt: string }>
  attachments: Array<{ id: number, originalName: string, mime: string, size: number, createdAt: string }>
  canEdit?: boolean
  hasVerifactu?: boolean
  prev?: { id: number, number: string | null } | null
  next?: { id: number, number: string | null } | null
}

const props = defineProps<{ id: number }>()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const { verifactu } = useMe()

const [{ data: doc, refresh, error }, { data: company }, { data: design }] = await Promise.all([
  useFetch<Doc>(`/api/sales/${props.id}`),
  useFetch<Record<string, any>>('/api/companies/current'),
  useFetch<{ design: InvoiceDesign, logoUrl: string | null }>('/api/invoice-design'),
])

if (error.value) throw createError({ statusCode: 404, statusMessage: 'Documento no encontrado', fatal: true })

// Navegación con teclado: Flecha izquierda (anterior) y Flecha derecha (siguiente)
useEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null
  const isInput = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
  if (isInput) return
  if (e.metaKey || e.ctrlKey || e.shiftKey) return

  if (e.key === 'ArrowLeft' && doc.value?.prev) {
    e.preventDefault()
    router.push(`${base.value}/${doc.value.prev.id}`)
  }
  else if (e.key === 'ArrowRight' && doc.value?.next) {
    e.preventDefault()
    router.push(`${base.value}/${doc.value.next.id}`)
  }
})

const VF_STATUS: Record<string, { label: string, tone: 'brand' | 'success' | 'warning' | 'danger' | 'info' }> = {
  pending: { label: 'Pendiente de envío', tone: 'brand' },
  sent: { label: 'Enviando', tone: 'info' },
  accepted: { label: 'Aceptado AEAT', tone: 'success' },
  accepted_with_errors: { label: 'Aceptado con avisos', tone: 'warning' },
  rejected: { label: 'Rechazado AEAT', tone: 'danger' },
}

const isQuote = computed(() => doc.value?.kind === 'quote' || doc.value?.kind === 'proforma')
const base = computed(() => (isQuote.value ? '/presupuestos' : '/facturas'))
const { href: listHref, back } = useBackTo(base)
const kindLabel = computed(() => KIND_LABEL[doc.value?.kind ?? 'invoice'] ?? 'Factura')
const isOpen = computed(() => ['issued', 'sent', 'partial'].includes(doc.value?.status ?? ''))
const overdue = computed(() => !isQuote.value && isOpen.value && !!doc.value?.dueDate && daysUntil(doc.value.dueDate) < 0)
const status = computed(() => salesStatus(doc.value?.kind ?? '', doc.value?.status ?? '', overdue.value))
const remaining = computed(() => round2((doc.value?.total ?? 0) - (doc.value?.paidTotal ?? 0)))
const paidPct = computed(() => (doc.value?.total ? Math.min(100, (doc.value.paidTotal / doc.value.total) * 100) : 0))
const alreadySent = computed(() => doc.value?.status === 'sent' || !!doc.value?.emails.some(m => m.kind === 'document' && m.status === 'sent'))
const canEdit = computed(() => {
  if (!doc.value) return false
  if (doc.value.canEdit !== undefined) return doc.value.canEdit
  if (doc.value.status === 'draft') return true
  if (isQuote.value) return !['invoiced'].includes(doc.value.status)
  if (doc.value.imported) return true
  return !doc.value.verifactu
})

useHead({ title: computed(() => `${kindLabel.value} ${doc.value?.number ?? 'borrador'} · NUMIQ`) })

const busy = ref<string | null>(null)
// Ruta como string: evita que la inferencia de rutas tipadas de $fetch se dispare con plantillas
const post = (path: string, body?: Record<string, unknown>) => $fetch(path, { method: 'POST', body })
const paymentOpen = ref(false)
const editingPayment = ref<Doc['payments'][number] | null>(null)
function openPayment(payment: Doc['payments'][number] | null = null) {
  editingPayment.value = payment
  paymentOpen.value = true
}
const sendOpen = ref(false)
const sendReminder = ref(false)
const pdfUrl = computed(() => `/api/sales/${props.id}/pdf`)

function openSend(reminder = false) {
  sendReminder.value = reminder
  sendOpen.value = true
}

async function act(name: string, fn: () => Promise<unknown>, ok?: string) {
  busy.value = name
  try {
    await fn()
    if (ok) toast.success(ok)
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo completar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function issue() {
  const ok = await confirm({
    title: `¿Emitir ${isQuote.value ? 'el presupuesto' : 'la factura'}?`,
    body: isQuote.value ? 'Se le asignará número y podrás enviarlo al cliente.' : `Total ${eur(doc.value?.total)}. Se le asignará número correlativo y quedará lista para enviar.`,
    confirmLabel: 'Emitir',
  })
  if (ok) await act('issue', () => post(`/api/sales/${props.id}/issue`), 'Documento emitido')
}

async function remove() {
  const isQ = isQuote.value
  const hasPayments = (doc.value?.payments?.length ?? 0) > 0
  const ok = await confirm({
    title: `¿Eliminar ${isQ ? 'el presupuesto' : 'la factura'} definitivamente?`,
    body: `Se borrará de forma permanente de la base de datos junto con sus líneas y cobros.${hasPayments ? ' Los movimientos bancarios que estuvieran conciliados quedarán de nuevo pendientes de conciliar.' : ''}`,
    confirmLabel: 'Eliminar definitivamente',
    danger: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/sales/${props.id}`, { method: 'DELETE' })
    toast.success(isQ ? 'Presupuesto eliminado' : 'Factura eliminada')
    await navigateTo(listHref.value)
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
}

async function convert() {
  busy.value = 'convert'
  try {
    const r = await $fetch<{ id: number }>(`/api/sales/${props.id}/convert`, { method: 'POST' })
    toast.success('Factura creada desde el presupuesto', 'Revísala y emítela.')
    await navigateTo(`/facturas/${r.id}/editar`)
  }
  catch (err) {
    toast.error('No se pudo convertir', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

const setStatus = (s: string, ok: string) => act(s, () => post(`/api/sales/${props.id}/status`, { status: s }), ok)

async function markPending() {
  const ok = await confirm({
    title: '¿Marcar la factura como pendiente de cobro?',
    body: 'Se quitarán sus cobros registrados y quedará todo el importe pendiente. Los movimientos bancarios vinculados se conservarán y quedarán pendientes de conciliar.',
    confirmLabel: 'Marcar como pendiente',
  })
  if (ok) await setStatus('pending', 'Factura pendiente de cobro')
}

async function removePayment(payment: Doc['payments'][number]) {
  const ok = await confirm({ title: '¿Eliminar este cobro?', body: `Se quitará el cobro de ${eur(payment.amount)} y se recalculará lo pendiente. Si está conciliado, el movimiento bancario quedará pendiente de conciliar.`, confirmLabel: 'Eliminar cobro', danger: true })
  const path = `/api/sales/${props.id}/payments/${payment.id}`
  if (ok) await act(`payment-${payment.id}`, () => ($fetch as any)(path, { method: 'DELETE' }), 'Cobro eliminado')
}

function print() {
  window.print()
}

const publicUrl = computed(() => (doc.value?.publicToken && import.meta.client ? `${window.location.origin}/p/${doc.value.publicToken}` : null))

async function copyLink() {
  if (!publicUrl.value) return
  const ok = await copyToClipboard(publicUrl.value)
  if (ok) toast.success('Enlace copiado', 'Tu cliente podrá verla, descargarla y ver cómo pagar.')
  else toast.error('No se pudo copiar el enlace')
}

/** WhatsApp con el enlace a la factura: al móvil del cliente si lo tenemos; si no, eliges el chat */
function shareWhatsapp() {
  const d = doc.value
  if (!d || !publicUrl.value) return
  const who = d.contact?.name ? `Hola, ${d.contact.name.split(' ')[0]}:` : 'Hola:'
  const what = `te envío la factura ${d.number ?? ''} por ${eur(d.total - d.paidTotal)}. Puedes verla, descargarla y pagarla aquí:`
  const text = `${who} ${what}\n${publicUrl.value}`
  let phone = (d.contact?.phone ?? '').replace(/[^\d+]/g, '')
  if (/^[67]\d{8}$/.test(phone)) phone = `34${phone}`
  phone = phone.replace(/^\+/, '')
  window.open(`https://wa.me/${/^\d{10,15}$/.test(phone) ? phone : ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}

async function copyHash() {
  if (!doc.value?.verifactu) return
  const ok = await copyToClipboard(doc.value.verifactu.hash)
  if (ok) toast.info('Huella copiada')
  else toast.error('No se pudo copiar la huella')
}

// ─── Presupuesto ↔ factura ───
const linkOpen = ref(false)
const canLink = computed(() => !!doc.value && doc.value.status !== 'draft' && (isQuote.value || doc.value.kind === 'invoice'))
const linkedDocs = computed(() => (isQuote.value ? doc.value?.invoices ?? [] : doc.value?.source ? [doc.value.source] : []))
const suggestion = ref<LinkCandidate | null>(null)
const DISMISSED_KEY = 'numiq-link-dismissed'

function dismissedLinks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')
  }
  catch {
    return []
  }
}

/** Al abrir el documento: si hay una pareja muy probable sin vincular, se ofrece */
async function loadSuggestion() {
  suggestion.value = null
  const d = doc.value
  if (!d || !canLink.value || linkedDocs.value.length || d.status === 'rejected') return
  try {
    const r = await $fetch<LinkCandidatesResult>(`/api/sales/${d.id}/link-candidates?auto=1` as string)
    const best = r.candidates[0]
    if (best && !dismissedLinks().includes(`${d.id}:${best.id}`)) suggestion.value = best
  }
  catch {
    // Solo es una sugerencia
  }
}
onMounted(loadSuggestion)
watch(() => props.id, loadSuggestion)

const suggestionWhy = computed(() => {
  const ok = suggestion.value?.reasons.filter(r => r.tone === 'ok').map(r => r.text.charAt(0).toLowerCase() + r.text.slice(1)) ?? []
  return ok.length ? new Intl.ListFormat('es', { type: 'conjunction' }).format(ok) : ''
})

function dismissSuggestion() {
  const s = suggestion.value
  if (!s) return
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedLinks(), `${props.id}:${s.id}`].slice(-300)))
  }
  catch {
    // Sin almacenamiento: se descarta solo ahora
  }
  suggestion.value = null
}

async function quickLink() {
  const s = suggestion.value
  if (!s) return
  await act('link', () => post(`/api/sales/${props.id}/link`, { targetId: s.id }), isQuote.value ? `Vinculado a la factura ${s.number ?? ''}` : `Vinculada al presupuesto ${s.number ?? ''}`)
  await loadSuggestion()
}

async function unlinkDoc(target: { id: number, number: string | null }) {
  const ok = await confirm({
    title: `¿Desvincular ${target.number ?? (isQuote.value ? 'la factura' : 'el presupuesto')}?`,
    body: 'Los dos documentos se quedan como están: solo dejan de estar relacionados.',
    confirmLabel: 'Desvincular',
  })
  if (!ok) return
  await act(`unlink-${target.id}`, () => post(`/api/sales/${props.id}/unlink`, { targetId: target.id }), 'Vínculo eliminado')
  await loadSuggestion()
}

async function linksChanged() {
  await refresh()
  await loadSuggestion()
}

const moreItems = computed<MenuItem[]>(() => {
  const d = doc.value
  if (!d) return []
  const items: MenuItem[] = [
    { label: 'Ver PDF', icon: 'ph:file-pdf', onClick: () => window.open(pdfUrl.value, '_blank', 'noopener') },
    { label: 'Imprimir', icon: 'ph:printer', onClick: print },
  ]
  if (canLink.value) {
    items.push({
      label: isQuote.value ? 'Vincular a una factura…' : d.source ? 'Cambiar presupuesto vinculado…' : 'Vincular a un presupuesto…',
      icon: 'ph:link',
      onClick: () => { linkOpen.value = true },
    })
  }
  // Enlace para el cliente: solo facturas (el presupuesto se manda por email con su PDF)
  if (!isQuote.value && d.status !== 'draft' && publicUrl.value) {
    items.push(
      { label: 'Enviar por WhatsApp', icon: 'ph:whatsapp-logo', onClick: shareWhatsapp },
      { label: 'Copiar enlace para el cliente', icon: 'ph:link-simple', onClick: copyLink },
      { label: 'Ver como el cliente', icon: 'ph:eye', onClick: () => window.open(publicUrl.value!, '_blank', 'noopener') },
    )
  }
  if (overdue.value) items.push({ label: 'Enviar recordatorio de pago', icon: 'ph:bell-ringing', onClick: () => openSend(true) })
  if (!isQuote.value && d.status !== 'draft') {
    if (canEdit.value) items.unshift({ label: 'Editar factura', icon: 'ph:pencil-simple', to: `${base.value}/${d.id}/editar` })
    if (['paid', 'partial'].includes(d.status)) items.push({ label: 'Marcar como pendiente de cobro', icon: 'ph:arrow-u-up-left', onClick: markPending })
    if (d.status === 'issued') items.push({ label: 'Marcar como enviada', icon: 'ph:paper-plane-tilt', onClick: () => setStatus('sent', 'Marcada como enviada') })
    if (d.status === 'sent') items.push({ label: 'Marcar como no enviada', icon: 'ph:arrow-u-up-left', onClick: () => setStatus('issued', 'Marcada como no enviada') })
    items.push({ label: 'Crear rectificativa', icon: 'ph:arrow-counter-clockwise', to: `/facturas/nueva?rectifica=${d.id}` })
    if (d.kind === 'invoice') items.push({ label: 'Repetir cada mes…', icon: 'ph:arrows-clockwise', to: `/recurrentes?desde=${d.id}` })
  }
  if (isQuote.value && !['draft', 'invoiced'].includes(d.status)) {
    items.push({ divider: true }, { heading: 'Estado' }, ...QUOTE_STATUS_OPTIONS.map(o => ({
      label: o.label,
      icon: o.icon,
      active: d.status === o.value,
      onClick: () => (d.status === o.value ? undefined : setStatus(o.value, `Presupuesto ${o.label.toLowerCase()}`)),
    })), { divider: true })
  }
  if (d.contactId) items.push({ label: 'Ver ficha del cliente', icon: 'ph:user', to: `/clientes/${d.contactId}` })
  items.push({ divider: true }, { label: isQuote.value ? 'Eliminar presupuesto' : 'Eliminar factura', icon: 'ph:trash', danger: true, onClick: remove })
  return items
})
</script>

<template>
  <div v-if="doc && company" class="view page">
    <div class="v-head no-print">
      <div class="head-nav">
        <UiButton variant="ghost" square icon="ph:arrow-left" aria-label="Volver al listado" title="Volver al listado" @click="back()" />
        <div class="pager-btns" role="navigation" aria-label="Navegación entre documentos">
          <UiButton
            variant="ghost"
            size="sm"
            icon="ph:caret-left"
            :to="doc.prev ? `${base}/${doc.prev.id}` : undefined"
            :disabled="!doc.prev"
            :aria-label="doc.prev ? `${kindLabel} anterior: ${doc.prev.number ?? 'Borrador'}` : 'No hay anterior'"
            :title="doc.prev ? `${kindLabel} anterior (${doc.prev.number ?? 'Borrador'})` : 'No hay anterior'"
            class="pager-btn"
          >
            <span class="hide-sm">Anterior</span>
          </UiButton>
          <UiButton
            variant="ghost"
            size="sm"
            icon-right="ph:caret-right"
            :to="doc.next ? `${base}/${doc.next.id}` : undefined"
            :disabled="!doc.next"
            :aria-label="doc.next ? `${kindLabel} siguiente: ${doc.next.number ?? 'Borrador'}` : 'No hay siguiente'"
            :title="doc.next ? `${kindLabel} siguiente (${doc.next.number ?? 'Borrador'})` : 'No hay siguiente'"
            class="pager-btn"
          >
            <span class="hide-sm">Siguiente</span>
          </UiButton>
        </div>
      </div>
      <div class="grow">
        <p class="eyebrow">{{ kindLabel }}</p>
        <h1 class="row gap-3 wrap">
          <span class="num">{{ doc.number ?? 'Borrador' }}</span>
          <UiBadge :tone="status.tone" dot>{{ status.label }}</UiBadge>
        </h1>
      </div>
      <div class="page-actions">
        <SalesInvoiceLinks v-if="isQuote && doc.invoices.length" :invoices="doc.invoices" size="md" />
        <template v-if="canEdit">
          <UiButton icon="ph:pencil-simple" :to="`${base}/${doc.id}/editar`">Editar</UiButton>
        </template>
        <template v-if="doc.status !== 'draft'">
          <UiButton icon="ph:download-simple" :to="`${pdfUrl}?download=1`" external class="hide-sm">PDF</UiButton>
          <UiButton :icon="alreadySent ? 'ph:arrow-clockwise' : 'ph:paper-plane-tilt'" @click="openSend()">{{ alreadySent ? 'Reenviar' : 'Enviar' }}</UiButton>
        </template>
        <UiButton v-if="doc.status === 'draft'" variant="primary" icon="ph:seal-check" :loading="busy === 'issue'" @click="issue">Emitir</UiButton>
        <UiButton v-else-if="!isQuote && isOpen" variant="primary" icon="ph:hand-coins" @click="openPayment()">Registrar cobro</UiButton>
        <UiButton v-else-if="!isQuote && doc.status === 'paid'" icon="ph:arrow-u-up-left" :loading="busy === 'pending'" @click="markPending">Marcar como pendiente</UiButton>
        <UiButton v-else-if="isQuote && !['invoiced', 'rejected'].includes(doc.status)" variant="primary" icon="ph:receipt" :loading="busy === 'convert'" @click="convert">Convertir en factura</UiButton>
        <UiMenu :items="moreItems" :width="240">
          <template #default="{ toggle }">
            <UiButton square icon="ph:dots-three-bold" aria-label="Más acciones" @click="toggle" />
          </template>
        </UiMenu>
      </div>
    </div>

    <div class="v-body">
      <div class="print-root">
        <SalesPaper :doc="doc" :company="company as any" :design="design?.design" :logo-url="design?.logoUrl" />
      </div>

      <aside class="v-side no-print">
        <section class="card st">
          <div class="st-top">
            <span class="muted">Total</span>
            <UiBadge :tone="status.tone">{{ status.label }}</UiBadge>
          </div>
          <p class="st-total num">{{ eur(doc.total) }}</p>
          <p v-if="isQuote && doc.status === 'invoiced' && !doc.invoices.length" class="muted small">
            No hay una factura vinculada a este presupuesto.
            <button type="button" class="link" @click="linkOpen = true">Buscar su factura</button>
          </p>
          <template v-if="!isQuote && doc.status !== 'draft'">
            <div class="bar" role="progressbar" :aria-valuenow="Math.round(paidPct)" aria-valuemin="0" aria-valuemax="100" aria-label="Cobrado">
              <span :style="{ width: `${paidPct}%` }" />
            </div>
            <div class="st-row"><span class="muted">Cobrado</span><span class="num">{{ eur(doc.paidTotal) }}</span></div>
            <div v-if="remaining > 0" class="st-row"><span class="muted">Pendiente</span><strong class="num">{{ eur(remaining) }}</strong></div>
          </template>
          <div v-if="doc.dueDate && doc.status !== 'paid'" class="st-due" :class="{ late: overdue }">
            <Icon :name="overdue ? 'ph:warning-circle-fill' : 'ph:calendar-blank'" />
            <span>{{ isQuote ? 'Válido hasta' : overdue ? 'Venció' : 'Vence' }} {{ fdate(doc.dueDate) }} · {{ relDays(doc.dueDate) }}</span>
          </div>
          <div v-if="doc.status === 'paid'" class="st-due ok">
            <Icon name="ph:check-circle-fill" /><span>Cobrada por completo</span>
          </div>
          <p v-if="!isQuote && doc.status !== 'draft' && (doc.status !== 'paid' || doc.viewedAt)" class="st-seen" :class="{ on: doc.viewedAt }">
            <Icon :name="doc.viewedAt ? 'ph:eye-fill' : 'ph:eye-slash'" aria-hidden="true" />
            <span v-if="doc.viewedAt">Visto por el cliente {{ relTime(doc.viewedAt) }}{{ doc.viewCount > 1 ? ` · ${doc.viewCount} visitas` : '' }}</span>
            <span v-else>El cliente aún no lo ha abierto</span>
          </p>
        </section>

        <section v-if="suggestion" class="card sugg" aria-live="polite">
          <div class="sg-top">
            <span class="sg-ic" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
            <p class="strong grow">{{ isQuote ? '¿Ya está facturado?' : '¿Sale de un presupuesto?' }}</p>
            <UiButton variant="ghost" size="sm" square icon="ph:x" aria-label="Descartar sugerencia" title="No es este" @click="dismissSuggestion" />
          </div>
          <p class="sg-text">
            {{ isQuote ? 'La factura' : 'El presupuesto' }}
            <NuxtLink :to="`${isQuote ? '/facturas' : '/presupuestos'}/${suggestion.id}`" class="link num">{{ suggestion.number }}</NuxtLink>
            ({{ eur(suggestion.total) }}, {{ fdate(suggestion.issueDate) }}) encaja{{ suggestionWhy ? `: ${suggestionWhy}` : '' }}.
          </p>
          <div class="sg-actions">
            <UiButton size="sm" variant="primary" icon="ph:link" :loading="busy === 'link'" @click="quickLink">Vincular</UiButton>
            <UiButton size="sm" variant="ghost" @click="linkOpen = true">Ver otras</UiButton>
          </div>
        </section>

        <section v-if="canLink && linkedDocs.length" class="card links">
          <h2 class="section-title">{{ isQuote ? (linkedDocs.length > 1 ? 'Facturas vinculadas' : 'Factura vinculada') : 'Presupuesto de origen' }}</h2>
          <ul>
            <li v-for="l in linkedDocs" :key="l.id">
              <span class="l-ic" aria-hidden="true"><Icon :name="isQuote ? 'ph:receipt' : 'ph:file-text'" /></span>
              <NuxtLink :to="`${isQuote ? '/facturas' : '/presupuestos'}/${l.id}`" class="grow min0 l-doc">
                <p class="strong num truncate">{{ l.number ?? 'Sin número' }}</p>
                <p class="muted small">{{ salesStatus(isQuote ? 'invoice' : (doc.source?.kind ?? 'quote'), l.status, false).label }}</p>
              </NuxtLink>
              <UiButton variant="ghost" size="sm" square icon="ph:link-break" :aria-label="`Desvincular ${l.number ?? ''}`" title="Desvincular" :loading="busy === `unlink-${l.id}`" :disabled="!!busy" @click="unlinkDoc(l)" />
            </li>
          </ul>
          <button v-if="isQuote" type="button" class="link small l-more" @click="linkOpen = true"><Icon name="ph:plus" aria-hidden="true" /> Vincular otra factura</button>
        </section>

        <section v-if="doc.verifactu" class="card vf">
          <div class="vf-top">
            <span class="vf-logo">VERI<span>*</span>FACTU</span>
            <UiBadge :tone="VF_STATUS[doc.verifactu.status]?.tone ?? 'brand'" size="sm">{{ VF_STATUS[doc.verifactu.status]?.label ?? 'Registrado' }}</UiBadge>
          </div>
          <p class="vf-text">Registro de facturación encadenado ({{ doc.verifactu.invoiceType }}) generado el {{ fdate(doc.verifactu.generatedAt.slice(0, 10)) }}{{ doc.verifactu.sentAt ? ` y enviado a la AEAT el ${fdate(doc.verifactu.sentAt)}` : '' }}.</p>
          <p v-if="doc.verifactu.error" class="vf-err"><Icon name="ph:warning-fill" aria-hidden="true" /> {{ doc.verifactu.error }}</p>
          <button type="button" class="hash mono" title="Copiar huella" @click="copyHash">
            {{ doc.verifactu.hash }}
            <Icon name="ph:copy" />
          </button>
          <a :href="doc.verifactu.qrUrl" target="_blank" rel="noopener" class="link vf-link">Cotejar en la AEAT <Icon name="ph:arrow-square-out" /></a>
        </section>

        <section v-if="doc.imported" class="card imp">
          <div class="imp-top">
            <span class="imp-ic" aria-hidden="true"><Icon name="ph:download-simple" /></span>
            <div class="grow">
              <p class="strong">{{ isQuote ? `${doc.kind === 'proforma' ? 'Proforma importada' : 'Presupuesto importado'}` : 'Factura importada' }}</p>
              <p class="muted small">{{ isQuote ? 'Hecho con otro programa: conserva su número.' : `Emitida con otro programa: conserva su número${verifactu ? ' y no genera registro VeriFactu en NUMIQ' : ''}.` }}</p>
            </div>
          </div>
          <a v-if="doc.fileId" :href="`/api/files/${doc.fileId}`" target="_blank" rel="noopener" class="link small imp-link"><Icon name="ph:file-text" aria-hidden="true" /> Ver el documento original</a>
        </section>

        <SalesAttachments :doc-id="doc.id" :items="doc.attachments" @changed="refresh" />

        <section v-if="doc.emails.length" class="card mails">
          <h2 class="section-title">Envíos</h2>
          <ul>
            <li v-for="m in doc.emails" :key="m.id" :title="m.error ?? m.subject">
              <span class="m-ic" :class="m.status"><Icon :name="m.status === 'failed' ? 'ph:warning-bold' : m.kind === 'reminder' ? 'ph:bell-ringing-bold' : 'ph:paper-plane-tilt-bold'" /></span>
              <div class="grow min0">
                <p class="strong truncate">{{ m.kind === 'reminder' ? 'Recordatorio' : 'Enviado' }} a {{ m.to }}</p>
                <p class="muted small">{{ m.status === 'failed' ? 'No se pudo enviar' : fdate(m.createdAt) }}{{ m.withPdf ? ' · con PDF' : '' }}</p>
              </div>
            </li>
          </ul>
        </section>

        <section v-if="doc.payments.length" class="card pays">
          <h2 class="section-title">Cobros</h2>
          <ul>
            <li v-for="p in doc.payments" :key="p.id">
              <span class="p-ic"><Icon name="ph:arrow-down-left-bold" /></span>
              <div class="grow">
                <p class="num strong">{{ eur(p.amount) }}</p>
                <p class="muted small">{{ fdate(p.date) }} · {{ PAYMENT_METHODS[p.method] }}</p>
              </div>
              <template v-if="!isQuote && ['issued', 'sent', 'partial', 'paid'].includes(doc.status)">
                <UiButton variant="ghost" size="sm" square icon="ph:pencil-simple" :aria-label="`Editar cobro de ${eur(p.amount)}`" :disabled="!!busy" @click="openPayment(p)" />
                <UiButton variant="ghost" size="sm" square icon="ph:trash" :aria-label="`Eliminar cobro de ${eur(p.amount)}`" :loading="busy === `payment-${p.id}`" :disabled="!!busy" @click="removePayment(p)" />
              </template>
            </li>
          </ul>
        </section>

        <NuxtLink v-if="doc.contact" :to="`/clientes/${doc.contactId}`" class="card cust">
          <UiAvatar :name="doc.contact.name" :size="36" :src="doc.contact.logoUrl" contain />
          <div class="grow min0">
            <p class="strong truncate">{{ doc.contact.name }}</p>
            <p class="muted small truncate">{{ doc.contact.email || doc.contact.nif }}</p>
          </div>
          <Icon name="ph:caret-right" class="muted" />
        </NuxtLink>
      </aside>
    </div>

    <SalesPaymentModal v-if="!isQuote && (isOpen || doc.status === 'paid')" v-model="paymentOpen" :document-id="doc.id" :remaining="round2(remaining + (editingPayment?.amount ?? 0))" :number="doc.number" :payment="editingPayment" @saved="refresh" />
    <SalesLinkModal v-if="canLink" v-model="linkOpen" :doc-id="doc.id" :is-quote="isQuote" :number="doc.number" @changed="linksChanged" />
    <SalesSendModal v-if="doc.status !== 'draft'" v-model="sendOpen" :doc="doc" :company-name="company.tradeName || company.legalName" :reminder="sendReminder" @sent="refresh" />
  </div>
</template>

<style scoped>
.view {
  max-width: 1320px;
}

.v-head {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  flex-wrap: wrap;
  margin-bottom: var(--s-6);
}

.head-nav {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.pager-btns {
  display: inline-flex;
  align-items: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 2px;
  gap: 2px;
}

.pager-btn {
  height: 32px;
  font-size: var(--text-xs);
  font-weight: 550;
  border-radius: calc(var(--radius-md) - 2px);
  padding: 0 9px;
}

.pager-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.v-head h1 {
  font-size: var(--text-2xl);
  letter-spacing: -0.02em;
}

/* El número nunca se parte («F2026-/0052»): si no cabe con los botones, son los botones los que bajan */
.v-head .grow {
  flex: 1 1 auto;
}

.v-head h1 .num {
  white-space: nowrap;
}

.v-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--s-6);
  align-items: start;
}

.v-side {
  position: sticky;
  top: calc(var(--topbar-h) + var(--s-5));
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.v-side .card {
  padding: var(--s-5);
}

.st-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.st-total {
  margin: 6px 0 var(--s-4);
  font-size: var(--text-3xl);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.bar {
  height: 6px;
  margin-bottom: var(--s-3);
  overflow: hidden;
  background: var(--surface-active);
  border-radius: var(--r-full);
}

.bar span {
  display: block;
  height: 100%;
  background: var(--success-solid);
  border-radius: inherit;
  transition: width 600ms var(--ease-out);
}

.st-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
}

.st-due {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--s-4);
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-md);
}

.st-due.late {
  color: var(--danger);
  background: var(--danger-soft);
}

.st-due.ok {
  color: var(--success);
  background: var(--success-soft);
}

.vf-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vf-logo {
  font-weight: 800;
  letter-spacing: 0.06em;
  font-size: var(--text-sm);
}

.vf-logo span {
  color: var(--brand);
}

.vf-text {
  margin: var(--s-2) 0 var(--s-3);
  font-size: var(--text-sm);
  color: var(--text-3);
}

.hash {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  font-size: 11px;
  line-height: 1.45;
  text-align: left;
  word-break: break-all;
  color: var(--text-2);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  transition: border-color var(--t-fast);
}

.hash:hover {
  border-color: var(--border-strong);
}

.hash :deep(svg) {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: var(--text-3);
}

.vf-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: var(--s-3);
  font-size: var(--text-sm);
}

.mails ul {
  margin-top: var(--s-3);
  padding: 0;
  list-style: none;
}

.mails li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.mails li + li {
  border-top: 1px solid var(--border-subtle);
}

.m-ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 50%;
}

.m-ic.failed {
  color: var(--danger);
  background: var(--danger-soft);
}

.pays ul {
  margin-top: var(--s-3);
  padding: 0;
  list-style: none;
}

.pays li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.pays li + li {
  border-top: 1px solid var(--border-subtle);
}

.p-ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--success);
  background: var(--success-soft);
  border-radius: 50%;
}

.sugg {
  background: var(--ai-soft), var(--surface);
  border-color: color-mix(in srgb, var(--ai-text) 25%, var(--border));
}

.sg-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sg-ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  color: #fff;
  background: var(--ai-grad);
  border-radius: 50%;
}

.sg-text {
  margin-top: var(--s-3);
  font-size: var(--text-sm);
  color: var(--text-2);
}

.sg-actions {
  display: flex;
  gap: var(--s-2);
  margin-top: var(--s-4);
}

.links ul {
  margin-top: var(--s-3);
  padding: 0;
  list-style: none;
}

.links li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.links li + li {
  border-top: 1px solid var(--border-subtle);
}

.l-ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 50%;
}

.l-doc {
  color: inherit;
}

.l-doc:hover .strong {
  color: var(--brand-text);
}

.l-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: var(--s-2);
}

.strong {
  font-weight: 600;
}

.small {
  font-size: var(--text-xs);
}

.min0 {
  min-width: 0;
}

.cust {
  display: flex;
  align-items: center;
  gap: 12px;
  transition: box-shadow var(--t-base), border-color var(--t-fast);
}

.cust:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

@media (max-width: 640px) {
  .hide-sm {
    display: none;
  }

  .head-nav {
    width: 100%;
    justify-content: space-between;
  }

  .v-head .grow {
    flex-basis: 100%;
  }

  .v-head .page-actions {
    width: 100%;
  }

  /* La acción principal (Emitir, Registrar cobro, Convertir…) arriba y a todo el ancho; las demás debajo */
  .v-head .page-actions > .btn {
    flex: 1;
  }

  .v-head .page-actions > .btn-primary {
    order: -1;
    flex-basis: 100%;
  }

  .pager-btn {
    height: 40px;
    padding: 0 12px;
  }
}

/* Tarjetas laterales encima del documento, en dos columnas que se rellenan sin huecos */
@media (max-width: 1180px) {
  .v-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .v-side {
    position: static;
    order: -1;
    display: block;
    columns: 2 300px;
    column-gap: var(--s-4);
  }

  .v-side > * {
    break-inside: avoid;
    margin-bottom: var(--s-4);
  }
}
.vf-err {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  font-size: var(--text-xs);
  color: var(--danger);
}

.st-seen {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--s-3);
  font-size: var(--text-xs);
  color: var(--text-4);
}

.st-seen.on {
  color: var(--text-3);
}

.st-seen.on :deep(svg) {
  color: var(--brand);
}

.imp-top {
  display: flex;
  gap: var(--s-3);
}

.imp-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  color: var(--info);
  background: var(--info-soft);
  border-radius: var(--r-md);
}

.imp-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-3);
}
</style>
