<script setup lang="ts">
import type { BulkAction } from '~/components/ui/BulkBar.vue'
import type { MenuItem } from '~/components/ui/Menu.vue'

/** Listado de clientes o proveedores con búsqueda y actividad de los últimos 12 meses */
const props = defineProps<{ role: 'client' | 'supplier' }>()

interface ContactRow {
  id: number
  name: string
  tradeName: string | null
  nif: string | null
  email: string | null
  phone: string | null
  city: string | null
  kind: 'company' | 'person'
  isClient: boolean
  isSupplier: boolean
  logoUrl: string | null
  billed12m: number
  pending: number
  spent12m: number
  lastActivity: string | null
}

const toast = useToast()
const { confirm } = useConfirm()
const route = useRoute()
const router = useRouter()
const isClient = computed(() => props.role === 'client')
const base = computed(() => (isClient.value ? '/clientes' : '/proveedores'))

const q = ref('')
const qDebounced = refDebounced(q, 250)
const { data, status, refresh } = useFetch<ContactRow[]>('/api/contacts', {
  key: `contacts-${props.role}`,
  query: computed(() => ({ role: props.role, q: qDebounced.value.trim() || undefined })),
  lazy: true,
})

const rows = computed(() => data.value ?? [])
const firstLoad = computed(() => status.value === 'pending' && !data.value)

const totals = computed(() => ({
  count: rows.value.length,
  amount: rows.value.reduce((s, r) => s + (isClient.value ? r.billed12m : r.spent12m), 0),
  pending: rows.value.reduce((s, r) => s + r.pending, 0),
  active: rows.value.filter(r => r.lastActivity && daysUntil(r.lastActivity) > -90).length,
}))

// Alta: botón o ?nuevo=1 (paleta de comandos, menú Nuevo)
const creating = ref(false)
watch(() => route.query.nuevo, (v) => {
  if (v) creating.value = true
}, { immediate: true })
watch(creating, (v) => {
  if (!v && route.query.nuevo) router.replace({ query: { ...route.query, nuevo: undefined } })
})

async function onCreated(id: number) {
  await refresh()
  navigateTo(`${base.value}/${id}`)
}

async function removeContact(r: ContactRow) {
  let invCount = 0
  let quoteCount = 0
  let expCount = 0
  try {
    const detail = await $fetch<{ salesCount?: number, invoicesCount?: number, quotesCount?: number, expensesCount?: number }>(`/api/contacts/${r.id}`)
    invCount = detail.invoicesCount ?? 0
    quoteCount = detail.quotesCount ?? 0
    expCount = detail.expensesCount ?? 0
  }
  catch {}

  const totalSales = invCount + quoteCount
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
    body = `Se eliminará definitivamente a ${r.name}. Esta acción no se puede deshacer.`
  }

  const ok = await confirm({
    title: `¿Eliminar a ${r.name}?`,
    body,
    confirmLabel: totalSales > 0 || expCount > 0 ? 'Eliminar y desasignar' : 'Eliminar definitivamente',
    danger: true,
  })
  if (!ok) return

  try {
    const res = await $fetch<{ ok: boolean, unassignedSales?: number, unassignedExpenses?: number }>(`/api/contacts/${r.id}`, { method: 'DELETE' })
    const unassignedCount = (res.unassignedSales ?? 0) + (res.unassignedExpenses ?? 0)
    toast.success(
      isClient.value ? 'Cliente eliminado' : 'Proveedor eliminado',
      unassignedCount > 0 ? `Se han desasignado ${unassignedCount} documento(s) correctamente.` : r.name,
    )
    refresh()
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
}

function rowMenu(r: ContactRow): MenuItem[] {
  return [
    { label: 'Ver detalle', icon: 'ph:eye', to: `${base.value}/${r.id}` },
    { label: isClient.value ? 'Eliminar cliente' : 'Eliminar proveedor', icon: 'ph:trash', danger: true, onClick: () => removeContact(r) },
  ]
}

// ─── Selección: eliminar muchos de una vez ───

const NuxtLink = resolveComponent('NuxtLink')
const { selected, selectedSet, selectedRows, selecting, allSelected, toggle: pick, toggleAll, clear } = useSelection(rows)
const busy = ref(false)
const noun = (n: number) => (isClient.value ? (n === 1 ? 'cliente' : 'clientes') : (n === 1 ? 'proveedor' : 'proveedores'))

async function deleteBulk() {
  const picked = selectedRows.value
  const n = picked.length
  if (!n) return
  // También tienen el otro papel: desaparecen de las dos listas
  const both = picked.filter(r => (isClient.value ? r.isSupplier : r.isClient)).length
  const ok = await confirm({
    title: `¿Eliminar ${n} ${noun(n)}?`,
    body: [
      `Se borrarán sus fichas. Sus facturas, presupuestos y gastos no cambian: conservan nombre, NIF y dirección, pero quedarán sin ${isClient.value ? 'cliente' : 'proveedor'} vinculado.`,
      both ? `${both} también ${both === 1 ? (isClient.value ? 'es proveedor' : 'es cliente') : (isClient.value ? 'son proveedores' : 'son clientes')}: ${both === 1 ? 'desaparecerá' : 'desaparecerán'} también de ${isClient.value ? 'Proveedores' : 'Clientes'}.` : '',
      isClient.value ? 'Si alguno tiene facturas recurrentes, se quedarán sin cliente y no se emitirán hasta que les asignes otro.' : '',
      'Esta acción no se puede deshacer.',
    ].filter(Boolean).join('\n\n'),
    confirmLabel: `Eliminar ${n}`,
    danger: true,
  })
  if (!ok) return
  busy.value = true
  try {
    const res = await $fetch<{ deleted: number, unassignedSales: number, unassignedExpenses: number }>('/api/contacts/bulk', { method: 'DELETE', body: { ids: picked.map(r => r.id) } })
    const docs = res.unassignedSales + res.unassignedExpenses
    toast.success(`${res.deleted} ${noun(res.deleted)} ${res.deleted === 1 ? 'eliminado' : 'eliminados'}`, docs ? `${docs} ${docs === 1 ? 'documento desvinculado' : 'documentos desvinculados'}, con sus datos intactos` : undefined)
    clear()
  }
  catch (err) {
    toast.error('No se pudieron eliminar', errorMessage(err))
  }
  finally {
    busy.value = false
    await refresh()
  }
}

const bulkActions = computed<BulkAction[]>(() => [
  { label: 'Eliminar', icon: 'ph:trash', tone: 'danger', onClick: deleteBulk },
])

const t = computed(() => isClient.value
  ? { title: 'Clientes', sub: 'Quién te compra, cuánto te factura y quién te debe.', add: 'Nuevo cliente', amount: 'Facturado 12 m', emptyTitle: 'Aún no tienes clientes', emptyText: 'Añade tu primer cliente con su NIF y podrás facturarle en segundos.' }
  : { title: 'Proveedores', sub: 'A quién compras y cuánto gastas con cada uno.', add: 'Nuevo proveedor', amount: 'Gastado 12 m', emptyTitle: 'Aún no tienes proveedores', emptyText: 'Se crean solos al registrar gastos, o puedes añadirlos ahora.' })

useHead({ title: () => `${t.value.title} · NUMIQ` })
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>{{ t.title }}</h1>
        <p class="sub">{{ t.sub }}</p>
      </div>
      <div class="page-actions">
        <UiButton variant="primary" icon="ph:plus-bold" @click="creating = true">{{ t.add }}</UiButton>
      </div>
    </header>

    <section class="stats rise" :aria-label="`Resumen de ${t.title.toLowerCase()}`">
      <div class="stat">
        <p class="eyebrow">{{ isClient ? 'Clientes' : 'Proveedores' }}</p>
        <p class="v num">{{ totals.count }}</p>
        <p class="s">{{ totals.active }} con actividad en 90 días</p>
      </div>
      <div class="stat">
        <p class="eyebrow">{{ t.amount }}</p>
        <p class="v num">{{ eur(totals.amount, false) }}</p>
        <p class="s">Importe total {{ isClient ? 'de las facturas' : 'de los gastos' }}, con impuestos</p>
      </div>
      <div v-if="isClient" class="stat">
        <p class="eyebrow">Pendiente de cobro</p>
        <p class="v num" :class="{ warn: totals.pending > 0 }">{{ eur(totals.pending) }}</p>
        <p class="s">Facturas emitidas sin cobrar</p>
      </div>
    </section>

    <UiCard padding="none" class="rise list-card" style="--i: 1">
      <div class="toolbar">
        <UiInput v-model="q" icon="ph:magnifying-glass" :placeholder="`Buscar por nombre, NIF, email o ciudad`" :aria-label="`Buscar ${t.title.toLowerCase()}`" class="search" type="search" />
        <span v-if="status === 'pending' && data" class="refreshing" aria-hidden="true"><Icon name="ph:circle-notch" /></span>
        <UiButton
          v-if="rows.length"
          class="sel-toggle"
          :variant="selecting ? 'primary' : 'secondary'"
          :icon="selecting ? 'ph:x' : 'ph:check-square'"
          @click="selecting ? clear() : (selecting = true)"
        >
          {{ selecting ? 'Cancelar selección' : 'Seleccionar' }}
        </UiButton>
      </div>

      <div v-if="firstLoad" class="skeletons">
        <div v-for="i in 6" :key="i" class="sk-row">
          <div class="skeleton" style="width: 34px; height: 34px; border-radius: 50%" />
          <div class="grow">
            <div class="skeleton" style="width: 40%; height: 12px" />
            <div class="skeleton" style="width: 22%; height: 10px; margin-top: 8px" />
          </div>
          <div class="skeleton" style="width: 90px; height: 12px" />
        </div>
      </div>

      <UiEmpty v-else-if="!rows.length && !q" :icon="isClient ? 'ph:users' : 'ph:storefront'" :title="t.emptyTitle" :text="t.emptyText">
        <UiButton variant="primary" icon="ph:plus-bold" @click="creating = true">{{ t.add }}</UiButton>
      </UiEmpty>

      <UiEmpty v-else-if="!rows.length" compact icon="ph:magnifying-glass" title="Sin resultados" :text="`Nada coincide con «${q}».`">
        <UiButton @click="q = ''">Limpiar búsqueda</UiButton>
      </UiEmpty>

      <template v-else>
        <div class="table-wrap desktop">
          <table class="table">
            <thead>
              <tr>
                <th class="pick">
                  <input
                    type="checkbox"
                    :checked="allSelected"
                    :indeterminate="!!selected.length && !allSelected"
                    :aria-label="allSelected ? 'Quitar la selección' : 'Seleccionar todos'"
                    @change="toggleAll"
                  >
                </th>
                <th>Nombre</th>
                <th>Población</th>
                <th>Contacto</th>
                <th class="r">{{ t.amount }}</th>
                <th v-if="isClient" class="r">Pendiente</th>
                <th class="r">Última actividad</th>
                <th class="act-col"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in rows"
                :key="r.id"
                class="clickable"
                :class="{ sel: selectedSet.has(r.id) }"
                tabindex="0"
                @click="navigateTo(`${base}/${r.id}`)"
                @keydown.enter.self="navigateTo(`${base}/${r.id}`)"
              >
                <td class="pick" @click.stop="pick(r.id, $event)">
                  <input
                    type="checkbox"
                    :checked="selectedSet.has(r.id)"
                    :aria-label="`Seleccionar ${r.name}`"
                    @click.stop="pick(r.id, $event)"
                  >
                </td>
                <td>
                  <div class="who">
                    <UiAvatar :name="r.name" :size="34" :square="r.kind === 'company'" :src="r.logoUrl" contain />
                    <div class="who-t">
                      <span class="strong truncate">{{ r.name }}</span>
                      <span class="sub mono">{{ r.nif || 'Sin NIF' }}</span>
                    </div>
                  </div>
                </td>
                <td class="muted">{{ r.city || '—' }}</td>
                <td>
                  <span class="truncate contact-l">{{ r.email || '—' }}</span>
                  <span v-if="r.phone" class="sub">{{ r.phone }}</span>
                </td>
                <td class="r num strong">{{ eur(isClient ? r.billed12m : r.spent12m) }}</td>
                <td v-if="isClient" class="r num">
                  <span v-if="r.pending > 0" class="pending">{{ eur(r.pending) }}</span>
                  <span v-else class="muted">—</span>
                </td>
                <td class="r muted">{{ r.lastActivity ? relDays(r.lastActivity) : '—' }}</td>
                <td class="act-col" @click.stop @keydown.stop>
                  <UiMenu :items="rowMenu(r)" :width="190">
                    <template #default="{ toggle }">
                      <UiButton variant="ghost" size="sm" square icon="ph:dots-three-bold" :aria-label="`Acciones de ${r.name}`" @click="toggle" />
                    </template>
                  </UiMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ul class="cards mobile">
          <li v-for="r in rows" :key="r.id">
            <div class="card-item-wrap" :class="{ sel: selectedSet.has(r.id) }">
              <!-- En modo selección la fila marca en lugar de abrir -->
              <component
                :is="selecting ? 'button' : NuxtLink"
                :to="selecting ? undefined : `${base}/${r.id}`"
                :type="selecting ? 'button' : undefined"
                :aria-pressed="selecting ? selectedSet.has(r.id) : undefined"
                class="card-row"
                @click="selecting && pick(r.id)"
              >
                <span v-if="selecting" class="tick" :class="{ on: selectedSet.has(r.id) }" aria-hidden="true">
                  <Icon v-if="selectedSet.has(r.id)" name="ph:check-bold" />
                </span>
                <UiAvatar v-else :name="r.name" :size="38" :square="r.kind === 'company'" :src="r.logoUrl" contain />
                <div class="grow">
                  <p class="strong truncate">{{ r.name }}</p>
                  <p class="sub">{{ [r.nif, r.city].filter(Boolean).join(' · ') || 'Sin NIF' }}</p>
                </div>
                <div class="amt">
                  <p class="num strong">{{ eur(isClient ? r.billed12m : r.spent12m, false) }}</p>
                  <p v-if="isClient && r.pending > 0" class="sub pending num">{{ eur(r.pending, false) }} pend.</p>
                </div>
              </component>
              <div class="m-menu" @click.stop @keydown.stop>
                <UiMenu :items="rowMenu(r)" :width="190">
                  <template #default="{ toggle }">
                    <UiButton variant="ghost" size="sm" square icon="ph:dots-three-bold" :aria-label="`Acciones de ${r.name}`" @click="toggle" />
                  </template>
                </UiMenu>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </UiCard>

    <UiBulkBar
      :count="selected.length"
      :total="rows.length"
      :title="`${noun(selected.length)} ${selected.length === 1 ? 'seleccionado' : 'seleccionados'}`"
      :actions="bulkActions"
      :busy="busy"
      :label="`Acciones con los ${isClient ? 'clientes' : 'proveedores'} seleccionados`"
      @all="toggleAll"
      @clear="clear"
    />

    <ContactModal v-model="creating" :role="role" :prefill-name="q.trim() || undefined" @saved="onCreated" />
  </div>
</template>

<style scoped>
.act-col {
  width: 50px;
  text-align: right;
  padding-right: var(--s-3);
}

.card-item-wrap {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.card-item-wrap .card-row {
  flex: 1;
  min-width: 0;
}

.m-menu {
  flex-shrink: 0;
  padding-right: var(--s-2);
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--s-4);
  margin-bottom: var(--s-5);
}

.stat {
  padding: var(--s-4) var(--s-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.stat .v {
  margin-top: 6px;
  font-size: var(--text-2xl);
  font-weight: 680;
  letter-spacing: -0.025em;
}

.stat .v.warn {
  color: var(--warning);
}

.stat .s {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-5);
  border-bottom: 1px solid var(--border-subtle);
}

.search {
  width: 100%;
  max-width: 380px;
}

.refreshing {
  display: inline-flex;
  color: var(--text-3);
  animation: spin 0.8s linear infinite;
}

.who {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  max-width: 340px;
}

.who-t {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.contact-l {
  display: block;
  max-width: 240px;
}

.pending {
  color: var(--warning);
  font-weight: 560;
}

.skeletons {
  padding: var(--s-2) var(--s-5) var(--s-4);
}

.sk-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.sk-row:last-child {
  border-bottom: 0;
}

.cards {
  display: none;
  list-style: none;
  padding: 0;
}

.card-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px var(--s-4);
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--t-fast);
}

.card-row:active {
  background: var(--surface-hover);
}

.cards li:last-child .card-row {
  border-bottom: 0;
}

.card-row .sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.card-row .strong {
  font-weight: 580;
}

.amt {
  text-align: right;
  flex-shrink: 0;
}

/* ─── Selección ─── */

.pick {
  width: 1%;
  padding-right: 0 !important;
  cursor: default;
}

input[type='checkbox'] {
  display: block;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--brand);
  cursor: pointer;
}

.table tbody tr.sel,
.card-item-wrap.sel {
  background: color-mix(in srgb, var(--brand) 6%, transparent);
}

.table tbody tr.sel:hover {
  background: color-mix(in srgb, var(--brand) 9%, transparent);
}

button.card-row {
  width: 100%;
  text-align: left;
}

.tick {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  font-size: 16px;
  color: var(--on-brand);
  background: var(--surface);
  border: 1.5px solid var(--border-strong);
  border-radius: 10px;
  transition: background var(--t-fast), border-color var(--t-fast);
}

.tick.on {
  background: var(--brand);
  border-color: var(--brand);
}

.sel-toggle {
  display: none;
}

@media (max-width: 767px) {
  .desktop {
    display: none;
  }

  .cards {
    display: block;
  }

  .toolbar {
    padding: var(--s-3) var(--s-4);
  }

  .search {
    max-width: none;
  }

  .toolbar {
    flex-wrap: wrap;
  }

  .sel-toggle {
    display: inline-flex;
    width: 100%;
  }

  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
  }

  .stat {
    padding: var(--s-3) var(--s-4);
  }

  .stat .v {
    font-size: var(--text-xl);
  }
}
</style>
