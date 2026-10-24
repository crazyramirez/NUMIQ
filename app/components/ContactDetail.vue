<script setup lang="ts">
import type { MenuItem } from '~/components/ui/Menu.vue'

/** Ficha de cliente o proveedor: cifras, documentos y datos */
const props = defineProps<{ role: 'client' | 'supplier', id: number }>()

interface DocRow {
  id: number
  kind: string
  status: string
  number: string | null
  issueDate: string
  dueDate: string | null
  taxBase: number
  total: number
  paidTotal: number
}

interface ExpenseRow {
  id: number
  number: string | null
  issueDate: string
  description: string | null
  total: number
  status: string
}

interface ContactFull {
  id: number
  isClient: boolean
  isSupplier: boolean
  kind: 'company' | 'person'
  name: string
  tradeName: string | null
  nif: string | null
  nifType: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  country: string
  iban: string | null
  paymentTermsDays: number | null
  irpfRate: number | null
  equivalenceSurcharge: boolean
  notes: string | null
  logoUrl: string | null
  createdAt: string
  documents: DocRow[]
  expenses: ExpenseRow[]
  salesCount?: number
  invoicesCount?: number
  quotesCount?: number
  expensesCount?: number
}

const toast = useToast()
const { confirm } = useConfirm()
const isClient = computed(() => props.role === 'client')
const listPath = computed(() => (isClient.value ? '/clientes' : '/proveedores'))

const { data: c, status, refresh, error } = useFetch<ContactFull>(() => `/api/contacts/${props.id}`, {
  key: `contact-${props.id}`,
  lazy: true,
})

useHead({ title: () => `${c.value?.name ?? (isClient.value ? 'Cliente' : 'Proveedor')} · NUMIQ` })

const today = todayISO()
const isOpen = (s: string) => ['issued', 'sent', 'partial'].includes(s)
const invoices = computed(() => (c.value?.documents ?? []).filter(d => d.kind === 'invoice' || d.kind === 'rectifying'))
const quotes = computed(() => (c.value?.documents ?? []).filter(d => d.kind === 'quote' || d.kind === 'proforma'))
const expenses = computed(() => c.value?.expenses ?? [])

const kpis = computed(() => {
  const emitted = invoices.value.filter(d => !['draft', 'cancelled'].includes(d.status))
  const open = emitted.filter(d => isOpen(d.status))
  const overdue = open.filter(d => d.dueDate && d.dueDate < today)
  const yearStart = `${today.slice(0, 4)}-01-01`
  return {
    billed: emitted.reduce((s, d) => s + d.total, 0),
    billedYear: emitted.filter(d => d.issueDate >= yearStart).reduce((s, d) => s + d.total, 0),
    pending: open.reduce((s, d) => s + (d.total - d.paidTotal), 0),
    overdue: overdue.reduce((s, d) => s + (d.total - d.paidTotal), 0),
    overdueCount: overdue.length,
    count: emitted.length,
    avg: emitted.length ? emitted.reduce((s, d) => s + d.total, 0) / emitted.length : 0,
    spent: expenses.value.reduce((s, e) => s + e.total, 0),
    spentYear: expenses.value.filter(e => e.issueDate >= yearStart).reduce((s, e) => s + e.total, 0),
    toPay: expenses.value.filter(e => e.status !== 'paid').reduce((s, e) => s + e.total, 0),
  }
})

const tabs = computed(() => {
  const t: Array<{ value: string, label: string, count?: number }> = []
  if (c.value?.isClient) {
    t.push({ value: 'facturas', label: 'Facturas', count: invoices.value.length })
    t.push({ value: 'presupuestos', label: 'Presupuestos', count: quotes.value.length })
  }
  if (c.value?.isSupplier) t.push({ value: 'gastos', label: 'Gastos', count: expenses.value.length })
  return t
})
const tab = ref(props.role === 'client' ? 'facturas' : 'gastos')

const editing = ref(false)

async function remove() {
  if (!c.value) return
  const invCount = c.value.invoicesCount ?? invoices.value.length
  const quoteCount = c.value.quotesCount ?? quotes.value.length
  const totalSales = invCount + quoteCount
  const expCount = c.value.expensesCount ?? expenses.value.length

  let body = ''
  if (totalSales > 0 && expCount > 0) {
    body = `Este contacto tiene ${invCount} ${invCount === 1 ? 'factura' : 'facturas'}${quoteCount ? ` (${quoteCount} presupuestos)` : ''} y ${expCount} ${expCount === 1 ? 'gasto asignado' : 'gastos asignados'}.\n\nSi aceptas, el contacto se eliminará definitivamente y esos documentos quedarán desasignados (se conservan todos sus datos de emisión e importes, pero quedarán sin contacto vinculado).`
  }
  else if (totalSales > 0) {
    body = `Este cliente tiene ${invCount} ${invCount === 1 ? 'factura asignada' : 'facturas asignadas'}${quoteCount ? ` y ${quoteCount} ${quoteCount === 1 ? 'presupuesto' : 'presupuestos'}` : ''}.\n\nSi aceptas, el cliente se eliminará definitivamente y las facturas se desasignarán (se conservan todos sus datos de emisión e importes, pero quedarán sin ficha de cliente vinculada).`
  }
  else if (expCount > 0) {
    body = `Este proveedor tiene ${expCount} ${expCount === 1 ? 'gasto asignado' : 'gastos asignados'}.\n\nSi aceptas, el proveedor se eliminará definitivamente y los gastos se desasignarán (se conservan todos sus datos e importes, pero quedarán sin proveedor vinculado).`
  }
  else {
    body = `Se eliminará definitivamente a ${c.value.name}. Esta acción no se puede deshacer.`
  }

  const ok = await confirm({
    title: `¿Eliminar a ${c.value.name}?`,
    body,
    confirmLabel: totalSales > 0 || expCount > 0 ? 'Eliminar y desasignar' : 'Eliminar definitivamente',
    danger: true,
  })
  if (!ok) return

  try {
    const res = await $fetch<{ ok: boolean, unassignedSales?: number, unassignedExpenses?: number }>(`/api/contacts/${props.id}`, { method: 'DELETE' })
    const unassignedCount = (res.unassignedSales ?? 0) + (res.unassignedExpenses ?? 0)
    toast.success(
      isClient.value ? 'Cliente eliminado' : 'Proveedor eliminado',
      unassignedCount > 0 ? `Se han desasignado ${unassignedCount} documento(s) correctamente.` : c.value.name,
    )
    navigateTo(listPath.value)
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
}

async function archive() {
  if (!c.value) return
  const ok = await confirm({
    title: `¿Archivar a ${c.value.name}?`,
    body: 'Dejará de aparecer en listados y buscadores. Sus facturas y gastos se conservan intactos.',
    confirmLabel: 'Archivar',
  })
  if (!ok) return
  try {
    await $fetch(`/api/contacts/${props.id}/archive`, { method: 'POST' })
    toast.success('Contacto archivado', c.value.name)
    navigateTo(listPath.value)
  }
  catch (err) {
    toast.error('No se pudo archivar', errorMessage(err))
  }
}

const moreItems = computed<MenuItem[]>(() => [
  ...(c.value?.email ? [{ label: 'Enviar email', icon: 'ph:envelope-simple', onClick: () => window.open(`mailto:${c.value!.email}`) }] : []),
  ...(c.value?.isSupplier ? [{ label: 'Registrar gasto', icon: 'ph:wallet', to: `/gastos?nuevo=1&proveedor=${props.id}` }] : []),
  ...(c.value?.isClient ? [{ label: 'Nuevo presupuesto', icon: 'ph:file-text', to: `/presupuestos/nuevo?cliente=${props.id}` }] : []),
  { divider: true },
  { label: 'Archivar', icon: 'ph:archive', onClick: archive },
  { label: isClient.value ? 'Eliminar cliente' : 'Eliminar proveedor', icon: 'ph:trash', danger: true, onClick: remove },
])

const address = computed(() => {
  const x = c.value
  if (!x) return ''
  return [x.address, [x.postalCode, x.city].filter(Boolean).join(' '), x.province, x.country !== 'ES' ? x.country : null].filter(Boolean).join('\n')
})

const docPath = (d: DocRow) => (d.kind === 'quote' || d.kind === 'proforma' ? `/presupuestos/${d.id}` : `/facturas/${d.id}`)
const docStatus = (d: DocRow) => salesStatus(d.kind, d.status, isOpen(d.status) && !!d.dueDate && d.dueDate < today)
const expenseStatus = (e: ExpenseRow) => e.status === 'paid' ? { label: 'Pagado', tone: 'success' as const } : e.status === 'partial' ? { label: 'Pago parcial', tone: 'warning' as const } : { label: 'Pendiente', tone: 'warning' as const }
const nifTypeLabel: Record<string, string> = { nif: 'NIF', vat_eu: 'NIF-IVA', passport: 'Pasaporte', other: 'Documento' }
</script>

<template>
  <div class="page">
    <NuxtLink :to="listPath" class="back">
      <Icon name="ph:arrow-left" aria-hidden="true" /> {{ isClient ? 'Clientes' : 'Proveedores' }}
    </NuxtLink>

    <div v-if="error" class="card">
      <UiEmpty icon="ph:warning-circle" title="No encontramos este contacto" :text="errorMessage(error)">
        <UiButton :to="listPath">Volver al listado</UiButton>
      </UiEmpty>
    </div>

    <template v-else-if="!c && status === 'pending'">
      <div class="head-sk">
        <div class="skeleton" style="width: 64px; height: 64px; border-radius: 18px" />
        <div class="grow">
          <div class="skeleton" style="width: 280px; height: 24px" />
          <div class="skeleton" style="width: 160px; height: 14px; margin-top: 10px" />
        </div>
      </div>
      <div class="kpis">
        <div v-for="i in 4" :key="i" class="skeleton" style="height: 92px; border-radius: 16px" />
      </div>
    </template>

    <template v-else-if="c">
      <header class="hero rise">
        <UiAvatar :name="c.name" :size="64" :square="c.kind === 'company'" :src="c.logoUrl" contain />
        <div class="grow hero-t">
          <h1>{{ c.name }}</h1>
          <div class="chips">
            <span v-if="c.nif" class="mono nif">{{ nifTypeLabel[c.nifType] ?? 'NIF' }} {{ c.nif }}</span>
            <UiBadge v-else tone="warning" icon="ph:warning">Sin NIF</UiBadge>
            <UiBadge v-if="c.isClient" tone="brand">Cliente</UiBadge>
            <UiBadge v-if="c.isSupplier" tone="info">Proveedor</UiBadge>
            <UiBadge v-if="c.equivalenceSurcharge" tone="neutral">Recargo de equivalencia</UiBadge>
            <span v-if="c.tradeName" class="muted">{{ c.tradeName }}</span>
          </div>
        </div>
        <div class="page-actions">
          <UiButton icon="ph:pencil-simple" @click="editing = true">Editar</UiButton>
          <UiButton v-if="isClient" variant="primary" icon="ph:receipt" :to="`/facturas/nueva?cliente=${c.id}`">Nueva factura</UiButton>
          <UiButton v-else variant="primary" icon="ph:wallet" :to="`/gastos?nuevo=1&proveedor=${c.id}`">Registrar gasto</UiButton>
          <UiMenu :items="moreItems" :width="210">
            <template #default="{ toggle }">
              <UiButton square icon="ph:dots-three-bold" aria-label="Más acciones" @click="toggle" />
            </template>
          </UiMenu>
        </div>
      </header>

      <section class="kpis">
        <template v-if="isClient">
          <div class="kpi rise" style="--i: 1">
            <p class="eyebrow">Facturado total</p>
            <p class="v num">{{ eur(kpis.billed) }}</p>
            <p class="s">{{ kpis.count }} {{ kpis.count === 1 ? 'factura' : 'facturas' }} · media {{ eur(kpis.avg, false) }}</p>
          </div>
          <div class="kpi rise" style="--i: 2">
            <p class="eyebrow">Este año</p>
            <p class="v num">{{ eur(kpis.billedYear) }}</p>
            <p class="s">Con impuestos, desde el 1 de enero</p>
          </div>
          <div class="kpi rise" style="--i: 3">
            <p class="eyebrow">Pendiente de cobro</p>
            <p class="v num" :class="{ warn: kpis.pending > 0 }">{{ eur(kpis.pending) }}</p>
            <p class="s">{{ kpis.pending > 0 ? 'IVA incluido, menos retenciones' : 'Todo cobrado' }}</p>
          </div>
          <div class="kpi rise" style="--i: 4" :class="{ alert: kpis.overdueCount }">
            <p class="eyebrow">Vencido</p>
            <p class="v num" :class="{ bad: kpis.overdue > 0 }">{{ eur(kpis.overdue) }}</p>
            <p class="s">{{ kpis.overdueCount ? `${kpis.overdueCount} ${kpis.overdueCount === 1 ? 'factura' : 'facturas'} fuera de plazo` : 'Sin retrasos' }}</p>
          </div>
        </template>
        <template v-else>
          <div class="kpi rise" style="--i: 1">
            <p class="eyebrow">Gastado total</p>
            <p class="v num">{{ eur(kpis.spent) }}</p>
            <p class="s">{{ expenses.length }} {{ expenses.length === 1 ? 'gasto' : 'gastos' }} registrados</p>
          </div>
          <div class="kpi rise" style="--i: 2">
            <p class="eyebrow">Este año</p>
            <p class="v num">{{ eur(kpis.spentYear) }}</p>
            <p class="s">Con impuestos, desde el 1 de enero</p>
          </div>
          <div class="kpi rise" style="--i: 3">
            <p class="eyebrow">Pendiente de pago</p>
            <p class="v num" :class="{ warn: kpis.toPay > 0 }">{{ eur(kpis.toPay) }}</p>
            <p class="s">{{ kpis.toPay > 0 ? 'Gastos sin marcar como pagados' : 'Todo pagado' }}</p>
          </div>
        </template>
      </section>

      <div class="layout">
        <UiCard padding="none" class="rise docs" style="--i: 2">
          <template #head>
            <UiSegmented v-if="tabs.length > 1" v-model="tab" :options="tabs" label="Documentos" />
            <h2 v-else class="section-title">{{ tabs[0]?.label ?? 'Documentos' }}</h2>
          </template>

          <template v-if="tab === 'facturas' || tab === 'presupuestos'">
            <UiEmpty
              v-if="!(tab === 'facturas' ? invoices : quotes).length"
              compact
              :icon="tab === 'facturas' ? 'ph:receipt' : 'ph:file-text'"
              :title="tab === 'facturas' ? 'Sin facturas todavía' : 'Sin presupuestos todavía'"
              text="Cuando emitas uno aparecerá aquí con su estado de cobro."
            >
              <UiButton variant="soft" icon="ph:plus-bold" :to="tab === 'facturas' ? `/facturas/nueva?cliente=${c.id}` : `/presupuestos/nuevo?cliente=${c.id}`">
                {{ tab === 'facturas' ? 'Crear factura' : 'Crear presupuesto' }}
              </UiButton>
            </UiEmpty>
            <div v-else class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Fecha</th>
                    <th class="hide-sm">{{ tab === 'facturas' ? 'Vencimiento' : 'Válido hasta' }}</th>
                    <th>Estado</th>
                    <th class="r">{{ tab === 'facturas' ? 'Total' : 'Base imponible' }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="d in (tab === 'facturas' ? invoices : quotes)"
                    :key="d.id"
                    class="clickable"
                    tabindex="0"
                    @click="navigateTo(docPath(d))"
                    @keydown.enter="navigateTo(docPath(d))"
                  >
                    <td class="strong mono">{{ d.number ?? 'Borrador' }}</td>
                    <td class="muted">{{ fdate(d.issueDate) }}</td>
                    <td class="muted hide-sm">{{ d.dueDate ? fdate(d.dueDate) : '—' }}</td>
                    <td><UiBadge :tone="docStatus(d).tone" dot>{{ docStatus(d).label }}</UiBadge></td>
                    <td class="r num strong">{{ eur(tab === 'facturas' ? d.total : d.taxBase) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <template v-else>
            <UiEmpty v-if="!expenses.length" compact icon="ph:wallet" title="Sin gastos todavía" text="Registra sus facturas para controlar lo que te cuesta.">
              <UiButton variant="soft" icon="ph:plus-bold" :to="`/gastos?nuevo=1&proveedor=${c.id}`">Registrar gasto</UiButton>
            </UiEmpty>
            <div v-else class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th>Estado</th>
                    <th class="r">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="e in expenses"
                    :key="e.id"
                    class="clickable"
                    tabindex="0"
                    @click="navigateTo(`/gastos?ver=${e.id}`)"
                    @keydown.enter="navigateTo(`/gastos?ver=${e.id}`)"
                  >
                    <td class="muted">{{ fdate(e.issueDate) }}</td>
                    <td>
                      <span class="strong">{{ e.description || 'Gasto' }}</span>
                      <span v-if="e.number" class="sub mono">{{ e.number }}</span>
                    </td>
                    <td><UiBadge :tone="expenseStatus(e).tone" dot>{{ expenseStatus(e).label }}</UiBadge></td>
                    <td class="r num strong">{{ eur(e.total) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </UiCard>

        <UiCard title="Datos" icon="ph:identification-card" class="rise data" style="--i: 3">
          <template #actions>
            <UiButton size="sm" variant="ghost" icon="ph:pencil-simple" @click="editing = true">Editar</UiButton>
          </template>
          <dl class="dl">
            <div v-if="c.email">
              <dt>Email</dt>
              <dd><a :href="`mailto:${c.email}`" class="link">{{ c.email }}</a></dd>
            </div>
            <div v-if="c.phone">
              <dt>Teléfono</dt>
              <dd><a :href="`tel:${c.phone.replace(/\s/g, '')}`" class="link">{{ c.phone }}</a></dd>
            </div>
            <div v-if="address">
              <dt>Dirección</dt>
              <dd class="pre">{{ address }}</dd>
            </div>
            <div v-if="c.website">
              <dt>Web</dt>
              <dd><a :href="c.website.startsWith('http') ? c.website : `https://${c.website}`" target="_blank" rel="noopener" class="link">{{ c.website }}</a></dd>
            </div>
            <div v-if="c.iban">
              <dt>IBAN</dt>
              <dd class="mono">{{ c.iban.replace(/(.{4})/g, '$1 ').trim() }}</dd>
            </div>
            <div>
              <dt>Plazo de pago</dt>
              <dd>{{ c.paymentTermsDays != null ? `${c.paymentTermsDays} días` : 'El de la empresa' }}</dd>
            </div>
            <div v-if="c.irpfRate != null">
              <dt>Retención IRPF</dt>
              <dd>{{ pct(c.irpfRate) }}</dd>
            </div>
            <div>
              <dt>Alta</dt>
              <dd>{{ fdate(c.createdAt) }}</dd>
            </div>
          </dl>
          <div v-if="c.notes" class="notes">
            <p class="eyebrow">Notas</p>
            <p class="pre">{{ c.notes }}</p>
          </div>
          <p v-if="!c.email && !c.phone && !address" class="hint missing">
            <Icon name="ph:info" /> Completa su dirección y email para que aparezcan en las facturas y poder enviárselas.
          </p>
        </UiCard>
      </div>

      <ContactModal v-model="editing" :role="role" :contact-id="c.id" @saved="refresh()" />
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--s-4);
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-3);
  transition: color var(--t-fast);
}

.back:hover {
  color: var(--text);
}

.head-sk,
.hero {
  display: flex;
  align-items: center;
  gap: var(--s-5);
  margin-bottom: var(--s-6);
}

.hero {
  flex-wrap: wrap;
}

.hero-t {
  min-width: 220px;
}

.hero h1 {
  font-size: var(--text-3xl);
  font-weight: 680;
  letter-spacing: -0.028em;
}

.chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.nif {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--s-4);
  margin-bottom: var(--s-5);
}

.kpi {
  padding: var(--s-4) var(--s-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.kpi.alert {
  border-color: color-mix(in srgb, var(--danger-solid) 30%, var(--border));
}

.kpi .v {
  margin-top: 6px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.025em;
}

.kpi .v.warn {
  color: var(--warning);
}

.kpi .v.bad {
  color: var(--danger);
}

.kpi .s {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--s-5);
  align-items: start;
}

.dl {
  display: grid;
  gap: 14px;
}

.dl dt {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.dl dd {
  margin: 2px 0 0;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.pre {
  white-space: pre-line;
}

.notes {
  margin-top: var(--s-5);
  padding-top: var(--s-4);
  border-top: 1px solid var(--border-subtle);
}

.notes .pre {
  margin-top: 4px;
  color: var(--text-2);
}

.missing {
  display: flex;
  gap: 8px;
  margin-top: var(--s-5);
  padding: 10px 12px;
  background: var(--surface-2);
  border-radius: var(--r-md);
}

.missing :deep(svg) {
  flex-shrink: 0;
  margin-top: 2px;
}

@media (max-width: 1023px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 767px) {
  .hero {
    gap: var(--s-4);
  }

  .hero h1 {
    font-size: var(--text-2xl);
  }

  .hero .page-actions {
    width: 100%;
  }

  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
  }

  .kpi {
    padding: var(--s-3) var(--s-4);
  }

  .kpi .v {
    font-size: var(--text-lg);
  }

  .hide-sm {
    display: none;
  }
}
</style>
