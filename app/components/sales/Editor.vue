<script setup lang="ts">
/**
 * Editor de facturas, presupuestos y rectificativas sobre la propia hoja: lo que ves es lo que se
 * emite. Cliente y conceptos salen de tus fichas y del catálogo, y todo se puede retocar en línea.
 * Los totales se calculan con el mismo código que usa el servidor (shared/utils/tax.ts).
 */
import type { CatalogItem } from './ConceptInput.vue'
import type { CtxItem, CtxSpec } from '~/composables/useContextMenu'

type Kind = 'invoice' | 'quote' | 'proforma' | 'rectifying'

interface Line {
  key: number
  itemId: number | null
  description: string
  quantity: number | null
  unitPrice: number | null
  discountPct: number | null
  vatRate: number
  surchargeRate: number
  irpfApplies: boolean
}

interface Contact {
  id: number
  name: string
  kind: 'company' | 'person'
  logoUrl: string | null
  nif: string | null
  email: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string
  paymentTermsDays: number | null
  irpfRate: number | null
  equivalenceSurcharge: boolean
}

interface SalesDoc {
  id: number
  kind: Kind
  status: string
  number: string | null
  seriesId: number | null
  contactId: number | null
  customerReference: string | null
  issueDate: string
  dueDate: string | null
  operationDate: string | null
  irpfRate: number
  paymentMethod: string | null
  description: RichDoc | null
  notes: string | null
  terms: string | null
  rectifiesId: number | null
  rectificationCode: string | null
  rectificationReason: string | null
  lines: Array<Omit<Line, 'key'> & { id: number }>
  attachments?: Array<{ id: number, originalName: string, mime: string, size: number, createdAt: string }>
  imported?: boolean
  verifactu?: unknown
  canEdit?: boolean
}

const props = defineProps<{ kind: Kind, id?: number }>()

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const { verifactu } = useMe()

const isQuote = computed(() => props.kind === 'quote' || props.kind === 'proforma')
const base = computed(() => (isQuote.value ? '/presupuestos' : '/facturas'))
const { href: listHref } = useBackTo(base)
const rectifiesQuery = Number(route.query.rectifica) || null

const [{ data: company }, { data: contacts, refresh: refreshContacts }, { data: items, refresh: refreshItems }, { data: allSeries }, { data: doc }, { data: source }, { data: design }] = await Promise.all([
  useFetch<Record<string, any>>('/api/companies/current'),
  useFetch<Contact[]>('/api/contacts', { query: { role: 'client', limit: 500 } }),
  useFetch<CatalogItem[]>('/api/items'),
  useFetch<Array<{ id: number, kind: string, name: string, prefix: string, nextNumber: string, isDefault: boolean }>>('/api/series'),
  props.id ? useFetch<SalesDoc>(`/api/sales/${props.id}`) : Promise.resolve({ data: ref<SalesDoc | null>(null) }),
  rectifiesQuery ? useFetch<SalesDoc & { number: string, customer: { name: string } | null }>(`/api/sales/${rectifiesQuery}`) : Promise.resolve({ data: ref<(SalesDoc & { number: string }) | null>(null) }),
  useFetch<{ design: InvoiceDesign, logoUrl: string | null }>('/api/invoice-design'),
])

// Una rectificativa se crea a partir de la factura original
const kind = ref<Kind>(source.value ? 'rectifying' : (doc.value?.kind ?? props.kind))

const canEditDoc = computed(() => {
  if (!doc.value) return true
  if (doc.value.canEdit !== undefined) return doc.value.canEdit
  if (doc.value.status === 'draft' || isQuote.value) return true
  if (doc.value.imported) return true
  return !doc.value.verifactu
})

if (doc.value && !canEditDoc.value) {
  toast.error('Esta factura no se puede modificar porque tiene registro VeriFactu. Emite una rectificativa.')
  await navigateTo(`${base.value}/${props.id}`, { replace: true })
}

const isAlreadyIssued = computed(() => !!doc.value && doc.value.status !== 'draft' && !isQuote.value)
// Un presupuesto facturado ya está aceptado: su estado no se toca
const canPickStatus = computed(() => isQuote.value && doc.value?.status !== 'invoiced')

let keySeq = 0
const companyVat = Number(company.value?.defaultVatRate ?? 21)
const blankLine = (): Line => ({ key: ++keySeq, itemId: null, description: '', quantity: 1, unitPrice: null, discountPct: 0, vatRate: companyVat, surchargeRate: 0, irpfApplies: true })

const today = todayISO()
const defaultTerms = Number(company.value?.paymentTermsDays ?? 30)

const form = reactive({
  number: '',
  seriesId: null as number | null,
  contactId: (Number(route.query.cliente) || null) as number | null,
  customerReference: '',
  issueDate: today,
  dueDate: addDaysISO(today, isQuote.value ? 30 : defaultTerms) as string | null,
  operationDate: null as string | null,
  // La retención la decide el cliente al elegirlo (empresa o profesional sí, particular no)
  irpfRate: 0,
  paymentMethod: 'transfer',
  description: null as RichDoc | null,
  notes: isQuote.value ? '' : design.value?.design.defaultNotes ?? '',
  terms: isQuote.value ? design.value?.design.defaultTerms ?? '' : '',
  rectifiesId: null as number | null,
  rectificationCode: 'R1' as string | null,
  rectificationReason: '',
  lines: [blankLine()] as Line[],
  // Presupuestos: pendiente, enviado, aceptado o rechazado (no tienen borrador)
  status: 'issued' as string,
})

if (doc.value) {
  Object.assign(form, {
    number: doc.value.number ?? '',
    seriesId: doc.value.seriesId,
    contactId: doc.value.contactId,
    customerReference: doc.value.customerReference ?? '',
    issueDate: doc.value.issueDate,
    dueDate: doc.value.dueDate,
    operationDate: doc.value.operationDate,
    irpfRate: doc.value.irpfRate,
    paymentMethod: doc.value.paymentMethod ?? 'transfer',
    description: doc.value.description ?? null,
    notes: doc.value.notes ?? '',
    terms: doc.value.terms ?? '',
    rectifiesId: doc.value.rectifiesId,
    rectificationCode: doc.value.rectificationCode ?? 'R1',
    rectificationReason: doc.value.rectificationReason ?? '',
    lines: doc.value.lines.map(({ id: _id, ...l }) => ({ ...l, key: ++keySeq })),
    status: doc.value.status === 'expired' ? 'rejected' : doc.value.status === 'draft' ? 'issued' : doc.value.status,
  })
}
else if (source.value) {
  Object.assign(form, {
    contactId: source.value.contactId,
    customerReference: source.value.customerReference ?? '',
    irpfRate: source.value.irpfRate,
    paymentMethod: source.value.paymentMethod ?? 'transfer',
    rectifiesId: source.value.id,
    notes: `Rectifica la factura ${source.value.number} de ${fdateShort(source.value.issueDate)}.`,
    lines: source.value.lines.map(({ id: _id, ...l }) => ({ ...l, quantity: -(l.quantity ?? 0), key: ++keySeq })),
  })
}

const seriesOptions = computed(() => (allSeries.value ?? []).filter(s => s.kind === kind.value))
if (!form.seriesId) form.seriesId = seriesOptions.value.find(s => s.isDefault)?.id ?? seriesOptions.value[0]?.id ?? null
const nextNumber = computed(() => seriesOptions.value.find(s => s.id === form.seriesId)?.nextNumber ?? null)

// ─── Cliente ─────────────────────────────────────────────────────────────────
const contact = computed(() => contacts.value?.find(c => c.id === form.contactId) ?? null)
const contactOptions = computed(() => (contacts.value ?? []).map(c => ({ value: c.id, label: c.name, sub: [c.nif, c.city].filter(Boolean).join(' · '), image: c.logoUrl })))
const contactModal = ref(false)
const editContactId = ref<number | null>(null)
const prefillName = ref('')

function newContact(q: string) {
  editContactId.value = null
  prefillName.value = q
  contactModal.value = true
}

function editContact() {
  editContactId.value = form.contactId
  contactModal.value = true
}

async function onContactSaved(id: number) {
  await refreshContacts()
  if (form.contactId !== id) form.contactId = id
  else applyContactDefaults()
}

/** Al elegir cliente: su retención, sus días de pago y el recargo de equivalencia */
function applyContactDefaults() {
  const c = contact.value
  if (!c) return
  if (company.value?.kind === 'autonomo') {
    form.irpfRate = c.irpfRate ?? (c.kind === 'person' ? 0 : Number(company.value?.defaultIrpfRate ?? 0))
  }
  else {
    form.irpfRate = c.irpfRate ?? 0
  }
  if (!isQuote.value) form.dueDate = addDaysISO(form.issueDate, c.paymentTermsDays ?? defaultTerms)
  setSurcharge(c.equivalenceSurcharge)
}

watch(() => form.contactId, (v, old) => {
  if (v && v !== old) applyContactDefaults()
})

const irpfHint = computed(() => {
  if (!contact.value) return 'Se ajusta sola al elegir el cliente'
  if (contact.value.kind === 'person' && form.irpfRate === 0) return 'Sin retención: el cliente es un particular'
  if (contact.value.irpfRate != null) return 'Retención guardada en la ficha del cliente'
  return null
})

// ─── Vencimiento ─────────────────────────────────────────────────────────────
const TERMS = [0, 15, 30, 60, 90]
const termDays = computed(() => (form.dueDate ? daysUntil(form.dueDate) - daysUntil(form.issueDate) : null))
function setTerm(days: number) {
  form.dueDate = addDaysISO(form.issueDate, days)
}
watch(() => form.issueDate, (d, old) => {
  if (old && form.dueDate) form.dueDate = addDaysISO(d, daysUntil(form.dueDate) - daysUntil(old))
})
const showOperationDate = ref(!!form.operationDate)
const showReference = ref(!!form.customerReference)

// ─── Líneas ──────────────────────────────────────────────────────────────────
const pricesWithVat = ref(false)
const surcharge = ref(form.lines.some(l => l.surchargeRate > 0))

function setSurcharge(on: boolean) {
  surcharge.value = on
  form.lines.forEach(l => (l.surchargeRate = on ? SURCHARGE_BY_VAT[l.vatRate] ?? 0 : 0))
}

// «Más opciones»: cuántas están en uso; si alguna lo está, el bloque se abre solo
const moreCount = computed(() => [pricesWithVat.value, showReference.value || !!form.customerReference, showOperationDate.value, surcharge.value].filter(Boolean).length)
const moreOpen = ref(moreCount.value > 0)

// «Solo descripción»: sin conceptos, la descripción explica el trabajo y cada tipo de IVA lleva su base imponible
const conceptless = ref(!!doc.value && isConceptless(doc.value.lines))

function setConceptless(on: boolean) {
  if (on === conceptless.value) return
  if (on) {
    // Los conceptos escritos pasan a la descripción (si estaba vacía) y sus importes, a una base por tipo de IVA
    const written = form.lines.filter(l => l.description.trim())
    if (written.length && !richToPlain(form.description)?.trim()) form.description = plainToRich(written.map(l => l.description.trim()).join('\n'))
    const bases = new Map<number, Line>()
    for (const l of form.lines) {
      const base = lineAmounts({ ...l, quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0 }).base
      const cur = bases.get(l.vatRate) ?? { ...blankLine(), vatRate: l.vatRate, surchargeRate: l.surchargeRate, unitPrice: 0 }
      cur.unitPrice = round2((cur.unitPrice ?? 0) + base)
      bases.set(l.vatRate, cur)
    }
    form.lines = bases.size ? [...bases.values()] : [blankLine()]
  }
  else {
    form.lines = form.lines.map(l => ({ ...l, key: ++keySeq, description: '' }))
  }
  conceptless.value = on
}

/** Otra base con un tipo de IVA aún sin usar (facturas «solo descripción») */
function addBase() {
  const used = new Set(form.lines.map(l => l.vatRate))
  const line = blankLine()
  line.vatRate = VAT_RATES.find(r => !used.has(r)) ?? companyVat
  if (surcharge.value) line.surchargeRate = SURCHARGE_BY_VAT[line.vatRate] ?? 0
  form.lines.push(line)
}

function addLine(after?: number) {
  const line = blankLine()
  if (surcharge.value) line.surchargeRate = SURCHARGE_BY_VAT[line.vatRate] ?? 0
  if (after == null) form.lines.push(line)
  else form.lines.splice(after + 1, 0, line)
  nextTick(() => document.querySelector<HTMLTextAreaElement>(`[data-line="${line.key}"] textarea`)?.focus())
}

function removeLine(i: number) {
  form.lines.splice(i, 1)
  if (!form.lines.length) addLine()
}

function duplicateLine(i: number) {
  const copy = { ...form.lines[i]!, key: ++keySeq }
  form.lines.splice(i + 1, 0, copy)
}

function moveLine(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= form.lines.length) return
  const [l] = form.lines.splice(i, 1)
  form.lines.splice(j, 0, l!)
}

function pickItem(line: Line, item: CatalogItem) {
  line.itemId = item.id
  line.description = item.description ? `${item.name}\n${item.description}` : item.name
  line.unitPrice = item.unitPrice
  line.vatRate = Number(item.vatRate)
  line.surchargeRate = surcharge.value ? SURCHARGE_BY_VAT[line.vatRate] ?? 0 : 0
  if (!line.quantity) line.quantity = 1
}

function onVatChange(line: Line) {
  if (surcharge.value) line.surchargeRate = SURCHARGE_BY_VAT[line.vatRate] ?? 0
}

const round4 = (n: number) => Math.round(n * 10000) / 10000
const shownPrice = (l: Line) => (l.unitPrice == null ? null : pricesWithVat.value ? round2(l.unitPrice * (1 + l.vatRate / 100)) : l.unitPrice)
function setPrice(l: Line, v: number | null) {
  l.unitPrice = v == null ? null : pricesWithVat.value ? round4(v / (1 + l.vatRate / 100)) : v
}

// Guardar un concepto escrito a mano en el catálogo
const itemModal = ref(false)
const itemPrefill = ref<{ name?: string, unitPrice?: number, vatRate?: number, description?: string }>({})
let itemTarget: Line | null = null
function saveToCatalog(l: Line) {
  const [name, ...rest] = l.description.split('\n')
  itemTarget = l
  itemPrefill.value = { name: name?.trim(), description: rest.join('\n').trim() || undefined, unitPrice: l.unitPrice ?? 0, vatRate: l.vatRate }
  itemModal.value = true
}
async function onItemSaved(id: number) {
  await refreshItems()
  if (itemTarget) itemTarget.itemId = id
  toast.success('Guardado en tu catálogo')
}

function lineMenu(l: Line, i: number) {
  return [
    { label: 'Duplicar línea', icon: 'ph:copy', onClick: () => duplicateLine(i) },
    { label: 'Subir', icon: 'ph:arrow-up', onClick: () => moveLine(i, -1) },
    { label: 'Bajar', icon: 'ph:arrow-down', onClick: () => moveLine(i, 1) },
    { label: 'Insertar línea debajo', icon: 'ph:plus', onClick: () => addLine(i) },
    ...(l.itemId ? [] : [{ label: 'Guardar en el catálogo', icon: 'ph:bookmark-simple', onClick: () => saveToCatalog(l) }]),
    { label: l.irpfApplies ? 'Sin retención (suplido)' : 'Aplicar retención', icon: 'ph:percent', onClick: () => (l.irpfApplies = !l.irpfApplies) },
    { divider: true },
    { label: 'Eliminar línea', icon: 'ph:trash', danger: true, onClick: () => removeLine(i) },
  ]
}

// Clic derecho / pulsación larga en una línea (fuera de los campos): sus opciones y el IVA a mano
function lineCtx(l: Line, i: number): CtxSpec {
  const n = form.lines.length
  const items: CtxItem[] = lineMenu(l, i).map((it) => {
    if (it.label === 'Subir') return { ...it, disabled: i === 0 }
    if (it.label === 'Bajar') return { ...it, disabled: i === n - 1 }
    return it
  })
  items.splice(items.findIndex(it => it.divider), 0, {
    label: 'IVA',
    icon: 'ph:receipt',
    hint: `${l.vatRate} %`,
    children: VAT_RATES.map(r => ({ label: `${r} %`, active: l.vatRate === r, onClick: () => { l.vatRate = r; onVatChange(l) } })),
  })
  const concept = l.description.split('\n')[0]?.trim()
  return {
    title: `Línea ${i + 1} de ${n}`,
    subtitle: [concept || 'Sin concepto', eur(lineAmounts({ ...l, quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0 }).base)].join(' · '),
    icon: 'ph:list-bullets',
    items,
  }
}

// Adjuntos (orden de pedido, albarán…): disponibles en cuanto el documento existe
const attachments = ref(doc.value?.attachments ?? [])
async function reloadAttachments() {
  if (props.id) attachments.value = (await $fetch<SalesDoc>(`/api/sales/${props.id}`)).attachments ?? []
}

// Nueva factura desde la ficha del cliente (?cliente=ID) o desde el catálogo (?producto=ID)
if (!doc.value && !source.value && form.contactId) applyContactDefaults()
const fromItem = !doc.value && items.value?.find(i => i.id === Number(route.query.producto))
if (fromItem) pickItem(form.lines[0]!, fromItem)

// ─── Repetir la última a este cliente ────────────────────────────────────────
// Al elegir cliente en un documento nuevo y vacío: sus conceptos de la última vez, con un toque
interface LastDoc { id: number, number: string | null, status: string, issueDate: string, total: number, taxBase: number, conceptPreview: string | null }
const lastDoc = ref<LastDoc | null>(null)
const linesEmpty = computed(() => form.lines.every(l => !l.description.trim()))
const salesListUrl = (contactId: number) => `/api/sales?kind=${kind.value === 'proforma' ? 'proforma' : kind.value === 'quote' ? 'quote' : 'invoice'}&contactId=${contactId}&limit=5` as string
watch(() => form.contactId, async (id) => {
  lastDoc.value = null
  if (!id || doc.value || source.value) return
  try {
    const list = await $fetch<LastDoc[]>(salesListUrl(id))
    if (form.contactId === id) lastDoc.value = list.find(d => d.status !== 'draft' && d.status !== 'cancelled') ?? null
  }
  catch { /* sin sugerencia: no pasa nada */ }
}, { immediate: true })

async function repeatLast() {
  if (!lastDoc.value) return
  try {
    const full = await $fetch<SalesDoc>(`/api/sales/${lastDoc.value.id}` as string)
    form.lines = full.lines.map(({ id: _id, ...l }) => ({ ...l, key: ++keySeq }))
    if (full.description && !form.description) form.description = full.description
    surcharge.value = form.lines.some(l => l.surchargeRate > 0)
    toast.success('Conceptos copiados', 'Revisa cantidades y fechas antes de emitir.')
  }
  catch (err) {
    toast.error('No se pudieron copiar los conceptos', errorMessage(err))
  }
}

// ─── Totales ─────────────────────────────────────────────────────────────────
const validLines = computed(() => (conceptless.value ? form.lines.filter(l => l.unitPrice != null) : form.lines.filter(l => l.description.trim())))
const totals = computed(() => computeTotals(validLines.value.map(l => ({ ...l, quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0 })), form.irpfRate))
const hasDiscount = computed(() => form.lines.some(l => (l.discountPct ?? 0) > 0))

// ─── Guardar y emitir ────────────────────────────────────────────────────────
const dirty = ref(false)
const saving = ref<'draft' | 'issue' | null>(null)
const errors = reactive<{ contact: string | null, lines: string | null }>({ contact: null, lines: null })
watch(form, () => (dirty.value = true), { deep: true })

const title = computed(() => {
  const what = { invoice: 'factura', rectifying: 'factura rectificativa', quote: 'presupuesto', proforma: 'proforma' }[kind.value]
  return props.id ? `Editar ${what}` : `${kind.value === 'quote' || kind.value === 'proforma' ? 'Nuevo' : 'Nueva'} ${what}`
})
useHead({ title: `${title.value} · NUMIQ` })

// ─── Pasos en el móvil: Cliente → Conceptos → Revisar ───
// La hoja entera no cabe en un móvil: se rellena por partes y al final se ve completa
const STEPS = [
  { n: 1, label: 'Cliente' },
  { n: 2, label: 'Conceptos' },
  { n: 3, label: 'Revisar' },
] as const
const step = ref<1 | 2 | 3>(doc.value ? 3 : form.contactId ? 2 : 1)
function goStep(n: 1 | 2 | 3) {
  step.value = n
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
}
function nextStep() {
  if (step.value === 1) {
    errors.contact = null
    if (!form.contactId && !isQuote.value) {
      errors.contact = 'Elige el cliente de la factura'
      return
    }
    goStep(2)
  }
  else if (step.value === 2) {
    errors.lines = linesError()
    if (errors.lines) {
      toast.error(conceptless.value ? 'Falta la descripción o el importe' : 'Falta un concepto', conceptless.value ? errors.lines : 'Escribe qué facturas o búscalo en tu catálogo.')
      return
    }
    goStep(3)
  }
}

function linesError() {
  if (!conceptless.value) return validLines.value.length ? null : 'Añade al menos un concepto'
  if (!richToPlain(form.description)?.trim()) return 'Describe el trabajo en la descripción'
  return validLines.value.length ? null : 'Indica la base imponible'
}

function validate(issue: boolean) {
  errors.contact = null
  errors.lines = null
  errors.lines = linesError()
  if (issue && !isQuote.value) {
    if (!form.contactId) errors.contact = 'Elige el cliente de la factura'
    else if (!contact.value?.nif) errors.contact = 'El cliente necesita NIF para emitir una factura completa'
  }
  return !errors.contact && !errors.lines
}

async function save(issue: boolean) {
  if (!validate(issue)) {
    toast.error('Revisa la factura', errors.contact ?? errors.lines ?? undefined)
    // En el móvil, al paso donde está lo que falta
    if (errors.contact) goStep(1)
    else if (errors.lines) goStep(2)
    return
  }
  if (issue && !isQuote.value) {
    const ok = await confirm({
      title: `¿Emitir ${kind.value === 'rectifying' ? 'la rectificativa' : 'la factura'} ${nextNumber.value ?? ''}?`,
      body: `Total ${eur(totals.value.total)}${contact.value ? ` a ${contact.value.name}` : ''}. Se asignará el número ${nextNumber.value ?? ''} y quedará emitida.`,
      confirmLabel: 'Emitir',
    })
    if (!ok) return
  }
  else if (isAlreadyIssued.value) {
    const ok = await confirm({
      title: '¿Guardar cambios en la factura emitida?',
      body: doc.value?.imported
        ? 'Se actualizarán los datos de la factura importada.'
        : 'Esta factura ya fue emitida. Modificar sus datos (importes, fechas o cliente) cambiará el documento original. Si ya se la enviaste al cliente, asegúrate de reenviarle la versión actualizada.',
      confirmLabel: 'Guardar cambios',
    })
    if (!ok) return
  }
  saving.value = issue ? 'issue' : 'draft'
  try {
    const body = {
      kind: kind.value,
      number: isAlreadyIssued.value ? form.number.trim() || null : undefined,
      seriesId: form.seriesId,
      contactId: form.contactId,
      customerReference: form.customerReference.trim() || null,
      issueDate: form.issueDate,
      dueDate: form.dueDate || null,
      operationDate: showOperationDate.value ? form.operationDate || null : null,
      irpfRate: form.irpfRate,
      paymentMethod: form.paymentMethod,
      description: form.description,
      notes: form.notes || null,
      terms: form.terms || null,
      rectifiesId: kind.value === 'rectifying' ? form.rectifiesId : null,
      rectificationCode: kind.value === 'rectifying' ? form.rectificationCode : null,
      rectificationReason: kind.value === 'rectifying' ? form.rectificationReason || null : null,
      lines: validLines.value.map(l => ({
        itemId: l.itemId,
        description: conceptless.value ? '' : l.description.trim(),
        quantity: conceptless.value ? 1 : l.quantity ?? 0,
        unitPrice: l.unitPrice ?? 0,
        discountPct: l.discountPct ?? 0,
        vatRate: l.vatRate,
        surchargeRate: l.surchargeRate,
        irpfApplies: l.irpfApplies,
      })),
      issue,
      status: canPickStatus.value ? form.status : undefined,
    }
    const r = props.id
      ? await $fetch<{ id: number, number: string | null }>(`/api/sales/${props.id}`, { method: 'PATCH', body })
      : await $fetch<{ id: number, number: string | null }>('/api/sales', { method: 'POST', body })
    dirty.value = false
    toast.success(
      isQuote.value
        ? (doc.value && doc.value.status !== 'draft' ? 'Presupuesto actualizado' : `Presupuesto ${r.number ?? ''} guardado`)
        : issue
          ? `${r.number} emitida`
          : isAlreadyIssued.value
            ? 'Factura actualizada'
            : 'Borrador guardado',
      isQuote.value && !(doc.value && doc.value.status !== 'draft')
        ? 'Listo para enviar al cliente.'
        : issue && verifactu.value ? 'Registrada con huella VeriFactu.' : undefined,
    )
    await navigateTo(`${base.value}/${r.id}`)
  }
  catch (err) {
    toast.error(issue ? 'No se pudo emitir' : 'No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = null
  }
}

/** Vuelve a donde se abrió el editor (catálogo, ficha del cliente, el propio documento…); sin historial, al listado */
function goBack() {
  if (window.history.state?.back) router.back()
  else navigateTo(listHref.value)
}

onBeforeRouteLeave(async () => {
  if (!dirty.value || saving.value) return true
  return confirm({ title: '¿Salir sin guardar?', body: 'Perderás los cambios de este documento.', confirmLabel: 'Salir sin guardar', danger: true })
})

useEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    save(false)
  }
})

const accent = computed(() => design.value?.design.accentColor || company.value?.brandColor || '#4f46e5')
const paperFont = computed(() => {
  const f = design.value?.design.font
  return f && f !== 'Inter' ? `'${f}', ${f === 'Lora' ? 'Georgia, serif' : 'system-ui, sans-serif'}` : undefined
})
const logoUrl = computed(() => (design.value?.design.showLogo ? design.value.logoUrl : null))
/** Título de observaciones o condiciones según el diseño (vacío: sin título en el documento) */
const notesTitle = computed(() => (isQuote.value ? design.value?.design.termsLabel ?? 'Condiciones' : design.value?.design.notesLabel ?? 'Observaciones').trim())
const issuerName = computed(() => company.value?.tradeName || company.value?.legalName || '')
const paperTitle = computed(() => ({ invoice: 'Factura', rectifying: 'Factura rectificativa', quote: 'Presupuesto', proforma: 'Factura proforma' }[kind.value]))
const R_CODES = [
  { value: 'R1', label: 'R1 · Error fundado en derecho (art. 80.1, 80.2 y 80.6 LIVA)' },
  { value: 'R2', label: 'R2 · Concurso de acreedores (art. 80.3)' },
  { value: 'R3', label: 'R3 · Créditos incobrables (art. 80.4)' },
  { value: 'R4', label: 'R4 · Resto de causas (descuentos, devoluciones…)' },
  { value: 'R5', label: 'R5 · Rectificación de factura simplificada' },
]
</script>

<template>
  <div class="editor" :data-step="step">
    <!-- Barra superior -->
    <div class="ed-bar">
      <div class="ed-bar-in">
        <UiButton variant="ghost" square icon="ph:arrow-left" aria-label="Volver" @click="goBack" />
        <div class="grow ed-title">
          <h1>{{ title }}</h1>
          <p class="muted ed-sub">
            <span class="ed-sub-t">
              <template v-if="doc?.number">{{ doc.number }}</template>
              <template v-else-if="nextNumber"><span class="ed-sub-long">Se numerará como </span><span class="mono">{{ nextNumber }}</span> al {{ isQuote ? 'guardar' : 'emitir' }}</template>
            </span>
            <span v-if="dirty" class="unsaved"><span class="unsaved-dot" aria-hidden="true" />Sin guardar</span>
          </p>
        </div>
        <div class="ed-actions">
          <!-- Presupuestos: un solo «Guardar» (nacen pendientes, con su número) -->
          <UiButton v-if="isQuote" variant="primary" icon="ph:check" :loading="saving === 'draft'" :disabled="!!saving" @click="save(false)">
            {{ doc && doc.status !== 'draft' ? 'Guardar cambios' : 'Guardar' }}
          </UiButton>
          <template v-else>
            <UiButton :loading="saving === 'draft'" :disabled="!!saving" @click="save(false)">
              {{ isAlreadyIssued ? 'Guardar cambios' : 'Guardar borrador' }}
            </UiButton>
            <UiButton v-if="!isAlreadyIssued" variant="primary" icon="ph:paper-plane-tilt" :loading="saving === 'issue'" :disabled="!!saving" @click="save(true)">
              Emitir
            </UiButton>
          </template>
        </div>
      </div>
    </div>

    <!-- Pasos del móvil -->
    <nav class="m-steps" aria-label="Pasos">
      <button
        v-for="s in STEPS"
        :key="s.n"
        type="button"
        class="m-step"
        :class="{ on: step === s.n, done: step > s.n }"
        :aria-current="step === s.n ? 'step' : undefined"
        @click="goStep(s.n)"
      >
        <span class="m-step-n num" aria-hidden="true">
          <Icon v-if="step > s.n" name="ph:check-bold" />
          <template v-else>{{ s.n }}</template>
        </span>
        {{ s.label }}
      </button>
    </nav>

    <!-- Mide el espacio real (sin el menú lateral) para colocar la hoja y el panel -->
    <div class="ed-fit">
      <div class="ed-body">
        <!-- La hoja -->
        <div class="paper" :style="{ '--doc-accent': accent, '--doc-font': paperFont }">
          <div class="paper-head">
            <div class="paper-brand">
              <img v-if="logoUrl" :src="logoUrl" :alt="issuerName" class="paper-logo">
              <template v-else>
                <span class="paper-mark">{{ initials(issuerName) }}</span>
                <div class="min0">
                  <p class="paper-company">{{ issuerName }}</p>
                  <p class="paper-company-sub">{{ company?.legalName !== issuerName ? `${company?.legalName} · ` : '' }}NIF {{ company?.nif }}</p>
                </div>
              </template>
            </div>
            <div class="paper-title">
              <h2>{{ paperTitle }}</h2>
              <div v-if="isAlreadyIssued" class="paper-number-edit">
                <span class="clearable">
                  <input v-model="form.number" class="cell" placeholder="Nº de factura" aria-label="Número de factura">
                  <UiClear />
                </span>
              </div>
              <p v-else class="paper-number" :class="{ pending: !doc?.number }">{{ doc?.number ?? (nextNumber ? `${nextNumber} (al ${isQuote ? 'guardar' : 'emitir'})` : 'Borrador') }}</p>
            </div>
          </div>

          <div class="paper-meta">
            <div>
              <span class="paper-label">Fecha</span>
              <input v-model="form.issueDate" type="date" class="cell" aria-label="Fecha de emisión" required>
            </div>
            <div>
              <span class="paper-label">{{ isQuote ? 'Válido hasta' : 'Vencimiento' }}</span>
              <input v-model="form.dueDate" type="date" class="cell" :aria-label="isQuote ? 'Válido hasta' : 'Vencimiento'">
            </div>
            <div>
              <span class="paper-label">Forma de pago</span>
              <select v-model="form.paymentMethod" class="cell" aria-label="Forma de pago">
                <option v-for="(label, value) in PAYMENT_METHODS" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div v-if="showReference || form.customerReference">
              <span class="paper-label">{{ design?.design?.customerReferenceLabel || 'Orden de Pedido' }}</span>
              <span class="clearable">
                <input v-model="form.customerReference" class="cell" placeholder="Nº de pedido (opcional)" :aria-label="design?.design?.customerReferenceLabel || 'Orden de Pedido'" maxlength="80">
                <UiClear />
              </span>
            </div>
          </div>

          <div class="paper-parties">
            <div class="paper-party">
              <span class="paper-label">Emisor</span>
              <p class="paper-party-name">{{ company?.legalName }}</p>
              <p>NIF {{ company?.nif }}</p>
              <p v-if="company?.address">{{ company.address }}</p>
              <p v-if="company?.postalCode || company?.city">{{ [company?.postalCode, company?.city].filter(Boolean).join(' ') }}{{ company?.province ? ` (${company.province})` : '' }}</p>
              <NuxtLink to="/ajustes" class="party-edit no-print"><Icon name="ph:pencil-simple" /> Editar mis datos</NuxtLink>
            </div>

            <div class="paper-party client" :class="{ invalid: !!errors.contact }">
              <span class="paper-label">Cliente</span>
              <template v-if="contact">
                <p class="paper-party-name">{{ contact.name }}</p>
                <p :class="{ missing: !contact.nif }">{{ contact.nif ? `NIF ${contact.nif}` : 'Sin NIF' }}</p>
                <p v-if="contact.address">{{ contact.address }}</p>
                <p v-if="contact.postalCode || contact.city">{{ [contact.postalCode, contact.city].filter(Boolean).join(' ') }}{{ contact.province ? ` (${contact.province})` : '' }}</p>
                <div class="party-actions">
                  <button type="button" class="party-edit" @click="editContact"><Icon name="ph:pencil-simple" /> Editar datos</button>
                  <button type="button" class="party-edit" @click="form.contactId = null"><Icon name="ph:arrows-left-right" /> Cambiar</button>
                </div>
              </template>
              <div v-else class="client-pick">
                <UiCombobox
                  v-model="form.contactId"
                  :options="contactOptions"
                  placeholder="Busca o crea un cliente…"
                  create-label="Nuevo cliente"
                  avatars
                  @create="newContact"
                />
              </div>
              <p v-if="errors.contact" class="party-error" role="alert"><Icon name="ph:warning-circle-fill" /> {{ errors.contact }}</p>
            </div>
          </div>

          <div v-if="kind === 'rectifying'" class="rect-box">
            <Icon name="ph:arrow-counter-clockwise" class="rect-ic" />
            <div class="grow">
              <span class="paper-label">Factura rectificativa {{ source?.number ? `de ${source.number}` : '' }}</span>
              <select v-model="form.rectificationCode" class="cell" aria-label="Motivo legal">
                <option v-for="r in R_CODES" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
              <span class="clearable">
                <input v-model="form.rectificationReason" class="cell" placeholder="Explica brevemente el motivo (importe erróneo, devolución…)" aria-label="Motivo de la rectificación">
                <UiClear />
              </span>
            </div>
          </div>

          <!-- Repetir la última vez: el caso más habitual (iguala mensual, mismo servicio) -->
          <div v-if="lastDoc && linesEmpty" class="repeat no-print">
            <Icon name="ph:arrow-counter-clockwise" class="repeat-ic" aria-hidden="true" />
            <div class="grow min0">
              <p class="repeat-t">¿Lo mismo que la última vez?</p>
              <p class="repeat-s">
                {{ lastDoc.number ?? 'Borrador' }} · {{ fdateShort(lastDoc.issueDate) }} · {{ eur(isQuote ? lastDoc.taxBase : lastDoc.total) }}<template v-if="lastDoc.conceptPreview"> · {{ lastDoc.conceptPreview }}</template>
              </p>
            </div>
            <UiButton size="sm" variant="soft" icon="ph:copy" @click="repeatLast">Repetir conceptos</UiButton>
          </div>

          <!-- Descripción con formato -->
          <div class="desc-block">
            <div class="desc-head">
              <span class="paper-label">Descripción</span>
              <div class="mode no-print" role="group" aria-label="Cómo se detalla el trabajo">
                <button type="button" :aria-pressed="!conceptless" @click="setConceptless(false)">Con conceptos</button>
                <button type="button" :aria-pressed="conceptless" @click="setConceptless(true)">Solo descripción</button>
              </div>
            </div>
            <UiRichText
              v-model="form.description"
              label="Descripción"
              :placeholder="conceptless ? 'Describe el trabajo facturado: proyecto, alcance, periodo…' : 'Describe el proyecto, el alcance o el periodo facturado (opcional)'"
            />
          </div>

          <!-- Solo descripción: la base imponible de cada tipo de IVA -->
          <div v-if="conceptless" class="bases">
            <div v-for="l in form.lines" :key="l.key" class="b-row">
              <span class="b-label">Base imponible</span>
              <SalesNumCell v-model="l.unitPrice" label="Base imponible" :decimals="2" placeholder="0,00" suffix="€" class="b-amount" />
              <select v-model.number="l.vatRate" class="cell r b-vat" aria-label="IVA" @change="onVatChange(l)">
                <option v-for="r in VAT_RATES" :key="r" :value="r">IVA {{ r }} %</option>
              </select>
              <button v-if="form.lines.length > 1" type="button" class="l-btn" aria-label="Quitar esta base" @click="removeLine(form.lines.indexOf(l))"><Icon name="ph:x-bold" /></button>
            </div>
            <div class="l-add">
              <button v-if="form.lines.length < VAT_RATES.length" type="button" class="add-btn" @click="addBase"><Icon name="ph:plus-circle-fill" /> Otro tipo de IVA</button>
              <span class="add-hint">Sin tabla de conceptos: la factura muestra la descripción y los totales</span>
            </div>
            <p v-if="errors.lines" class="party-error" role="alert"><Icon name="ph:warning-circle-fill" /> {{ errors.lines }}</p>
          </div>

          <!-- Conceptos -->
          <div v-else class="lines" :class="{ 'has-dto': hasDiscount }">
            <div class="l-head" aria-hidden="true">
              <span>Concepto</span>
              <span class="r">Cant.</span>
              <span class="r">{{ pricesWithVat ? 'Precio c/IVA' : 'Precio' }}</span>
              <span class="r">Dto.</span>
              <span class="r">IVA</span>
              <span class="r">Importe</span>
              <span />
            </div>
            <TransitionGroup name="line">
              <div v-for="(l, i) in form.lines" :key="l.key" v-ctx="() => lineCtx(l, i)" class="l-row" :data-line="l.key">
                <div class="l-desc">
                  <SalesConceptInput v-model="l.description" :items="items ?? []" :linked="!!l.itemId" @pick="pickItem(l, $event)" @update:model-value="l.itemId && !$event ? (l.itemId = null) : undefined" />
                  <div v-if="l.itemId || !l.irpfApplies" class="l-tags">
                    <span v-if="l.itemId" class="l-tag"><Icon name="ph:bookmark-simple-fill" /> Catálogo</span>
                    <span v-if="!l.irpfApplies" class="l-tag warn">Sin retención</span>
                  </div>
                </div>
                <SalesNumCell v-model="l.quantity" label="Cantidad" :decimals="3" class="l-qty" data-label="Cantidad" />
                <SalesNumCell :model-value="shownPrice(l)" label="Precio unitario" :decimals="4" placeholder="0,00" suffix="€" class="l-price" :data-label="pricesWithVat ? 'Precio c/IVA' : 'Precio'" @update:model-value="setPrice(l, $event)" />
                <SalesNumCell v-model="l.discountPct" label="Descuento" suffix="%" class="l-dto" data-label="Dto." />
                <span class="l-vat" data-label="IVA">
                  <select v-model.number="l.vatRate" class="cell r" aria-label="IVA" @change="onVatChange(l)">
                    <option v-for="r in VAT_RATES" :key="r" :value="r">{{ r }} %</option>
                  </select>
                </span>
                <span class="l-amount num" data-label="Importe">{{ eur(lineAmounts({ ...l, quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0 }).base) }}</span>
                <UiMenu :items="lineMenu(l, i)" :width="230" class="l-menu">
                  <template #default="{ toggle }">
                    <button type="button" class="l-btn" aria-label="Opciones de la línea" @click="toggle"><Icon name="ph:dots-three-vertical-bold" /></button>
                  </template>
                </UiMenu>
              </div>
            </TransitionGroup>
            <div class="l-add">
              <button type="button" class="add-btn" @click="addLine()"><Icon name="ph:plus-circle-fill" /> Añadir concepto</button>
              <span class="add-hint">Escribe para buscar en tu catálogo · ↓ y Enter para elegir</span>
            </div>
            <p v-if="errors.lines" class="party-error" role="alert"><Icon name="ph:warning-circle-fill" /> {{ errors.lines }}</p>
          </div>

          <!-- Notas y totales -->
          <div class="paper-bottom">
            <div>
              <span class="paper-label" :class="{ 'no-title': !notesTitle }" :title="notesTitle ? undefined : 'Sin título en el documento: lo puedes cambiar en Ajustes → Diseño de factura'">{{ notesTitle || (isQuote ? 'Condiciones · sin título' : 'Observaciones · sin título') }}</span>
              <textarea v-if="isQuote" v-model="form.terms" class="cell area" rows="3" placeholder="Validez, plazos de entrega, forma de pago…" aria-label="Condiciones" />
              <textarea v-else v-model="form.notes" class="cell area" rows="3" placeholder="Notas para el cliente (opcional)" aria-label="Observaciones" />
            </div>

            <div class="paper-totals">
              <div class="t-row"><span>Base imponible</span><span>{{ eur(totals.taxBase) }}</span></div>
              <div v-if="totals.discountTotal" class="t-row sub"><span>Descuentos aplicados</span><span>−{{ eur(totals.discountTotal) }}</span></div>
              <div v-for="g in totals.groups" :key="`${g.vatRate}-${g.surchargeRate}`" class="t-row">
                <span>IVA {{ g.vatRate }} %<small v-if="totals.groups.length > 1"> s/ {{ eur(g.base) }}</small></span>
                <span>{{ eur(g.vat) }}</span>
              </div>
              <div v-if="totals.surchargeTotal" class="t-row"><span>Recargo de equivalencia</span><span>{{ eur(totals.surchargeTotal) }}</span></div>
              <div v-if="form.irpfRate && (contact || doc)" class="t-row minus"><span>Retención IRPF {{ num(form.irpfRate) }} %</span><span>{{ totals.irpfTotal ? '−' : '' }}{{ eur(totals.irpfTotal) }}</span></div>
              <div class="t-total"><span>Total</span><strong>{{ eur(totals.total) }}</strong></div>
            </div>
          </div>

          <!-- Datos de pago: debajo después del total -->
          <div v-if="!isQuote && company?.iban" class="paper-pay pay-info">
            <span class="paper-label">Pago por transferencia</span>
            <p class="mono iban">{{ company.iban.replace(/(.{4})/g, '$1 ').trim() }}</p>
          </div>
        </div>

        <!-- Panel de opciones -->
        <aside class="side">
          <UiCard title="Condiciones" icon="ph:file-text">
            <div class="stack gap-4">
              <UiSelect v-if="canPickStatus" v-model="form.status" label="Estado" :options="QUOTE_STATUS_OPTIONS.map(o => ({ value: o.value, label: o.label }))" />
              <UiSelect v-if="seriesOptions.length > 1" v-model="form.seriesId" label="Serie" :options="seriesOptions.map(s => ({ value: s.id, label: `${s.name} (${s.prefix})` }))" />
              <div v-if="!isQuote" class="field">
                <span class="label">Vencimiento</span>
                <div class="chips">
                  <button v-for="d in TERMS" :key="d" type="button" class="chip" :class="{ on: termDays === d }" @click="setTerm(d)">{{ d === 0 ? 'Al contado' : `${d} días` }}</button>
                </div>
                <p v-if="form.dueDate" class="hint">Vence el {{ fdate(form.dueDate) }}</p>
              </div>
              <IrpfField v-model="form.irpfRate" label="Retención de IRPF" :hint="irpfHint ?? 'Solo cuando facturas a empresas o profesionales'" />
            </div>
          </UiCard>

          <!-- Lo que casi nunca hace falta, plegado: se abre solo si ya se está usando -->
          <details class="card more" :open="moreOpen">
            <summary class="more-sum" @click.prevent="moreOpen = !moreOpen">
              <Icon name="ph:sliders-horizontal" class="more-ic" aria-hidden="true" />
              <span class="grow">Más opciones</span>
              <span v-if="moreCount" class="more-n num">{{ moreCount }}</span>
              <Icon name="ph:caret-down" class="more-caret" aria-hidden="true" />
            </summary>
            <div class="stack gap-4 more-body">
              <UiSwitch v-model="pricesWithVat" label="Escribir precios con IVA" hint="Calcula la base a partir del precio final" />
              <UiSwitch :model-value="showReference || !!form.customerReference" label="Nº de pedido del cliente" hint="Lo pide en la factura para tramitar el pago" @update:model-value="v => { showReference = v; if (!v) form.customerReference = '' }" />
              <UiSwitch v-if="!isQuote" v-model="showOperationDate" label="Fecha de operación distinta" hint="Si el servicio se prestó en otra fecha" />
              <UiInput v-if="showOperationDate && !isQuote" v-model="form.operationDate" type="date" label="Fecha de la operación" />
              <UiSwitch :model-value="surcharge" label="Recargo de equivalencia" hint="Cliente comerciante minorista" @update:model-value="setSurcharge" />
            </div>
          </details>

          <SalesAttachments v-if="id" :doc-id="id" :items="attachments" @changed="reloadAttachments" />
          <div v-else class="card att-hint">
            <Icon name="ph:paperclip" />
            <p>Guarda {{ isQuote ? 'el presupuesto' : 'el borrador' }} para adjuntar la orden de pedido, el albarán u otros documentos.</p>
          </div>

        </aside>
      </div>
    </div>

    <!-- Barra móvil -->
    <div class="m-bar">
      <div class="grow">
        <span class="muted">Total</span>
        <strong class="num">{{ eur(totals.total) }}</strong>
      </div>
      <UiButton :variant="isQuote && step === 3 ? 'primary' : 'secondary'" :loading="saving === 'draft'" :disabled="!!saving" @click="save(false)">
        {{ isAlreadyIssued || (isQuote && doc && doc.status !== 'draft') ? 'Guardar cambios' : 'Guardar' }}
      </UiButton>
      <UiButton v-if="step < 3" variant="primary" icon-right="ph:arrow-right" @click="nextStep">Siguiente</UiButton>
      <UiButton v-else-if="!isAlreadyIssued && !isQuote" variant="primary" :loading="saving === 'issue'" :disabled="!!saving" @click="save(true)">Emitir</UiButton>
    </div>

    <ContactModal v-model="contactModal" role="client" :contact-id="editContactId" :prefill-name="prefillName" @saved="onContactSaved" />
    <ItemModal v-model="itemModal" :prefill="itemPrefill" @saved="onItemSaved" />
  </div>
</template>

<style scoped>
.editor {
  padding-bottom: var(--s-10);
}

/* Barra superior fija bajo la topbar */
.ed-bar {
  position: sticky;
  top: var(--topbar-h);
  z-index: calc(var(--z-sticky) - 1);
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-subtle);
}

.ed-bar-in {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  max-width: 1320px;
  margin: 0 auto;
  padding: var(--s-3) var(--s-7);
}

.ed-title h1 {
  font-size: var(--text-xl);
  letter-spacing: -0.02em;
}

.ed-title p {
  font-size: var(--text-sm);
}

.ed-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}

.ed-sub-t {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unsaved {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  color: var(--warning);
  font-weight: 550;
}

.unsaved-dot {
  width: 6px;
  height: 6px;
  background: currentcolor;
  border-radius: 50%;
}

.ed-actions {
  display: flex;
  gap: var(--s-2);
}

.ed-fit {
  container: editor / inline-size;
}

.ed-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--s-6);
  align-items: start;
  max-width: 1320px;
  margin: 0 auto;
  padding: var(--s-6) var(--s-7);
}

.min0 {
  min-width: 0;
}

/* Campos en línea sobre la hoja: invisibles hasta que se tocan */
.paper :deep(.cell) {
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  margin: 0 -8px;
  font: inherit;
  color: var(--p-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  outline: none;
  transition: border-color var(--t-fast), background var(--t-fast), box-shadow var(--t-fast);
  color-scheme: light;
}

.paper :deep(.cell::placeholder) {
  color: #a3a9b5;
}

.paper :deep(.cell:hover) {
  background: var(--p-soft);
}

.paper :deep(.cell:focus) {
  background: #fff;
  border-color: var(--p-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-accent) 18%, transparent);
}

/* La hoja es siempre clara, también en modo oscuro */
.paper :deep(.clear-x) {
  color: #8a91a0;
}

.paper :deep(.clear-x:hover) {
  color: var(--p-text);
  background: var(--p-soft);
}

.paper-meta :deep(.cell) {
  width: calc(100% + 16px);
  font-weight: 560;
}

.paper select.cell {
  cursor: pointer;
  appearance: none;
}

.paper-party p.missing {
  color: #b42318;
  font-weight: 550;
}

.party-actions {
  display: flex;
  gap: 14px;
  margin-top: 8px;
}

.party-edit {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  font-size: 12.5px;
  font-weight: 560;
  color: var(--p-accent);
}

.party-actions .party-edit {
  margin-top: 0;
}

.party-edit:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* El selector vive sobre la hoja: siempre con la paleta clara */
.client-pick {
  margin-top: 4px;
  --surface: #fff;
  --surface-hover: #f4f5f8;
  --surface-active: #eceef3;
  --border: #e5e7ec;
  --border-subtle: #eef0f3;
  --border-strong: #d3d7df;
  --text: #11141b;
  --text-2: #3f4654;
  --text-3: #626a79;
  --text-4: #9aa1ae;
  --brand-text: var(--p-accent);
  --brand-soft: color-mix(in srgb, var(--p-accent) 10%, white);
  color: var(--text);
  color-scheme: light;
}

.client.invalid .client-pick :deep(.control) {
  border-color: #dc2626;
}

.party-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12.5px;
  font-weight: 550;
  color: #b42318;
}

.rect-box {
  display: flex;
  gap: 12px;
  margin-top: 28px;
  padding: 14px 16px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 10px;
}

.rect-box .cell {
  margin-top: 4px;
}

.rect-ic {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  color: #c2410c;
}

.desc-block {
  margin-top: 30px;
}

.desc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

/* Con conceptos / Solo descripción */
.mode {
  display: inline-flex;
  padding: 2px;
  margin-bottom: 6px;
  background: color-mix(in srgb, var(--p-text-3) 9%, transparent);
  border-radius: 8px;
}

.mode button {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 560;
  color: var(--p-text-3);
  border-radius: 6px;
  transition: background var(--t-fast), color var(--t-fast);
}

.mode button[aria-pressed='true'] {
  color: var(--p-text);
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.mode button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.bases {
  margin-top: 22px;
  padding-top: 10px;
  border-top: 1px solid var(--p-line);
}

.b-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px 110px 32px;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

/* La base se ve como un campo: es lo único que se rellena */
.b-row .b-amount,
.b-row .b-vat {
  height: 38px;
  margin: 0;
  background: var(--p-soft);
  border: 1px solid var(--p-line);
  border-radius: 8px;
}

.b-row .b-amount:focus-within,
.b-row .b-vat:focus {
  border-color: var(--p-accent);
}

.b-label {
  font-weight: 560;
  color: var(--p-text-2);
}

@media (max-width: 520px) {
  .b-row {
    grid-template-columns: minmax(0, 1fr) 96px 32px;
  }

  .b-label {
    grid-column: 1 / -1;
  }
}

.paper-label.no-title {
  opacity: 0.55;
  font-style: italic;
}

/* Líneas como rejilla: se reordena cuando la hoja es estrecha (según su ancho, no el de la pantalla) */
.lines {
  container: lines / inline-size;
  margin-top: 26px;
  --cols: minmax(0, 1fr) 70px 104px 64px 74px 108px 30px;
}

.l-head,
.l-row {
  display: grid;
  grid-template-columns: var(--cols);
  gap: 8px;
  align-items: start;
}

.l-head {
  padding-bottom: 10px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--p-text-3);
  border-bottom: 1.5px solid var(--p-text);
}

.l-head .r {
  text-align: right;
}

.l-row {
  position: relative;
  padding: 8px 0;
  border-bottom: 1px solid var(--p-line);
}

.l-row :deep(.cell) {
  margin: 0;
}

.l-row select.cell {
  width: 100%;
  text-align: right;
  text-align-last: right;
}

.l-vat {
  display: block;
}

/* Etiquetas de cada cifra: solo en el móvil, donde no hay cabecera de columnas */
.l-row > [data-label]::before {
  display: none;
}

.l-amount {
  padding: 7px 0;
  text-align: right;
  font-weight: 600;
}

.l-tags {
  display: flex;
  gap: 6px;
  margin: 2px 0 0 1px;
}

.l-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 560;
  color: var(--p-accent);
}

.l-tag.warn {
  color: #b45309;
}

.l-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 34px;
  color: var(--p-text-3);
  border-radius: 7px;
  opacity: 0.55;
  transition: opacity var(--t-fast), background var(--t-fast);
}

.l-row:hover .l-btn,
.l-btn:focus-visible {
  opacity: 1;
}

.l-btn:hover {
  background: var(--p-soft);
  color: var(--p-text);
}

.l-add {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0 0;
}

.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px 7px 9px;
  font-weight: 600;
  color: var(--p-accent);
  border-radius: 8px;
  transition: background var(--t-fast);
}

.add-btn:hover {
  background: color-mix(in srgb, var(--p-accent) 8%, transparent);
}

.add-btn :deep(svg) {
  width: 19px;
  height: 19px;
}

.add-hint {
  font-size: 12px;
  color: var(--p-text-3);
}

.area {
  margin: 2px -8px 0 !important;
  width: calc(100% + 16px) !important;
  resize: vertical;
  line-height: 1.5;
}

.pay-info p {
  color: var(--p-text-2);
}

.t-row small {
  margin-left: 4px;
  font-size: 11.5px;
  color: var(--p-text-3);
}

.t-row.sub {
  font-size: 12.5px;
  color: var(--p-text-3);
}

.line-enter-active {
  transition: opacity 200ms var(--ease-out), transform 240ms var(--ease-out);
}

.line-leave-active {
  transition: opacity 140ms var(--ease-in);
  position: absolute;
  width: 100%;
}

.line-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.line-leave-to {
  opacity: 0;
}

.line-move {
  transition: transform 240ms var(--ease-out);
}

/* Panel lateral */
.side {
  position: sticky;
  top: calc(var(--topbar-h) + 84px);
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  height: 30px;
  padding: 0 11px;
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  transition: all var(--t-fast);
}

.chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.chip.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: transparent;
}

.repeat {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding: 12px 14px;
  font-family: var(--font-sans);
  background: color-mix(in srgb, var(--brand-soft) 70%, #fff);
  border: 1px dashed color-mix(in srgb, var(--brand) 35%, transparent);
  border-radius: 12px;
}

.repeat-ic {
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--brand);
}

.repeat-t {
  font-size: 14px;
  font-weight: 650;
  color: #1b1d27;
}

.repeat-s {
  margin-top: 1px;
  overflow: hidden;
  font-size: 12.5px;
  color: #5b6070;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more {
  padding: 0;
}

.more-sum {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--s-4) var(--s-5);
  font-weight: 600;
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.more-sum::-webkit-details-marker {
  display: none;
}

.more-ic {
  width: 18px;
  height: 18px;
  color: var(--text-3);
}

.more-n {
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  font-size: var(--text-xs);
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.more-caret {
  width: 16px;
  height: 16px;
  color: var(--text-3);
  transition: transform var(--t-fast);
}

.more[open] .more-caret {
  transform: rotate(180deg);
}

.more-body {
  padding: 0 var(--s-5) var(--s-5);
}

.att-hint {
  display: flex;
  gap: 10px;
  padding: var(--s-4) var(--s-5);
  font-size: var(--text-sm);
  color: var(--text-3);
}

.att-hint :deep(svg) {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 1px;
}

.m-bar {
  display: none;
}

.m-steps {
  display: none;
}

/* Sin sitio para la hoja y el panel a la vez (p. ej. 1280 px con el menú abierto): el panel baja */
@container editor (max-width: 1180px) {
  .ed-body {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Dos columnas que se rellenan sin huecos: «Más opciones» plegado no se estira a la altura de su vecina */
  .side {
    position: static;
    display: block;
    columns: 2 280px;
    column-gap: var(--s-4);
  }

  .side > * {
    break-inside: avoid;
    margin-bottom: var(--s-4);
  }
}

@media (max-width: 767px) {
  /* Pasos: 1 fechas y cliente · 2 conceptos · 3 la factura entera con sus opciones */
  .m-steps {
    position: sticky;
    top: calc(var(--topbar-h) + 64px);
    z-index: calc(var(--z-sticky) - 2);
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    padding: 8px var(--s-3);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border-subtle);
  }

  .m-step {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-3);
    border-radius: var(--r-full);
  }

  .m-step.on {
    color: var(--brand-text);
    background: var(--brand-soft);
  }

  .m-step-n {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-3);
    background: var(--surface-sunken);
    border-radius: 50%;
  }

  .m-step.on .m-step-n {
    color: var(--on-brand);
    background: var(--brand);
  }

  .m-step.done .m-step-n {
    color: var(--on-brand);
    background: var(--success-solid);
  }

  .editor[data-step='1'] .paper-head,
  .editor[data-step='1'] .paper-party:not(.client),
  .editor[data-step='1'] .desc-block,
  .editor[data-step='1'] .lines,
  .editor[data-step='1'] .bases,
  .editor[data-step='1'] .repeat,
  .editor[data-step='1'] .paper-bottom,
  .editor[data-step='1'] .paper-pay,
  .editor[data-step='1'] .side,
  .editor[data-step='2'] .paper-head,
  .editor[data-step='2'] .paper-meta,
  .editor[data-step='2'] .paper-parties,
  .editor[data-step='2'] .rect-box,
  .editor[data-step='2'] .paper-bottom,
  .editor[data-step='2'] .paper-pay,
  .editor[data-step='2'] .side {
    display: none;
  }

  .editor[data-step='1'] .paper-meta,
  .editor[data-step='2'] .repeat,
  .editor[data-step='2'] .desc-block {
    margin-top: 0;
  }

  .editor[data-step='2'] .repeat {
    margin-bottom: 20px;
  }

  .editor[data-step='1'] .paper-parties {
    margin-top: 24px;
  }

  .repeat {
    flex-wrap: wrap;
  }

  .repeat > .grow {
    flex-basis: calc(100% - 32px);
  }

  .repeat-s {
    display: -webkit-box;
    white-space: normal;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .ed-sub-long {
    display: none;
  }

  .ed-title h1 {
    font-size: var(--text-lg);
  }

  .repeat > :last-child {
    width: 100%;
  }

  .ed-bar-in,
  .ed-body {
    padding-left: var(--s-3);
    padding-right: var(--s-3);
  }

  .ed-actions,
  .add-hint {
    display: none;
  }

  .side {
    grid-template-columns: minmax(0, 1fr);
  }

  .m-bar {
    position: fixed;
    inset: auto 0 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4) calc(var(--s-3) + var(--safe-b));
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(14px);
    border-top: 1px solid var(--border);
  }

  .m-bar .grow {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  .m-bar strong {
    font-size: var(--text-lg);
  }
}
/* Hoja estrecha: concepto en su fila y las cifras debajo, con la cabecera sobre las cifras */
@container lines (max-width: 700px) {
  .l-head,
  .l-row {
    --cols: minmax(0, 0.8fr) minmax(0, 1.25fr) minmax(0, 0.75fr) minmax(0, 0.85fr) minmax(0, 1.25fr) 30px;
  }

  .l-head {
    grid-template-areas: 'qty price dto vat amount menu';
  }

  .l-head > :first-child {
    display: none;
  }

  .l-row {
    grid-template-areas:
      'desc desc desc desc desc menu'
      'qty price dto vat amount .';
    row-gap: 4px;
    padding: 10px 0;
  }

  .l-head > :nth-child(2),
  .l-row > :nth-child(2) { grid-area: qty; }
  .l-head > :nth-child(3),
  .l-row > :nth-child(3) { grid-area: price; }
  .l-head > :nth-child(4),
  .l-row > .l-dto { grid-area: dto; }
  .l-head > :nth-child(5),
  .l-row > .l-vat { grid-area: vat; }
  .l-head > :nth-child(6),
  .l-amount { grid-area: amount; }
  .l-desc { grid-area: desc; }
  .l-menu { grid-area: menu; }

  .l-row :deep(.numcell .cell),
  .l-row select.cell {
    background: var(--p-soft);
  }
}

/* Móvil: cada línea es una tarjeta con sus cifras etiquetadas y el importe al pie */
@container lines (max-width: 480px) {
  .l-head {
    display: none;
  }

  .l-row {
    grid-template-columns: repeat(3, minmax(0, 1fr)) 34px;
    grid-template-areas:
      'desc desc desc menu'
      'qty price vat vat'
      'dto amount amount amount';
    gap: 12px 8px;
    margin-bottom: 10px;
    padding: 12px;
    background: #fff;
    border: 1px solid var(--p-line);
    border-radius: 12px;
    box-shadow: 0 1px 2px rgb(16 24 40 / 0.04);
  }

  .l-row > [data-label]::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 4px;
    font-family: var(--font-sans);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: left;
    color: var(--p-text-3);
  }

  .l-row :deep(.numcell .cell),
  .l-row select.cell {
    height: 42px;
    font-size: 16px;
    background: var(--p-soft);
    border: 1px solid transparent;
    border-radius: 9px;
  }

  /* La etiqueta va dentro de la celda: el «€» se centra en el campo, no en el conjunto */
  .l-row :deep(.numcell .sfx) {
    top: auto;
    bottom: 21px;
    transform: translateY(50%);
  }

  .l-row :deep(.numcell .cell:focus),
  .l-row select.cell:focus {
    background: #fff;
    border-color: var(--p-accent);
  }

  /* El concepto, como un campo de verdad: lo primero que se rellena */
  .l-desc :deep(.desc) {
    min-height: 44px;
    padding: 10px 12px;
    font-size: 16px;
    background: var(--p-soft);
    border: 1px solid transparent;
    border-radius: 9px;
  }

  .l-desc :deep(.desc:focus) {
    background: #fff;
    border-color: var(--p-accent);
  }

  .l-menu {
    align-self: start;
  }

  .l-btn {
    width: 34px;
    height: 44px;
    opacity: 1;
  }

  /* Pie: descuento a la izquierda (pequeño) e importe de la línea a la derecha */
  .l-dto {
    max-width: 96px;
  }

  .l-amount {
    align-self: end;
    padding: 0 2px 9px;
    font-size: 17px;
    font-weight: 700;
    color: var(--p-text);
  }

  .l-amount::before {
    text-align: right !important;
    margin-bottom: 2px !important;
  }

  .l-add {
    padding-top: 4px;
  }

  .add-btn {
    justify-content: center;
    width: 100%;
    height: 46px;
    border: 1.5px dashed color-mix(in srgb, var(--p-accent) 40%, transparent);
    border-radius: 12px;
  }
}

.paper-number-edit {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}

.paper-number-edit .cell {
  width: auto;
  min-width: 140px;
  max-width: 240px;
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  text-align: right;
  margin: 0;
}
</style>
