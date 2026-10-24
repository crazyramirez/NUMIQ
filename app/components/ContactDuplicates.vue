<script setup lang="ts">
/**
 * Aviso de fichas repetidas (mismo NIF, email o un nombre casi igual) y diálogo para unirlas: sus facturas,
 * gastos y recurrentes pasan a la que se conserva, que se completa con lo que le faltaba. Se puede deshacer.
 */
const props = defineProps<{ role: 'client' | 'supplier' }>()
const emit = defineEmits<{ merged: [] }>()

interface Member {
  id: number
  name: string
  tradeName: string | null
  nif: string | null
  email: string | null
  phone: string | null
  city: string | null
  isClient: boolean
  isSupplier: boolean
  archived: boolean
  sales: number
  expenses: number
}
interface Group { certain: boolean, reason: string, keepId: number, members: Member[] }

const toast = useToast()
const { data, refresh } = useFetch<Group[]>('/api/contacts/duplicates', {
  key: `contact-duplicates-${props.role}`,
  query: { role: props.role },
  lazy: true,
  server: false,
})
const groups = computed(() => data.value ?? [])
const certain = computed(() => groups.value.filter(g => g.certain))
const open = ref(false)

/** Por grupo: la ficha que se conserva y las que se unen a ella */
const keep = reactive<Record<string, number>>({})
const include = reactive<Record<string, number[]>>({})
const gkey = (g: Group) => g.members.map(m => m.id).join('-')
watch(groups, (list) => {
  for (const g of list) {
    const k = gkey(g)
    keep[k] ??= g.keepId
    include[k] ??= g.members.map(m => m.id)
  }
}, { immediate: true })

const busy = ref<string | null>(null)
const docs = (m: Member) => [
  m.sales ? `${m.sales} ${m.sales === 1 ? 'factura o presupuesto' : 'facturas y presupuestos'}` : '',
  m.expenses ? `${m.expenses} ${m.expenses === 1 ? 'gasto' : 'gastos'}` : '',
].filter(Boolean).join(' · ') || 'Sin documentos'
const roles = (m: Member) => [m.isClient ? 'Cliente' : '', m.isSupplier ? 'Proveedor' : ''].filter(Boolean).join(' y ')
const picked = (g: Group) => (include[gkey(g)] ?? []).filter(id => id !== keep[gkey(g)])
const keepName = (g: Group) => g.members.find(m => m.id === keep[gkey(g)])?.name ?? ''

function toggleMember(g: Group, id: number) {
  const k = gkey(g)
  const list = include[k] ?? []
  include[k] = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}
function setKeep(g: Group, id: number) {
  const k = gkey(g)
  keep[k] = id
  if (!(include[k] ?? []).includes(id)) include[k] = [...(include[k] ?? []), id]
}

async function undo(undoId: number) {
  try {
    await $fetch('/api/contacts/merge/undo', { method: 'POST', body: { undoId } })
    toast.success('Unión deshecha', 'Las fichas vuelven a estar como antes')
    await refresh()
    emit('merged')
  }
  catch (err) {
    toast.error('No se pudo deshacer', errorMessage(err))
  }
}

async function mergeGroup(g: Group, quiet = false) {
  const ids = picked(g)
  if (!ids.length) return null
  const r = await $fetch<{ undoId: number, merged: number, moved: number }>('/api/contacts/merge', { method: 'POST', body: { keepId: keep[gkey(g)], ids } })
  if (!quiet) {
    toast.push({
      tone: 'success',
      title: `Unido en «${keepName(g)}»`,
      body: r.moved ? `${r.moved} ${r.moved === 1 ? 'documento pasa' : 'documentos pasan'} a esta ficha` : 'Una sola ficha, con todos sus datos',
      action: { label: 'Deshacer', run: () => undo(r.undoId) },
    }, 9000)
  }
  return r
}

async function mergeOne(g: Group) {
  busy.value = gkey(g)
  try {
    await mergeGroup(g)
    await refresh()
    emit('merged')
  }
  catch (err) {
    toast.error('No se pudieron unir', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function mergeCertain() {
  busy.value = 'certain'
  let done = 0
  let failed = 0
  for (const g of certain.value) {
    try {
      if (await mergeGroup(g, true)) done++
    }
    catch {
      failed++
    }
  }
  busy.value = null
  if (done) toast.success(`${done} ${done === 1 ? 'grupo unido' : 'grupos unidos'}`, failed ? `${failed} no se pudieron unir` : 'Sus documentos pasan a una sola ficha')
  else if (failed) toast.error('No se pudieron unir')
  await refresh()
  emit('merged')
}

async function notSame(g: Group) {
  busy.value = `x${gkey(g)}`
  try {
    await $fetch('/api/contacts/duplicates/ignore', { method: 'POST', body: { ids: g.members.map(m => m.id) } })
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

watch(() => groups.value.length, (n) => {
  if (!n) open.value = false
})

</script>

<template>
  <section v-if="groups.length" class="dup-banner rise" aria-label="Posibles duplicados">
    <span class="db-ic" aria-hidden="true"><Icon name="ph:users-three-fill" /></span>
    <div class="db-txt">
      <strong>{{ groups.length }} {{ groups.length === 1 ? 'posible ficha repetida' : 'posibles fichas repetidas' }}</strong>
      <span>{{ certain.length ? `${certain.length} con el mismo NIF. ` : '' }}Únelas para tener cada {{ role === 'client' ? 'cliente' : 'proveedor' }} una sola vez, con todos sus documentos.</span>
    </div>
    <UiButton size="sm" variant="ai" icon="ph:magnifying-glass" @click="open = true">Revisar</UiButton>
  </section>

  <UiModal v-model="open" title="Fichas repetidas" subtitle="Elige cuál conservar: las demás se unen a ella con sus facturas, gastos y recurrentes." size="lg" :persistent="!!busy">
    <div class="groups">
      <article v-for="g in groups" :key="gkey(g)" class="group">
        <header class="g-head">
          <UiBadge :tone="g.certain ? 'success' : 'warning'" size="sm" dot>{{ g.certain ? 'Seguro' : 'Revisa' }}</UiBadge>
          <span class="g-reason">{{ g.reason }}</span>
        </header>
        <ul class="members">
          <li v-for="m in g.members" :key="m.id" :class="{ keep: keep[gkey(g)] === m.id, out: !(include[gkey(g)] ?? []).includes(m.id) }">
            <label class="m-pick" :class="{ hide: keep[gkey(g)] === m.id }" title="Unir a la que se conserva">
              <input type="checkbox" :checked="(include[gkey(g)] ?? []).includes(m.id)" :disabled="keep[gkey(g)] === m.id" :aria-label="`Unir ${m.name}`" @change="toggleMember(g, m.id)">
            </label>
            <div class="m-main">
              <NuxtLink :to="`${m.isClient ? '/clientes' : '/proveedores'}/${m.id}`" class="m-name" target="_blank">{{ m.name }}</NuxtLink>
              <span class="m-sub">
                <span class="mono">{{ m.nif || 'Sin NIF' }}</span>
                <template v-for="x in [m.email, m.phone, m.city].filter(Boolean)" :key="x!"> · {{ x }}</template>
              </span>
              <span class="m-docs">{{ roles(m) }} · {{ docs(m) }}<template v-if="m.archived"> · archivado</template></span>
            </div>
            <button type="button" class="m-keep" :class="{ on: keep[gkey(g)] === m.id }" :aria-pressed="keep[gkey(g)] === m.id" @click="setKeep(g, m.id)">
              <Icon :name="keep[gkey(g)] === m.id ? 'ph:star-fill' : 'ph:star'" aria-hidden="true" />
              {{ keep[gkey(g)] === m.id ? 'Se conserva' : 'Conservar' }}
            </button>
          </li>
        </ul>
        <footer class="g-acts">
          <UiButton size="sm" variant="ghost" :loading="busy === `x${gkey(g)}`" :disabled="!!busy" @click="notSame(g)">No son el mismo</UiButton>
          <UiButton size="sm" variant="primary" icon="ph:arrows-merge" :loading="busy === gkey(g)" :disabled="!!busy || !picked(g).length" @click="mergeOne(g)">
            Unir {{ picked(g).length + 1 }} en una
          </UiButton>
        </footer>
      </article>
    </div>
    <template #footer>
      <UiButton variant="ghost" :disabled="!!busy" @click="open = false">Cerrar</UiButton>
      <UiButton v-if="certain.length > 1" variant="primary" icon="ph:check-bold" :loading="busy === 'certain'" :disabled="!!busy" @click="mergeCertain">
        Unir los {{ certain.length }} seguros
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.dup-banner {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: var(--s-5);
  padding: var(--s-3) var(--s-4);
  background: linear-gradient(135deg, color-mix(in srgb, var(--ai-soft) 70%, var(--surface)), var(--surface) 60%);
  border: 1px solid color-mix(in srgb, var(--ai-2) 22%, var(--border));
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xs);
}

.db-ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  font-size: 16px;
  color: var(--ai-2);
  background: var(--ai-soft);
  border-radius: var(--r-md);
}

.db-txt {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.db-txt strong {
  font-size: var(--text-sm);
  font-weight: 650;
}

.db-txt span {
  font-size: var(--text-xs);
  color: var(--text-2);
}

.groups {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.group {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.g-head {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  background: var(--surface-sunken);
  border-bottom: 1px solid var(--border-subtle);
}

.g-reason {
  font-size: var(--text-xs);
  color: var(--text-2);
}

.members {
  margin: 0;
  padding: 0;
  list-style: none;
}

.members li {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 14px;
  border-top: 1px solid var(--border-subtle);
  transition: opacity 0.15s;
}

.members li:first-child {
  border-top: 0;
}

.members li.keep {
  background: color-mix(in srgb, var(--brand-soft) 45%, transparent);
}

.members li.out {
  opacity: 0.55;
}

.m-pick.hide {
  visibility: hidden;
}

.m-pick input {
  width: 16px;
  height: 16px;
  accent-color: var(--brand);
}

.m-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.m-name {
  font-weight: 620;
  color: var(--text);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.m-name:hover {
  text-decoration: underline;
}

.m-sub,
.m-docs {
  font-size: var(--text-xs);
  color: var(--text-3);
  overflow-wrap: anywhere;
}

.m-docs {
  color: var(--text-2);
}

.m-keep {
  display: inline-flex;
  flex: none;
  gap: 6px;
  align-items: center;
  padding: 5px 10px;
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.m-keep:hover {
  border-color: var(--border-strong);
}

.m-keep.on {
  color: var(--brand-text);
  border-color: color-mix(in srgb, var(--brand) 45%, var(--border));
}

.g-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  padding: 10px 14px;
  border-top: 1px solid var(--border-subtle);
}

@media (max-width: 560px) {
  .dup-banner {
    flex-wrap: wrap;
  }

  .members li {
    flex-wrap: wrap;
  }

  .m-keep {
    margin-left: 28px;
  }
}
</style>
