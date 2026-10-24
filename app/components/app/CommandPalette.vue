<script setup lang="ts">
/**
 * Paleta de comandos (⌘K / Ctrl+K): crear, navegar y buscar clientes, facturas y gastos
 * sin tocar el ratón.
 */
interface Entry {
  id: string
  group: string
  label: string
  sub?: string | null
  icon: string
  to: string
  hint?: string
}

const open = useState('paletteOpen', () => false)
const { me } = useMe()
// El gestor entra en modo consulta: sin atajos de crear
const readOnly = computed(() => me.value?.company?.role === 'advisor')
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()
const results = ref<Entry[]>([])
const loading = ref(false)

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const staticEntries = computed<Entry[]>(() => {
  const q = norm(query.value.trim())
  const match = (s: string) => !q || norm(s).includes(q)
  const create = CREATE_ACTIONS.filter(a => match(`${a.label} ${a.keywords}`))
    .map(a => ({ id: `c:${a.to}`, group: 'Crear', label: a.label, icon: a.icon, to: a.to, hint: a.hint }))
  const nav = ALL_NAV.filter(n => match(`${n.label} ${n.keywords ?? ''}`))
    .map(n => ({ id: `n:${n.to}`, group: 'Ir a', label: n.label, icon: n.icon, to: n.to }))
  return q ? [...create, ...nav] : [...create.slice(0, 4), ...nav]
})

const entries = computed(() => [...results.value, ...staticEntries.value])
const groups = computed(() => {
  const map = new Map<string, Array<Entry & { index: number }>>()
  entries.value.forEach((e, index) => {
    if (!map.has(e.group)) map.set(e.group, [])
    map.get(e.group)!.push({ ...e, index })
  })
  return [...map.entries()]
})

const search = useDebounceFn(async (q: string) => {
  if (q.length < 2) {
    results.value = []
    return
  }
  loading.value = true
  try {
    const r = await $fetch<{
      contacts: Array<{ id: number, name: string, nif: string | null, isClient: boolean, isSupplier: boolean }>
      documents: Array<{ id: number, kind: string, number: string | null, total: number, contactName: string | null }>
      expenses: Array<{ id: number, number: string | null, description: string | null, total: number, supplierName: string | null }>
    }>('/api/search', { query: { q } })
    if (query.value.trim() !== q) return
    results.value = [
      ...r.contacts.map(c => ({ id: `ct:${c.id}`, group: 'Contactos', label: c.name, sub: [c.nif, c.isClient ? 'Cliente' : 'Proveedor'].filter(Boolean).join(' · '), icon: c.isClient ? 'ph:user' : 'ph:storefront', to: c.isClient ? `/clientes/${c.id}` : `/proveedores/${c.id}` })),
      ...r.documents.map(d => ({ id: `d:${d.id}`, group: 'Documentos', label: `${KIND_LABEL[d.kind] ?? ''} ${d.number ?? '(borrador)'}`, sub: `${d.contactName ?? ''} · ${eur(d.total)}`, icon: d.kind === 'quote' ? 'ph:file-text' : 'ph:receipt', to: d.kind === 'quote' ? `/presupuestos/${d.id}` : `/facturas/${d.id}` })),
      ...r.expenses.map(x => ({ id: `e:${x.id}`, group: 'Gastos', label: x.description || x.number || 'Gasto', sub: `${x.supplierName ?? ''} · ${eur(x.total)}`, icon: 'ph:wallet', to: `/gastos?ver=${x.id}` })),
    ]
  }
  catch {
    results.value = []
  }
  finally {
    loading.value = false
  }
}, 180)

watch(query, (q) => {
  active.value = 0
  search(q.trim())
})

watch(open, (v) => {
  if (v) {
    query.value = ''
    results.value = []
    active.value = 0
    nextTick(() => input.value?.focus())
  }
})

function go(e: Entry | undefined) {
  if (!e) return
  open.value = false
  navigateTo(e.to)
}

function onKey(e: KeyboardEvent) {
  const n = entries.value.length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = (active.value + 1) % n
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = (active.value - 1 + n) % n
  }
  else if (e.key === 'Enter') {
    e.preventDefault()
    go(entries.value[active.value])
  }
  else if (e.key === 'Escape') {
    open.value = false
  }
  nextTick(() => list.value?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }))
}

// Atajos globales: ⌘K / Ctrl+K o «/» para buscar; F, P, G, E, C para crear (como indica la paleta)
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
useEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    open.value = !open.value
    return
  }
  if (open.value || e.metaKey || e.ctrlKey || e.altKey || e.repeat || typing(e.target)) return
  // Con una ventana abierta (modal, menú) las letras son de ella
  if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return
  if (e.key === '/') {
    e.preventDefault()
    open.value = true
    return
  }
  const action = CREATE_ACTIONS.find(a => a.hint && a.hint.toLowerCase() === e.key.toLowerCase())
  if (action && !readOnly.value) {
    e.preventDefault()
    navigateTo(action.to)
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="pal">
      <div v-if="open" class="overlay" @mousedown.self="open = false">
        <div class="palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
          <div class="bar">
            <Icon :name="loading ? 'ph:circle-notch' : 'ph:magnifying-glass'" class="ic" :class="{ spin: loading }" aria-hidden="true" />
            <input ref="input" v-model="query" placeholder="Busca clientes, facturas, gastos… o escribe una acción" aria-label="Buscar" autocomplete="off" @keydown="onKey">
            <kbd class="kbd">Esc</kbd>
          </div>
          <div ref="list" class="list" role="listbox">
            <template v-for="[group, items] in groups" :key="group">
              <p class="group">{{ group }}</p>
              <button
                v-for="e in items"
                :key="e.id"
                type="button"
                role="option"
                :aria-selected="e.index === active"
                class="entry"
                :class="{ on: e.index === active }"
                @mouseenter="active = e.index"
                @click="go(e)"
              >
                <span class="e-ic"><Icon :name="e.icon" /></span>
                <span class="grow truncate">{{ e.label }}</span>
                <span v-if="e.sub" class="e-sub truncate">{{ e.sub }}</span>
                <kbd v-if="e.hint && e.index !== active" class="kbd e-key" :title="`Atajo: tecla ${e.hint}`">{{ e.hint }}</kbd>
                <Icon v-if="e.index === active" name="ph:arrow-elbow-down-left" class="enter" aria-hidden="true" />
              </button>
            </template>
            <p v-if="!entries.length" class="none">Nada coincide con «{{ query }}»</p>
          </div>
          <div class="foot">
            <span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> moverse</span>
            <span><kbd class="kbd">↵</kbd> abrir</span>
            <span class="hide-touch"><kbd class="kbd">/</kbd> buscar desde cualquier pantalla</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-palette);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh var(--s-4) var(--s-4);
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.palette {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 640px;
  max-height: 70vh;
  overflow: hidden;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid var(--border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-xl), 0 0 0 1px rgb(255 255 255 / 0.04) inset;
}

.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-subtle);
}

.bar .ic {
  width: 19px;
  height: 19px;
  color: var(--text-3);
}

.spin {
  animation: spin 0.8s linear infinite;
}

.bar input {
  flex: 1;
  height: 58px;
  border: 0;
  outline: none;
  background: none;
  font-size: var(--text-lg);
}

.bar input::placeholder {
  color: var(--text-4);
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px 10px;
}

.group {
  padding: 12px 10px 6px;
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-4);
}

.entry {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 44px;
  padding: 0 10px;
  text-align: left;
  border-radius: var(--r-md);
  color: var(--text-2);
}

.entry.on {
  color: var(--text);
  background: var(--surface-hover);
}

.e-ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  font-size: 16px;
  color: var(--text-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  flex-shrink: 0;
}

.entry.on .e-ic {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: transparent;
}

.e-sub {
  max-width: 45%;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.enter {
  width: 15px;
  height: 15px;
  color: var(--text-3);
}

.none {
  padding: 28px;
  text-align: center;
  color: var(--text-3);
}

.foot {
  display: flex;
  gap: 18px;
  padding: 10px 18px;
  font-size: var(--text-xs);
  color: var(--text-3);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-2);
}

.foot span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pal-enter-active {
  transition: opacity var(--t-base) var(--ease-out);
}

.pal-enter-active .palette {
  transition: transform var(--t-slow) var(--ease-spring);
}

.pal-leave-active {
  transition: opacity 120ms var(--ease-in);
}

.pal-enter-from,
.pal-leave-to {
  opacity: 0;
}

.pal-enter-from .palette {
  transform: scale(0.97) translateY(-8px);
}

.e-key {
  flex: none;
  opacity: 0.8;
}

/* Sin teclado físico los atajos no sirven: fuera el pie entero */
@media (hover: none) {
  .foot,
  .e-key {
    display: none;
  }
}
</style>
