<script setup lang="ts">
import type { BulkAction } from '~/components/ui/BulkBar.vue'
import type { Tone } from '~/utils/labels'
import type { ContactImportAction, ContactImportCommitResult, ContactImportResult, ContactImportRole, ContactImportRow } from '#shared/types/contact-import'

/** Revisión de lo leído antes de guardar: filtros por estado, edición de cada fila y acciones en lote */
const props = defineProps<{ result: ContactImportResult, role: 'client' | 'supplier' }>()
const emit = defineEmits<{ done: [result: ContactImportCommitResult], restart: [] }>()

const toast = useToast()
const rows = ref<ContactImportRow[]>(structuredClone(toRaw(props.result.rows)))
const base = computed(() => (props.role === 'client' ? '/clientes' : '/proveedores'))

type Filter = 'all' | 'create' | 'existing' | 'error' | 'warning' | 'changes' | 'skip'
const filter = ref<Filter>('all')
const q = ref('')

const status = (r: ContactImportRow) => contactRowStatus(r)
const errors = computed(() => rows.value.filter(r => status(r) === 'error'))
const counts = computed(() => ({
  all: rows.value.length,
  create: rows.value.filter(r => r.action === 'create' && status(r) !== 'error').length,
  existing: rows.value.filter(r => r.match).length,
  error: errors.value.length,
  warning: rows.value.filter(r => status(r) === 'warning').length,
  changes: rows.value.filter(r => contactRowChanges(r).length).length,
  skip: rows.value.filter(r => r.action === 'skip').length,
}))

const filterOptions = computed(() => [
  { value: 'all', label: 'Todos', count: counts.value.all },
  { value: 'create', label: 'Nuevos', count: counts.value.create },
  ...(counts.value.existing ? [{ value: 'existing', label: 'Ya existen', count: counts.value.existing }] : []),
  ...(counts.value.error ? [{ value: 'error', label: 'Con errores', count: counts.value.error }] : []),
  ...(counts.value.warning ? [{ value: 'warning', label: 'Con avisos', count: counts.value.warning }] : []),
  ...(counts.value.changes ? [{ value: 'changes', label: 'Corregidos', count: counts.value.changes }] : []),
  ...(counts.value.skip ? [{ value: 'skip', label: 'No se importan', count: counts.value.skip }] : []),
])
const filterModel = computed({ get: () => filter.value, set: v => (filter.value = v as Filter) })
watch(counts, (c) => {
  if (filter.value !== 'all' && !c[filter.value]) filter.value = 'all'
})

const plainQ = computed(() => q.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
const visible = computed(() => rows.value.filter((r) => {
  const s = status(r)
  const ok = filter.value === 'all'
    || (filter.value === 'create' && r.action === 'create' && s !== 'error')
    || (filter.value === 'existing' && !!r.match)
    || (filter.value === 'error' && s === 'error')
    || (filter.value === 'warning' && s === 'warning')
    || (filter.value === 'changes' && contactRowChanges(r).length > 0)
    || (filter.value === 'skip' && r.action === 'skip')
  if (!ok) return false
  if (!plainQ.value) return true
  const d = r.data
  return [d.name, d.tradeName, d.contactPerson, d.nif, d.email, d.city].some(v => v?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(plainQ.value))
}))

const { page, pages, items: shown, size: pageSize, total: pageTotal } = usePaged(visible, [filter, plainQ])
const { selected, selectedSet, selectedRows, selecting, allSelected, toggle: pick, toggleAll, clear } = useSelection(visible)

// ─── Qué hacer con cada fila ───

function actionOptions(r: ContactImportRow) {
  if (r.match) {
    return [
      { value: 'fill', label: 'Completar ficha' },
      { value: 'update', label: 'Actualizar ficha' },
      ...(r.match.certain ? [] : [{ value: 'create', label: 'Crear otro' }]),
      { value: 'skip', label: 'No importar' },
    ]
  }
  return [{ value: 'create', label: r.mergedInto ? 'Crear aparte' : 'Crear' }, { value: 'skip', label: 'No importar' }]
}

function setAction(r: ContactImportRow, a: string) {
  r.action = a as ContactImportAction
  if (a === 'create') r.mergedInto = null
}

/** Importar: crear si es nuevo, completar si ya existe */
const importAction = (r: ContactImportRow): ContactImportAction => (r.match ? 'fill' : 'create')

function bulk(fn: (r: ContactImportRow) => void) {
  for (const r of selectedRows.value) fn(r)
  clear()
}

function setRole(r: ContactImportRow, role: ContactImportRole) {
  r.isClient = role !== 'supplier'
  r.isSupplier = role !== 'client'
}

/** Los datos inválidos (NIF, email, IBAN, país) se quitan y quedan apuntados en las notas */
function dropInvalid(r: ContactImportRow) {
  const bad = r.issues.filter(i => i.level === 'error' && i.field && i.field !== 'name')
  if (!bad.length) return
  const d = r.data as unknown as Record<string, unknown>
  const notes = bad.map(i => `${CONTACT_FIELD_LABELS[i.field!]} leído (no válido): ${d[i.field!]}`)
  for (const i of bad) d[i.field!] = null
  if (bad.some(i => i.field === 'nif')) r.data.nifType = null
  r.data.notes = [r.data.notes, ...notes].filter(Boolean).join('\n')
  r.issues = checkContactDraft(r.data)
}

function fixAllErrors() {
  for (const r of errors.value) {
    dropInvalid(r)
    if (r.issues.some(i => i.level === 'error')) r.action = 'skip'
  }
  toast.success('Datos erróneos apartados', 'Quedan en las notas de cada contacto para que no se pierdan')
}

function skipErrors() {
  for (const r of errors.value) r.action = 'skip'
}

const bulkActions = computed<BulkAction[]>(() => [
  { label: 'Importar', icon: 'ph:check', tone: 'success', onClick: () => bulk(r => setAction(r, importAction(r))) },
  { label: 'No importar', icon: 'ph:prohibit', onClick: () => bulk(r => (r.action = 'skip')) },
  {
    label: 'Son…',
    icon: 'ph:users',
    menu: [
      { label: 'Clientes', icon: 'ph:users', onClick: () => bulk(r => setRole(r, 'client')) },
      { label: 'Proveedores', icon: 'ph:storefront', onClick: () => bulk(r => setRole(r, 'supplier')) },
      { label: 'Clientes y proveedores', icon: 'ph:arrows-left-right', onClick: () => bulk(r => setRole(r, 'both')) },
    ],
  },
  ...(selectedRows.value.some(r => status(r) === 'error') ? [{ label: 'Quitar datos erróneos', icon: 'ph:eraser', onClick: () => bulk(dropInvalid) }] : []),
])

// ─── Edición ───

const editing = ref<ContactImportRow | null>(null)
const editOpen = ref(false)
function edit(r: ContactImportRow) {
  editing.value = r
  editOpen.value = true
}
function onSaved(updated: ContactImportRow) {
  const i = rows.value.findIndex(r => r.id === updated.id)
  if (i >= 0) rows.value[i] = updated
}

// ─── Guardar ───

const plan = computed(() => {
  const included = rows.value.filter(r => r.action !== 'skip')
  return {
    included,
    create: included.filter(r => r.action === 'create').length,
    fill: included.filter(r => r.action === 'fill').length,
    update: included.filter(r => r.action === 'update').length,
    skip: rows.value.length - included.length,
  }
})

const saving = ref(false)
async function commit() {
  if (errors.value.length) {
    filter.value = 'error'
    return
  }
  saving.value = true
  try {
    const res = await $fetch<ContactImportCommitResult>('/api/contacts/import/commit', {
      method: 'POST',
      body: {
        files: props.result.files.map(f => f.name),
        rows: plan.value.included.map(r => ({ id: r.id, action: r.action, data: r.data, isClient: r.isClient, isSupplier: r.isSupplier, matchId: r.match?.id ?? null })),
      },
    })
    emit('done', res)
  }
  catch (err) {
    // El servidor dice qué filas tienen algo mal: se marcan y se enseñan
    const bad = (err as { data?: { data?: { rows?: Array<{ id: number, text: string }> } } }).data?.data?.rows
    if (bad?.length) {
      for (const b of bad) {
        const r = rows.value.find(x => x.id === b.id)
        if (r) r.issues = [{ field: null, level: 'error', text: b.text }, ...r.issues.filter(i => i.field)]
      }
      filter.value = 'error'
    }
    toast.error('No se ha importado nada', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

const noun = (n: number) => (n === 1 ? 'contacto' : 'contactos')
const STATUS: Record<ContactRowStatus, { label: string, tone: Tone, icon: string }> = {
  ready: { label: 'Listo', tone: 'success', icon: 'ph:check-circle-fill' },
  warning: { label: 'Revisar', tone: 'warning', icon: 'ph:info-fill' },
  error: { label: 'Error', tone: 'danger', icon: 'ph:warning-circle-fill' },
  existing: { label: 'Ya existe', tone: 'info', icon: 'ph:user-circle-check-fill' },
  merged: { label: 'Repetido', tone: 'neutral', icon: 'ph:copy' },
  skipped: { label: 'No se importa', tone: 'neutral', icon: 'ph:prohibit' },
}
const ACTION_LABEL: Record<ContactImportAction, string> = { create: 'Se crea', fill: 'Se completa su ficha', update: 'Se actualiza su ficha', skip: 'No se importa' }

function statusText(r: ContactImportRow) {
  const s = status(r)
  if (s === 'error') return r.issues.find(i => i.level === 'error')?.text ?? 'Error'
  if (s === 'merged') return `Repetido: sus datos se unen a ${rows.value.find(x => x.id === r.mergedInto)?.source.split(' · ').pop() ?? 'otro'}`
  if (s === 'skipped') return r.notContact ?? (r.match ? 'Ya está al día' : 'Has elegido no importarlo')
  if (s === 'existing') return r.match!.label
  return r.issues[0]?.text ?? ''
}

const addressLine = (r: ContactImportRow) => [r.data.address, [r.data.postalCode, r.data.city].filter(Boolean).join(' '), r.data.province && r.data.province !== r.data.city ? r.data.province : null, r.data.country && r.data.country !== 'ES' ? r.data.country : null].filter(Boolean).join(', ')
const roleText = (r: ContactImportRow) => (r.isClient && r.isSupplier ? 'Cliente y proveedor' : r.isClient ? 'Cliente' : 'Proveedor')
const showRole = computed(() => rows.value.some(r => r.isClient !== (props.role === 'client') || r.isSupplier !== (props.role === 'supplier')))
const aiFixes = computed(() => rows.value.reduce((s, r) => s + r.changes.filter(c => c.by === 'ai' && !c.minor).length, 0))
const autoFixes = computed(() => rows.value.reduce((s, r) => s + contactRowChanges(r).length, 0))
</script>

<template>
  <div class="ci-review">
    <section class="ci-sum rise" aria-label="Resumen de la lectura">
      <div class="ci-sum-main">
        <span class="ci-sum-ic" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
        <div class="grow">
          <p class="ci-sum-t">{{ rows.length }} {{ noun(rows.length) }} leídos</p>
          <p class="ci-sum-s">
            <template v-if="autoFixes">{{ autoFixes }} {{ autoFixes === 1 ? 'dato corregido' : 'datos corregidos' }} solos<template v-if="aiFixes"> ({{ aiFixes }} por la IA)</template>. </template>
            Revisa lo marcado y pulsa importar: nada se guarda hasta entonces.
          </p>
        </div>
        <UiButton variant="ghost" size="sm" icon="ph:arrow-counter-clockwise" @click="emit('restart')">Otro archivo</UiButton>
      </div>
      <ul class="ci-files">
        <li v-for="f in result.files" :key="f.name" :class="{ bad: f.error }">
          <Icon :name="f.error ? 'ph:warning-circle-fill' : fileIcon(f.name)" aria-hidden="true" />
          <span class="ci-f-name">{{ f.name }}</span>
          <span class="ci-f-note">{{ f.error ?? f.note ?? `${f.contacts} ${noun(f.contacts)}` }}</span>
        </li>
      </ul>
    </section>

    <div v-if="errors.length" class="ci-errbar rise" role="alert">
      <Icon name="ph:warning-circle-fill" aria-hidden="true" />
      <p class="grow"><b>{{ errors.length }} {{ errors.length === 1 ? 'contacto tiene' : 'contactos tienen' }} un dato inválido</b> (NIF, email o IBAN). Corrígelos, apártalos o no los importes.</p>
      <div class="ci-errbar-a">
        <UiButton size="sm" @click="filter = 'error'">Ver</UiButton>
        <UiButton size="sm" icon="ph:eraser" @click="fixAllErrors">Apartar datos erróneos</UiButton>
        <UiButton size="sm" variant="ghost" @click="skipErrors">No importarlos</UiButton>
      </div>
    </div>

    <UiCard padding="none" class="rise ci-list" style="--i: 1">
      <div class="ci-toolbar">
        <div class="ci-filters"><UiSegmented v-model="filterModel" :options="filterOptions" label="Filtrar" /></div>
        <div class="ci-tools">
          <UiInput v-model="q" icon="ph:magnifying-glass" placeholder="Buscar" aria-label="Buscar en lo leído" type="search" class="ci-search" />
          <UiButton class="ci-sel" :variant="selecting ? 'primary' : 'secondary'" :icon="selecting ? 'ph:x' : 'ph:check-square'" @click="selecting ? clear() : (selecting = true)">
            {{ selecting ? 'Cancelar' : 'Seleccionar' }}
          </UiButton>
        </div>
      </div>

      <UiEmpty v-if="!visible.length" compact icon="ph:magnifying-glass" title="Nada por aquí" text="Ningún contacto coincide con el filtro." />

      <template v-else>
        <div class="table-wrap ci-desktop">
          <table class="table ci-table">
            <thead>
              <tr>
                <th class="ci-pick">
                  <input type="checkbox" :checked="allSelected" :indeterminate="!!selected.length && !allSelected" :aria-label="allSelected ? 'Quitar la selección' : 'Seleccionar todos'" @change="toggleAll">
                </th>
                <th>Contacto</th>
                <th>NIF</th>
                <th>Email y teléfono</th>
                <th>Dirección</th>
                <th>Estado</th>
                <th class="ci-act">Qué hacer</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in shown" :key="r.id" class="clickable" :class="{ sel: selectedSet.has(r.id), off: r.action === 'skip' }" tabindex="0" @click="edit(r)" @keydown.enter.self="edit(r)">
                <td class="ci-pick" @click.stop="pick(r.id, $event)">
                  <input type="checkbox" :checked="selectedSet.has(r.id)" :aria-label="`Seleccionar ${r.data.name}`" @click.stop="pick(r.id, $event)">
                </td>
                <td>
                  <div class="ci-who">
                    <UiAvatar :name="r.data.name || '?'" :size="32" :square="r.data.kind === 'company'" />
                    <div class="ci-who-t">
                      <span class="strong">{{ r.data.name || 'Sin nombre' }}</span>
                      <span v-if="r.data.tradeName || r.data.contactPerson" class="ci-sub">{{ [r.data.tradeName, r.data.contactPerson].filter(Boolean).join(' · ') }}</span>
                      <span v-if="showRole" class="ci-sub">{{ roleText(r) }}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span v-if="r.data.nif" class="mono" :class="{ 'ci-bad': r.issues.some(i => i.field === 'nif' && i.level === 'error') }">{{ r.data.nif }}</span>
                  <span v-else class="ci-none">Sin NIF</span>
                </td>
                <td class="ci-contact">
                  <span :class="{ 'ci-bad': r.issues.some(i => i.field === 'email' && i.level === 'error') }">{{ r.data.email || '—' }}</span>
                  <span v-if="r.data.phone" class="ci-sub">{{ r.data.phone }}</span>
                </td>
                <td class="ci-addr">{{ addressLine(r) || '—' }}</td>
                <td class="ci-status">
                  <UiBadge :tone="STATUS[status(r)].tone" :icon="STATUS[status(r)].icon" size="sm">{{ STATUS[status(r)].label }}</UiBadge>
                  <span v-if="contactRowChanges(r).length" class="ci-fixed" :title="contactRowChanges(r).map(c => `${CONTACT_FIELD_LABELS[c.field]}: ${c.reason}`).join('\n')">
                    <Icon name="ph:sparkle-fill" aria-hidden="true" /> {{ contactRowChanges(r).length }} {{ contactRowChanges(r).length === 1 ? 'corrección' : 'correcciones' }}
                  </span>
                  <span v-if="statusText(r)" class="ci-sub ci-why">{{ statusText(r) }}</span>
                </td>
                <td class="ci-act" @click.stop @keydown.stop>
                  <select class="ci-do" :value="r.action" :aria-label="`Qué hacer con ${r.data.name}`" @change="setAction(r, ($event.target as HTMLSelectElement).value)">
                    <option v-for="o in actionOptions(r)" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ul class="ci-cards">
          <li v-for="r in shown" :key="r.id" :class="{ off: r.action === 'skip' }">
            <UiListRow :selecting="selecting" :selected="selectedSet.has(r.id)" @toggle="pick(r.id)" @open="edit(r)">
              <template #lead>
                <UiAvatar :name="r.data.name || '?'" :size="38" :square="r.data.kind === 'company'" />
              </template>
              <template #title>{{ r.data.name || 'Sin nombre' }}</template>
              <template #sub>{{ [r.data.nif || 'Sin NIF', r.data.city].filter(Boolean).join(' · ') }}</template>
              <template v-if="statusText(r)" #note>{{ statusText(r) }}</template>
              <template #info>{{ ACTION_LABEL[r.action] }}</template>
              <template #status>
                <UiBadge :tone="STATUS[status(r)].tone" size="sm" dot>{{ STATUS[status(r)].label }}</UiBadge>
              </template>
              <template v-if="contactRowChanges(r).length" #amount>
                <span class="ci-fixed"><Icon name="ph:sparkle-fill" aria-hidden="true" /> {{ contactRowChanges(r).length }}</span>
              </template>
            </UiListRow>
          </li>
        </ul>

        <UiPager v-model="page" v-model:size="pageSize" :pages="pages" :total="pageTotal" />
      </template>
    </UiCard>

    <div v-show="!selected.length" class="ci-footer">
      <div class="ci-footer-in">
        <p class="ci-plan">
          <template v-if="plan.create"><b>{{ plan.create }}</b> {{ plan.create === 1 ? 'nuevo' : 'nuevos' }}</template>
          <template v-if="plan.fill"><span v-if="plan.create"> · </span><b>{{ plan.fill }}</b> {{ plan.fill === 1 ? 'ficha completada' : 'fichas completadas' }}</template>
          <template v-if="plan.update"><span v-if="plan.create || plan.fill"> · </span><b>{{ plan.update }}</b> {{ plan.update === 1 ? 'actualizada' : 'actualizadas' }}</template>
          <template v-if="plan.skip"><span v-if="plan.included.length"> · </span>{{ plan.skip }} sin importar</template>
        </p>
        <UiButton variant="primary" icon="ph:check-bold" :loading="saving" :disabled="!plan.included.length" @click="commit">
          {{ errors.length ? `Revisa ${errors.length} con errores` : `Importar ${plan.included.length} ${noun(plan.included.length)}` }}
        </UiButton>
      </div>
    </div>

    <UiBulkBar
      :count="selected.length"
      :total="visible.length"
      :title="`${selected.length} ${selected.length === 1 ? 'seleccionado' : 'seleccionados'}`"
      :actions="bulkActions"
      label="Acciones con los contactos seleccionados"
      @all="toggleAll"
      @clear="clear"
    />

    <ContactImportEditModal v-model="editOpen" :row="editing" :base="base" @save="onSaved" />
  </div>
</template>

<style scoped>
.ci-review {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  padding-bottom: 84px;
}

.ci-sum {
  padding: var(--s-4) var(--s-5);
  background: var(--ai-soft), var(--surface);
  border: 1px solid color-mix(in srgb, var(--ai-2) 25%, var(--border));
  border-radius: var(--r-xl);
}

.ci-sum-main {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.ci-sum-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  font-size: 18px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: var(--r-lg);
}

.ci-sum-t {
  font-size: var(--text-lg);
  font-weight: 650;
}

.ci-sum-s {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.ci-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: var(--s-3);
  padding: 0;
  list-style: none;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ci-files li {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ci-files li.bad {
  color: var(--danger);
}

.ci-f-name {
  font-weight: 600;
  color: var(--text-2);
  overflow-wrap: anywhere;
}

.ci-errbar {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 12px 16px;
  font-size: var(--text-sm);
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: var(--r-lg);
}

.ci-errbar > :deep(svg) {
  flex: none;
  width: 18px;
  height: 18px;
}

.ci-errbar p {
  color: var(--text);
}

.ci-errbar-a {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ci-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-5);
  border-bottom: 1px solid var(--border-subtle);
}

.ci-filters {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}

.ci-filters::-webkit-scrollbar {
  display: none;
}

.ci-tools {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.ci-search {
  width: 220px;
}

.ci-sel {
  display: none;
}

.ci-table td {
  vertical-align: top;
}

.ci-table tr.off td:not(.ci-act):not(.ci-pick) {
  opacity: 0.55;
}

.ci-pick {
  width: 1%;
  padding-right: 0 !important;
  cursor: default;
}

input[type='checkbox'] {
  display: block;
  width: 16px;
  height: 16px;
  margin: 3px 0 0;
  accent-color: var(--brand);
  cursor: pointer;
}

.table tbody tr.sel {
  background: color-mix(in srgb, var(--brand) 6%, transparent);
}

.ci-who {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 200px;
  max-width: 300px;
}

.ci-who-t {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ci-sub {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ci-none {
  font-size: var(--text-sm);
  color: var(--text-4);
}

.ci-bad {
  color: var(--danger);
  text-decoration: underline wavy color-mix(in srgb, var(--danger) 60%, transparent);
  text-underline-offset: 3px;
}

.ci-contact {
  max-width: 220px;
  overflow-wrap: anywhere;
}

.ci-addr {
  min-width: 180px;
  max-width: 260px;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.ci-status {
  min-width: 150px;
  max-width: 240px;
}

.ci-status > * + * {
  margin-top: 4px;
}

.ci-fixed {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--ai-1);
}

.ci-status .ci-fixed {
  display: flex;
}

.ci-why {
  overflow-wrap: anywhere;
}

.ci-act {
  width: 1%;
  white-space: nowrap;
}

.ci-do {
  height: 32px;
  padding: 0 28px 0 10px;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--text);
  background: var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 256 256'%3E%3Cpath fill='%23888' d='M213.7 101.7l-80 80a8 8 0 0 1-11.4 0l-80-80a8 8 0 0 1 11.4-11.4L128 164.7l74.3-74.4a8 8 0 0 1 11.4 11.4Z'/%3E%3C/svg%3E") no-repeat right 9px center;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  appearance: none;
  cursor: pointer;
}

.ci-do:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 1px;
}

.ci-cards {
  display: none;
  padding: 0;
  list-style: none;
}

.ci-cards li.off {
  opacity: 0.6;
}

.ci-footer {
  position: sticky;
  bottom: var(--s-4);
  z-index: 20;
}

.ci-footer-in {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  padding: 12px 12px 12px 20px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lg);
}

.ci-plan {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.ci-plan b {
  color: var(--text);
}

@media (max-width: 767px) {
  .ci-desktop {
    display: none;
  }

  .ci-cards {
    display: block;
  }

  .ci-toolbar {
    padding: var(--s-3) var(--s-4);
  }

  .ci-tools {
    width: 100%;
  }

  .ci-search {
    flex: 1;
    width: auto;
  }

  .ci-sel {
    display: inline-flex;
  }

  .ci-sum {
    padding: var(--s-4);
  }

  .ci-sum-main {
    flex-wrap: wrap;
  }

  .ci-sum-main > :last-child {
    margin-left: auto;
  }

  .ci-errbar {
    flex-wrap: wrap;
  }

  .ci-footer {
    bottom: calc(var(--s-3) + var(--bnav) + var(--safe-b));
  }

  .ci-footer-in {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 10px;
  }

  .ci-plan {
    text-align: center;
  }
}
</style>
