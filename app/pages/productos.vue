<script setup lang="ts">
import type { ItemCategory } from '~/components/ItemCategoriesModal.vue'
import type { BulkAction } from '~/components/ui/BulkBar.vue'
import type { MenuItem } from '~/components/ui/Menu.vue'
import type { CtxItem, CtxSpec } from '~/composables/useContextMenu'

interface Item {
  id: number
  kind: 'service' | 'product'
  name: string
  description: string | null
  sku: string | null
  unit: string | null
  unitPrice: number
  vatRate: number
  imageUrl: string | null
  categoryId: number | null
  uses: number
  revenue: number
  lastUsed: string | null
}

useHead({ title: 'Productos y servicios · NUMIQ' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()

const { data, status, refresh } = useFetch<Item[]>('/api/items', { key: 'items', lazy: true })
const items = computed(() => data.value ?? [])

// ─── Categorías ───
const { data: catData, refresh: refreshCats } = useFetch<ItemCategory[]>('/api/item-categories', { key: 'item-categories', lazy: true })
const categories = computed(() => catData.value ?? [])
const catById = computed(() => new Map(categories.value.map(c => [c.id, c])))
const catsOpen = ref(false)
/** Filtro: null todas, 'none' sin categoría */
const cat = useQueryState<number | 'none' | null>('categoria', null, { parse: r => (r === 'none' ? 'none' : Number(r) || undefined) })

function refreshAll() {
  return Promise.all([refresh(), refreshCats()])
}

// Si la categoría filtrada desaparece, se vuelve a ver todo
watch(categories, (list) => {
  if (typeof cat.value === 'number' && !list.some(c => c.id === cat.value)) cat.value = null
})

// Búsqueda y filtros en la URL: al volver atrás, el catálogo sigue igual
const q = useQueryState('q', '', { debounce: 250 })
const kind = useQueryState('tipo', 'all', { allowed: ['all', 'service', 'product'] })
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const byKind = computed(() => items.value.filter(i => kind.value === 'all' || i.kind === kind.value))
const catCount = (id: number | null) => byKind.value.filter(i => i.categoryId === id).length

const filtered = computed(() => {
  const term = norm(q.value.trim())
  return byKind.value
    .filter(i => cat.value == null || (cat.value === 'none' ? !i.categoryId : i.categoryId === cat.value))
    .filter(i => !term || norm(`${i.name} ${i.description ?? ''} ${i.sku ?? ''} ${i.categoryId ? catById.value.get(i.categoryId)?.name ?? '' : ''}`).includes(term))
})

const kindOptions = computed(() => [
  { value: 'all', label: 'Todos', count: items.value.length || null },
  { value: 'service', label: 'Servicios', count: items.value.filter(i => i.kind === 'service').length || null },
  { value: 'product', label: 'Productos', count: items.value.filter(i => i.kind === 'product').length || null },
])

const top = computed(() => [...items.value].filter(i => i.revenue > 0).sort((a, b) => b.revenue - a.revenue)[0] ?? null)
const totalRevenue = computed(() => items.value.reduce((s, i) => s + i.revenue, 0))
const unused = computed(() => items.value.filter(i => !i.uses).length)

const withVat = (i: Item) => round2(i.unitPrice * (1 + i.vatRate / 100))
const maxRevenue = computed(() => Math.max(1, ...items.value.map(i => i.revenue)))

// Alta y edición
const modalOpen = ref(false)
const editingId = ref<number | null>(null)

function openNew() {
  editingId.value = null
  modalOpen.value = true
}

function openEdit(id: number) {
  editingId.value = id
  modalOpen.value = true
}

watch(() => route.query.nuevo, (v) => {
  if (v) openNew()
}, { immediate: true })
watch(modalOpen, (v) => {
  if (!v && route.query.nuevo) router.replace({ query: { ...route.query, nuevo: undefined } })
})

const removeItem = useItemDelete()

async function remove(i: Item) {
  if (await removeItem(i)) refreshAll()
}

const rowMenu = (i: Item): MenuItem[] => [
  { label: 'Editar', icon: 'ph:pencil-simple', onClick: () => openEdit(i.id) },
  { label: 'Facturar', icon: 'ph:receipt', to: `/facturas/nueva?producto=${i.id}` },
  { divider: true },
  { label: 'Eliminar', icon: 'ph:trash', danger: true, onClick: () => remove(i) },
]

// ─── Páginas de 25 y selección (de la página a la vista): eliminar o mover de categoría muchos de una vez ───

const { page, pages, items: shown, size: pageSize, total: pageTotal } = usePaged(filtered, [q, kind, cat], 'pagina')
const sel = useSelection(filtered, shown)
const busy = ref(false)

function onMain(i: Item) {
  if (sel.selecting.value) sel.toggle(i.id)
  else openEdit(i.id)
}

/** «3 servicios y 2 productos» */
function describe(ids: number[]) {
  const set = new Set(ids)
  const picked = items.value.filter(i => set.has(i.id))
  const s = picked.filter(i => i.kind === 'service').length
  const p = picked.length - s
  return [
    s ? `${s} ${s === 1 ? 'servicio' : 'servicios'}` : '',
    p ? `${p} ${p === 1 ? 'producto' : 'productos'}` : '',
  ].filter(Boolean).join(' y ')
}

async function deleteBulk(ids: number[]) {
  if (!ids.length) return
  // Uno solo: el aviso de siempre, con las facturas que lo usan
  if (ids.length === 1) {
    const one = items.value.find(i => i.id === ids[0])
    if (one && await removeItem(one)) {
      sel.clear()
      refreshAll()
    }
    return
  }
  const what = describe(ids)
  const ok = await confirm({
    title: `¿Eliminar ${what}?`,
    body: 'Se borrarán del catálogo definitivamente. Las facturas y presupuestos que los incluyen no cambian: conservan concepto, precio e IVA, pero dejarán de estar vinculados al catálogo.\n\nEsta acción no se puede deshacer.',
    confirmLabel: `Eliminar ${ids.length}`,
    danger: true,
  })
  if (!ok) return
  busy.value = true
  try {
    const res = await $fetch<{ deleted: number, unlinkedDocuments: number }>('/api/items/bulk', { method: 'DELETE', body: { ids } })
    const u = res.unlinkedDocuments
    toast.success(`${res.deleted} eliminados del catálogo`, u ? `${u} ${u === 1 ? 'documento desvinculado' : 'documentos desvinculados'}` : what)
    sel.clear()
  }
  catch (err) {
    toast.error('No se pudieron eliminar', errorMessage(err))
  }
  finally {
    busy.value = false
    await refreshAll()
  }
}

async function moveTo(ids: number[], categoryId: number | null) {
  if (!ids.length) return
  busy.value = true
  const name = categoryId ? catById.value.get(categoryId)?.name : null
  try {
    await $fetch('/api/items/bulk', { method: 'POST', body: { ids, categoryId } })
    toast.success(name ? `Movidos a ${name}` : 'Sin categoría', describe(ids))
    sel.clear()
  }
  catch (err) {
    toast.error('No se pudo cambiar la categoría', errorMessage(err))
  }
  finally {
    busy.value = false
    await refreshAll()
  }
}

// ─── Clic derecho (o pulsación larga): acciones del artículo o, dentro de la selección, las del lote ───

// Un solo artículo desde su menú: no toca lo que haya seleccionado
async function moveOne(i: Item, categoryId: number | null) {
  if (i.categoryId === categoryId) return
  try {
    await $fetch('/api/items/bulk', { method: 'POST', body: { ids: [i.id], categoryId } })
    toast.success(categoryId ? `Movido a ${catById.value.get(categoryId)?.name}` : 'Sin categoría', i.name)
  }
  catch (err) {
    toast.error('No se pudo cambiar la categoría', errorMessage(err))
  }
  finally {
    await refreshAll()
  }
}

function categoryItems(current: number | null | undefined, apply: (id: number | null) => void): CtxItem[] {
  return [
    ...categories.value.map(c => ({ label: c.name, icon: 'ph:folder-simple-fill', active: current === c.id, onClick: () => apply(c.id) })),
    ...(categories.value.length ? [{ label: 'Sin categoría', icon: 'ph:folder-simple-dashed', active: current === null, onClick: () => apply(null) }, { divider: true }] : []),
    { label: categories.value.length ? 'Gestionar categorías…' : 'Crear categorías…', icon: 'ph:sliders-horizontal', onClick: () => (catsOpen.value = true) },
  ]
}

function pickFromMenu(i: Item) {
  sel.toggle(i.id)
  if (!sel.selecting.value) sel.selecting.value = true
}

function rowCtx(i: Item): CtxSpec {
  const ids = sel.selected.value
  if (ids.length > 1 && sel.selectedSet.value.has(i.id)) {
    return {
      title: `${ids.length} seleccionados`,
      subtitle: describe(ids),
      icon: 'ph:stack',
      items: [
        { label: 'Mover a la categoría', icon: 'ph:folder-simple', children: categoryItems(undefined, id => moveTo(sel.selected.value, id)) },
        { divider: true },
        { label: 'Quitar este de la selección', icon: 'ph:minus-circle', onClick: () => sel.toggle(i.id) },
        { label: 'Seleccionar todo lo filtrado', icon: 'ph:checks', disabled: ids.length === filtered.value.length, onClick: sel.selectAll },
        { label: 'Quitar la selección', icon: 'ph:x-circle', onClick: sel.clear },
        { divider: true },
        { label: `Eliminar ${ids.length}`, icon: 'ph:trash', danger: true, onClick: () => deleteBulk(sel.selected.value) },
      ],
    }
  }
  const on = sel.selectedSet.value.has(i.id)
  return {
    title: i.name,
    subtitle: `${eur(withVat(i))}${i.unit ? ` / ${i.unit}` : ''}${i.uses ? ` · ${i.uses} ${i.uses === 1 ? 'vez' : 'veces'} en 12 m` : ''}`,
    icon: i.kind === 'service' ? 'ph:handshake' : 'ph:package',
    items: [
      { label: 'Editar', icon: 'ph:pencil-simple', keys: ['↵'], onClick: () => openEdit(i.id) },
      { divider: true },
      { label: 'Nueva factura con él', icon: 'ph:receipt', to: `/facturas/nueva?producto=${i.id}` },
      { label: 'Nuevo presupuesto con él', icon: 'ph:file-text', to: `/presupuestos/nuevo?producto=${i.id}` },
      { divider: true },
      { label: 'Categoría', icon: 'ph:folder-simple', children: categoryItems(i.categoryId, id => moveOne(i, id)) },
      {
        label: 'Copiar',
        icon: 'ph:copy',
        children: [
          { label: 'Nombre', sub: i.name, icon: 'ph:text-aa', onClick: () => copyText(i.name, 'Nombre') },
          { label: 'Precio con IVA', sub: eur(withVat(i)), icon: 'ph:currency-eur', onClick: () => copyText(plainAmount(withVat(i)), 'Precio') },
          { label: 'Precio sin IVA', sub: eur(i.unitPrice), icon: 'ph:currency-eur', onClick: () => copyText(plainAmount(i.unitPrice), 'Precio') },
          ...(i.sku ? [{ label: 'Referencia', sub: i.sku, icon: 'ph:barcode', onClick: () => copyText(i.sku, 'Referencia') }] : []),
          ...(i.description ? [{ label: 'Descripción', sub: i.description, icon: 'ph:text-align-left', onClick: () => copyText(i.description, 'Descripción') }] : []),
        ],
      },
      { divider: true },
      { label: on ? 'Quitar de la selección' : 'Seleccionar', icon: on ? 'ph:minus-circle' : 'ph:check-square', onClick: () => pickFromMenu(i) },
      { divider: true },
      { label: 'Eliminar', icon: 'ph:trash', danger: true, onClick: () => remove(i) },
    ],
  }
}

const bulkActions = computed<BulkAction[]>(() => [
  {
    label: 'Categoría',
    icon: 'ph:folder-simple',
    menuWidth: 250,
    menu: [
      { heading: 'Mover a la categoría' },
      ...categories.value.map(c => ({ label: c.name, icon: 'ph:folder-simple-fill', onClick: () => moveTo(sel.selected.value, c.id) })),
      ...(categories.value.length ? [{ label: 'Sin categoría', icon: 'ph:folder-simple-dashed', onClick: () => moveTo(sel.selected.value, null) }, { divider: true }] : []),
      { label: categories.value.length ? 'Gestionar categorías…' : 'Crear categorías…', icon: 'ph:sliders-horizontal', onClick: () => (catsOpen.value = true) },
    ],
  },
  { label: 'Eliminar', icon: 'ph:trash', tone: 'danger', onClick: () => deleteBulk(sel.selected.value) },
])
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>Productos y servicios</h1>
        <p class="sub">Tu catálogo con precios e IVA: añádelos a una factura en un clic.</p>
      </div>
      <div class="page-actions">
        <UiButton variant="primary" icon="ph:plus-bold" compact @click="openNew">Nuevo</UiButton>
      </div>
    </header>

    <section v-if="items.length" class="stats rise">
      <div class="stat">
        <p class="eyebrow">En catálogo</p>
        <p class="v num">{{ items.length }}</p>
        <p class="s">{{ unused ? `${unused} sin usar en 12 meses` : 'Todos con ventas recientes' }}</p>
      </div>
      <div class="stat">
        <p class="eyebrow">Facturado 12 m</p>
        <p class="v num">{{ eur(totalRevenue, false) }}</p>
        <p class="s">Importe total</p>
      </div>
      <div v-if="top" class="stat star">
        <p class="eyebrow"><Icon name="ph:crown-simple-fill" aria-hidden="true" /> Más vendido</p>
        <p class="v-name" :title="top.name">{{ top.name }}</p>
        <p class="s num">{{ eur(top.revenue, false) }} · {{ top.uses }} {{ top.uses === 1 ? 'vez' : 'veces' }}</p>
      </div>
    </section>

    <UiCard padding="none" class="rise" style="--i: 1">
      <div class="toolbar" :class="{ joined: items.length }">
        <UiInput v-model="q" icon="ph:magnifying-glass" placeholder="Buscar en el catálogo" aria-label="Buscar en el catálogo" type="search" class="search" />
        <UiSegmented v-model="kind" :options="kindOptions" label="Tipo" />
        <UiButton
          v-if="filtered.length"
          class="sel-toggle"
          :variant="sel.selecting.value ? 'primary' : 'secondary'"
          :icon="sel.selecting.value ? 'ph:x' : 'ph:check-square'"
          @click="sel.selecting.value ? sel.clear() : (sel.selecting.value = true)"
        >
          {{ sel.selecting.value ? 'Cancelar selección' : 'Seleccionar' }}
        </UiButton>
      </div>

      <div v-if="items.length" class="cats" role="group" aria-label="Filtrar por categoría">
        <button type="button" class="chip" :class="{ on: cat == null }" :aria-pressed="cat == null" @click="cat = null">
          Todas <span class="n num">{{ byKind.length }}</span>
        </button>
        <button
          v-for="c in categories"
          :key="c.id"
          type="button"
          class="chip"
          :class="{ on: cat === c.id }"
          :aria-pressed="cat === c.id"
          :style="{ '--c': c.color ?? 'var(--text-4)' }"
          @click="cat = cat === c.id ? null : c.id"
        >
          <span class="dot" aria-hidden="true" />{{ c.name }} <span class="n num">{{ catCount(c.id) }}</span>
        </button>
        <button
          v-if="categories.length && catCount(null)"
          type="button"
          class="chip"
          :class="{ on: cat === 'none' }"
          :aria-pressed="cat === 'none'"
          @click="cat = cat === 'none' ? null : 'none'"
        >
          Sin categoría <span class="n num">{{ catCount(null) }}</span>
        </button>
        <button type="button" class="chip manage" @click="catsOpen = true">
          <Icon :name="categories.length ? 'ph:sliders-horizontal' : 'ph:folder-simple-plus'" aria-hidden="true" />
          {{ categories.length ? 'Gestionar' : 'Organiza con categorías' }}
        </button>
      </div>

      <div v-if="status === 'pending' && !data" class="skeletons">
        <div v-for="i in 5" :key="i" class="sk-row">
          <div class="skeleton" style="width: 36px; height: 36px; border-radius: 10px" />
          <div class="grow">
            <div class="skeleton" style="width: 45%; height: 12px" />
            <div class="skeleton" style="width: 30%; height: 10px; margin-top: 8px" />
          </div>
          <div class="skeleton" style="width: 80px; height: 12px" />
        </div>
      </div>

      <UiEmpty
        v-else-if="!items.length"
        icon="ph:package"
        title="Crea tu catálogo"
        text="Guarda tus servicios y productos con su precio e IVA. Al facturar solo tendrás que elegirlos, y verás cuáles te dan más ingresos."
      >
        <UiButton variant="primary" icon="ph:plus-bold" @click="openNew">Añadir el primero</UiButton>
      </UiEmpty>

      <UiEmpty v-else-if="!filtered.length" compact icon="ph:magnifying-glass" title="Sin resultados" text="Prueba con otro nombre o cambia el filtro.">
        <UiButton @click="q = ''; kind = 'all'; cat = null">Ver todo</UiButton>
      </UiEmpty>

      <template v-else>
        <div class="list-head" :class="{ on: sel.selected.value.length }">
          <span class="pick">
            <input
              type="checkbox"
              :checked="sel.allSelected.value"
              :indeterminate="!!sel.selected.value.length && !sel.allSelected.value"
              :aria-label="sel.allSelected.value ? 'Quitar la selección' : 'Seleccionar todos'"
              @change="sel.toggleAll"
            >
          </span>
          <span>{{ sel.selected.value.length ? `${sel.selected.value.length} de ${filtered.length} seleccionados` : `${filtered.length} ${filtered.length === 1 ? 'elemento' : 'elementos'}` }}</span>
          <span class="h-usage">Facturado 12 m</span>
          <span class="r">Precio</span>
          <span />
        </div>

        <ul class="list">
          <li v-for="(i, idx) in shown" :key="i.id" v-ctx="() => rowCtx(i)" class="row rise" :class="{ sel: sel.selectedSet.value.has(i.id) }" :style="{ '--i': Math.min(idx, 10) }">
            <span class="pick" @click="sel.toggle(i.id, $event)">
              <input
                type="checkbox"
                :checked="sel.selectedSet.value.has(i.id)"
                :aria-label="`Seleccionar ${i.name}`"
                @click.stop="sel.toggle(i.id, $event)"
              >
            </span>
            <button type="button" class="main" :aria-pressed="sel.selecting.value ? sel.selectedSet.value.has(i.id) : undefined" @click="onMain(i)">
              <span v-if="sel.selecting.value" class="tick" :class="{ on: sel.selectedSet.value.has(i.id) }" aria-hidden="true">
                <Icon v-if="sel.selectedSet.value.has(i.id)" name="ph:check-bold" />
              </span>
              <span v-else class="ic" :class="[i.kind, { pic: i.imageUrl }]" aria-hidden="true">
                <img v-if="i.imageUrl" :src="i.imageUrl" alt="" loading="lazy">
                <Icon v-else :name="i.kind === 'service' ? 'ph:handshake' : 'ph:package'" />
              </span>
              <span class="txt">
                <span class="name">{{ i.name }}</span>
                <span class="desc">
                  <span v-if="i.categoryId && catById.get(i.categoryId)" class="cat-tag" :style="{ '--c': catById.get(i.categoryId)!.color ?? 'var(--text-4)' }">
                    <span class="dot" aria-hidden="true" />{{ catById.get(i.categoryId)!.name }}
                  </span>
                  <template v-if="i.sku"><span class="mono">{{ i.sku }}</span> · </template>{{ i.description || (i.kind === 'service' ? 'Servicio' : 'Producto') }}
                </span>
              </span>
            </button>

            <div class="usage" :title="i.lastUsed ? `Última vez ${relDays(i.lastUsed)}` : 'Sin uso en 12 meses'">
              <template v-if="i.uses">
                <span class="u-v num">{{ eur(i.revenue, false) }}</span>
                <span class="bar" aria-hidden="true"><span :style="{ width: `${Math.max(4, i.revenue / maxRevenue * 100)}%` }" /></span>
                <span class="u-s">{{ i.uses }} {{ i.uses === 1 ? 'vez' : 'veces' }} en 12 m</span>
              </template>
              <span v-else class="u-s">Sin uso reciente</span>
            </div>

            <div class="price">
              <!-- Precio con impuestos, como el resto de importes; debajo, la base -->
              <span class="p num">{{ eur(withVat(i)) }}<span v-if="i.unit" class="unit"> / {{ i.unit }}</span></span>
              <span class="pv num">{{ i.vatRate ? `${eur(i.unitPrice)} + IVA ${pct(i.vatRate)}` : `${eur(i.unitPrice)} sin IVA` }}</span>
            </div>

            <UiMenu :items="rowMenu(i)" :width="190">
              <template #default="{ toggle }">
                <UiButton variant="ghost" size="sm" square icon="ph:dots-three-bold" :aria-label="`Acciones de ${i.name}`" @click="toggle" />
              </template>
            </UiMenu>
          </li>
        </ul>

        <!-- Móvil: nombre y descripción enteros; debajo, uso y precio -->
        <ul class="mlist">
          <li v-for="i in shown" :key="i.id" v-ctx="() => rowCtx(i)">
            <UiListRow :selecting="sel.selecting.value" :selected="sel.selectedSet.value.has(i.id)" @toggle="sel.toggle(i.id)" @open="openEdit(i.id)">
              <template #lead>
                <span class="ic" :class="[i.kind, { pic: i.imageUrl }]" aria-hidden="true">
                  <img v-if="i.imageUrl" :src="i.imageUrl" alt="" loading="lazy">
                  <Icon v-else :name="i.kind === 'service' ? 'ph:handshake' : 'ph:package'" />
                </span>
              </template>
              <template #title>{{ i.name }}</template>
              <template #sub>
                <span v-if="i.categoryId && catById.get(i.categoryId)" class="cat-tag" :style="{ '--c': catById.get(i.categoryId)!.color ?? 'var(--text-4)' }">
                  <span class="dot" aria-hidden="true" />{{ catById.get(i.categoryId)!.name }}
                </span>
                <template v-if="i.sku"><span class="mono">{{ i.sku }}</span> · </template>{{ i.description || (i.kind === 'service' ? 'Servicio' : 'Producto') }}
              </template>
              <template #info>{{ i.uses ? `${i.uses} ${i.uses === 1 ? 'vez' : 'veces'} · ${eur(i.revenue, false)} en 12 m` : 'Sin uso reciente' }}</template>
              <template #amount>
                {{ eur(withVat(i)) }}
                <small v-if="i.unit">por {{ i.unit }}</small>
              </template>
              <template #menu>
                <UiMenu :items="rowMenu(i)" :width="190">
                  <template #default="{ toggle }">
                    <UiButton variant="ghost" size="sm" square icon="ph:dots-three-bold" :aria-label="`Acciones de ${i.name}`" @click="toggle" />
                  </template>
                </UiMenu>
              </template>
            </UiListRow>
          </li>
        </ul>

        <UiPager v-model="page" v-model:size="pageSize" :pages="pages" :total="pageTotal" />
      </template>
    </UiCard>

    <UiBulkBar
      :count="sel.selected.value.length"
      :total="filtered.length"
      :sub="describe(sel.selected.value)"
      :actions="bulkActions"
      :busy="busy"
      label="Acciones con los productos seleccionados"
      @all="sel.selectAll"
      @clear="sel.clear"
    />

    <ItemModal v-model="modalOpen" :item-id="editingId" :prefill="editingId ? undefined : { name: q.trim() || undefined, categoryId: typeof cat === 'number' ? cat : undefined }" @saved="refreshAll()" @deleted="refreshAll()" />
    <ItemCategoriesModal v-model="catsOpen" @changed="refreshAll()" />
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--s-4);
  margin-bottom: var(--s-5);
}

.stat {
  min-width: 0;
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

.stat .s {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.star .eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.star .eyebrow :deep(svg) {
  color: var(--warning-solid);
}

/* Hasta dos líneas antes de cortar: el nombre del más vendido se lee entero */
.v-name {
  display: -webkit-box;
  margin-top: 8px;
  overflow: hidden;
  font-size: var(--text-lg);
  font-weight: 640;
  line-height: 1.3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  flex-wrap: wrap;
  padding: var(--s-4) var(--s-5);
  border-bottom: 1px solid var(--border-subtle);
}

.search {
  flex: 1;
  max-width: 360px;
  min-width: 200px;
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

.list {
  list-style: none;
  padding: 0;
}

.row,
.list-head {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 200px 190px 36px;
  align-items: center;
  gap: var(--s-4);
  padding: 12px var(--s-5);
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--t-fast);
}

.row:last-child {
  border-bottom: 0;
}

.row:hover {
  background: var(--surface-hover);
}

/* ─── Selección ─── */

.list-head {
  padding-top: 9px;
  padding-bottom: 9px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-3);
  background: var(--surface-2);
  border-bottom-color: var(--border);
}

.list-head.on {
  color: var(--brand-text);
}

.list-head .r {
  text-align: right;
}

.pick {
  display: grid;
  place-items: center;
  align-self: stretch;
  cursor: pointer;
}

input[type='checkbox'] {
  display: block;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--brand);
  cursor: pointer;
}

.row.sel {
  background: color-mix(in srgb, var(--brand) 6%, transparent);
}

.row.sel:hover {
  background: color-mix(in srgb, var(--brand) 9%, transparent);
}

.tick {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
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

/* ─── Categorías ─── */

.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 var(--s-5) var(--s-4);
  border-bottom: 1px solid var(--border-subtle);
}

/* Con categorías debajo, la línea pasa a ellas */
.toolbar.joined {
  padding-bottom: var(--s-3);
  border-bottom: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 11px;
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-2);
  white-space: nowrap;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
}

.chip:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.chip:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.chip.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: transparent;
}

.chip .n {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-4);
}

.chip.on .n {
  color: inherit;
  opacity: 0.75;
}

.chip.manage {
  color: var(--text-3);
  border-style: dashed;
}

.chip.manage :deep(svg) {
  width: 14px;
  height: 14px;
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  background: var(--c);
  border-radius: 50%;
}

.cat-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-right: 6px;
  font-weight: 560;
  color: var(--text-2);
}

.cat-tag .dot {
  width: 7px;
  height: 7px;
}

.main {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  text-align: left;
  border-radius: var(--r-md);
}

.ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  font-size: 18px;
  border-radius: 11px;
}

.ic.service {
  color: var(--brand-text);
  background: var(--brand-soft);
}

.ic.product {
  color: var(--info);
  background: var(--info-soft);
}

.ic.pic {
  overflow: hidden;
  background: #fff;
  box-shadow: inset 0 0 0 1px var(--border);
}

.ic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name {
  font-weight: 580;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mlist {
  display: none;
  margin: 0;
  padding: 0;
  list-style: none;
}

.desc {
  font-size: var(--text-xs);
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.u-v {
  font-size: var(--text-sm);
  font-weight: 580;
}

.u-s {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.bar {
  display: block;
  height: 4px;
  background: var(--surface-active);
  border-radius: var(--r-full);
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  background: var(--brand);
  border-radius: inherit;
}

.price {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
}

.p {
  font-weight: 620;
}

.unit {
  font-size: var(--text-xs);
  font-weight: 450;
  color: var(--text-3);
}

.pv {
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* Por el ancho real del contenido (la barra lateral resta 248 px): sin sitio, fuera la columna de uso
   antes que cortar el nombre del producto */
.page {
  container: items / inline-size;
}

@container items (max-width: 900px) {
  .row,
  .list-head {
    grid-template-columns: 16px minmax(0, 1fr) 170px 36px;
  }

  .usage,
  .h-usage {
    display: none;
  }
}

@media (max-width: 767px) {
  .toolbar {
    padding: var(--s-3) var(--s-4);
  }

  .search {
    max-width: none;
    min-width: 0;
    flex-basis: 100%;
  }

  /* En el móvil se selecciona tocando la fila, tras pulsar «Seleccionar» */
  .sel-toggle {
    display: inline-flex;
    width: 100%;
  }

  .list-head,
  .list {
    display: none;
  }

  .mlist {
    display: block;
  }

  /* Categorías en una sola fila que se desliza */
  .cats {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding: 0 var(--s-4) var(--s-3);
    scrollbar-width: none;
  }

  .cats::-webkit-scrollbar {
    display: none;
  }

  .chip {
    flex: none;
  }

  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-3);
  }

  .stat {
    padding: var(--s-3) var(--s-4);
  }

  /* El más vendido baja solo a la segunda fila: a todo el ancho, para que el nombre no se corte */
  .star {
    grid-column: 1 / -1;
  }

  .stat .v {
    font-size: var(--text-xl);
  }
}
</style>
