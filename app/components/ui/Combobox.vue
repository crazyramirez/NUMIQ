<script setup lang="ts" generic="T extends number | string | null | undefined">
import { onClickOutside } from '@vueuse/core'

/** Selector con búsqueda (clientes, proveedores, conceptos…). Teclado: ↑ ↓ Enter Esc. */
export interface ComboOption {
  value: number | string
  label: string
  sub?: string | null
  /** Logotipo o foto (con `avatars`) */
  image?: string | null
}

const props = withDefaults(defineProps<{
  options: ComboOption[]
  label?: string
  placeholder?: string
  error?: string | null
  required?: boolean
  /** Texto de la acción "crear" al final de la lista */
  createLabel?: string
  avatars?: boolean
}>(), { placeholder: 'Buscar…' })

const emit = defineEmits<{ create: [query: string] }>()
const model = defineModel<T>()

const id = useId()
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const open = ref(false)
const query = ref('')
const active = ref(0)

const selected = computed(() => props.options.find(o => o.value === model.value) ?? null)

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const filtered = computed(() => {
  const q = norm(query.value.trim())
  const list = q ? props.options.filter(o => norm(`${o.label} ${o.sub ?? ''}`).includes(q)) : props.options
  return list.slice(0, 50)
})

watch(filtered, () => (active.value = 0))

function openList() {
  open.value = true
  query.value = ''
  nextTick(() => input.value?.focus())
}

function choose(o: ComboOption) {
  model.value = o.value as T
  open.value = false
}

function create() {
  open.value = false
  emit('create', query.value.trim())
}

function onKey(e: KeyboardEvent) {
  const max = filtered.value.length + (props.createLabel ? 1 : 0)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = (active.value + 1) % Math.max(max, 1)
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = (active.value - 1 + max) % Math.max(max, 1)
  }
  else if (e.key === 'Enter') {
    e.preventDefault()
    const o = filtered.value[active.value]
    if (o) choose(o)
    else if (props.createLabel) create()
  }
  else if (e.key === 'Escape') {
    // Cierra la lista, no el modal en el que esté
    e.preventDefault()
    open.value = false
    nextTick(() => control.value?.focus())
  }
}

// La lista vive en <body> (Teleport) pegada al campo: un clic en ella no cuenta como "fuera"
const control = ref<HTMLElement>()
const list = ref<HTMLElement>()
onClickOutside(root, () => (open.value = false), { ignore: [list] })
const { style: listStyle } = useFloating(control, list, open, { gap: 4 })
</script>

<template>
  <div ref="root" class="field combo">
    <label v-if="label" :for="id" class="label">{{ label }}<span v-if="required" class="req" aria-hidden="true">*</span></label>
    <button
      v-if="!open"
      :id="id"
      ref="control"
      type="button"
      class="control trigger"
      :class="{ invalid: !!error, empty: !selected }"
      aria-haspopup="listbox"
      @click="openList"
    >
      <UiAvatar v-if="avatars && selected" :name="selected.label" :size="22" :src="selected.image" contain />
      <span class="grow truncate">{{ selected?.label ?? placeholder }}</span>
      <span v-if="selected?.sub" class="sub truncate">{{ selected.sub }}</span>
      <Icon name="ph:caret-up-down" class="caret" aria-hidden="true" />
    </button>
    <div v-else ref="control" class="control search">
      <Icon name="ph:magnifying-glass" class="caret" aria-hidden="true" />
      <input :id="id" ref="input" v-model="query" :placeholder="placeholder" role="combobox" aria-expanded="true" :aria-controls="`${id}-l`" autocomplete="off" @keydown="onKey">
    </div>
    <Teleport to="body">
      <Transition name="pop">
        <ul v-if="open" :id="`${id}-l`" ref="list" class="list" :style="listStyle" role="listbox">
          <li
            v-for="(o, i) in filtered"
            :key="o.value"
            role="option"
            :aria-selected="o.value === model"
            class="opt"
            :class="{ active: i === active }"
            @mouseenter="active = i"
            @mousedown.prevent="choose(o)"
          >
            <UiAvatar v-if="avatars" :name="o.label" :size="26" :src="o.image" contain />
            <span class="grow">
              <span class="truncate l">{{ o.label }}</span>
              <span v-if="o.sub" class="truncate s">{{ o.sub }}</span>
            </span>
            <Icon v-if="o.value === model" name="ph:check" class="check" aria-hidden="true" />
          </li>
          <li v-if="!filtered.length && !createLabel" class="none">Sin resultados</li>
          <li
            v-if="createLabel"
            role="option"
            :aria-selected="false"
            class="opt create"
            :class="{ active: active === filtered.length }"
            @mouseenter="active = filtered.length"
            @mousedown.prevent="create"
          >
            <span class="plus"><Icon name="ph:plus" /></span>
            <span class="grow truncate">{{ createLabel }}<template v-if="query.trim()"> «{{ query.trim() }}»</template></span>
          </li>
        </ul>
      </Transition>
    </Teleport>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.combo {
  position: relative;
}

.trigger,
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
}

.trigger.empty {
  color: var(--text-4);
}

.sub {
  max-width: 40%;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.caret {
  width: 15px;
  height: 15px;
  color: var(--text-3);
  flex-shrink: 0;
}

.search input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: 0;
  outline: none;
  background: none;
}

/* Posición fija calculada por useFloating (ancho del campo) */
.list {
  position: fixed;
  z-index: var(--z-popover);
  max-height: min(300px, var(--float-max, 300px));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 5px;
  list-style: none;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
}

.opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border-radius: var(--r-sm);
  cursor: pointer;
}

.opt.active {
  background: var(--surface-hover);
}

.opt .grow {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.l {
  font-weight: 520;
}

.s {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.check {
  width: 15px;
  height: 15px;
  color: var(--brand-text);
}

.none {
  padding: 10px;
  color: var(--text-3);
  text-align: center;
}

.create {
  margin-top: 4px;
  color: var(--brand-text);
  font-weight: 550;
  border-top: 1px solid var(--border-subtle);
  border-radius: 0 0 var(--r-sm) var(--r-sm);
}

.plus {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--brand-soft);
}

.pop-enter-active {
  transition: opacity var(--t-fast) var(--ease-out), transform var(--t-base) var(--ease-out);
}

.pop-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
