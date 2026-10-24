<script setup lang="ts">
/**
 * Concepto de una línea: texto libre multilínea con sugerencias del catálogo mientras escribes.
 * ↓ para entrar en la lista, Enter para elegir; si no, Enter es un salto de línea normal.
 */
export interface CatalogItem {
  id: number
  name: string
  description: string | null
  unitPrice: number
  vatRate: number
  unit: string | null
  kind: 'service' | 'product'
  imageUrl?: string | null
  categoryName?: string | null
}

const props = defineProps<{ modelValue: string, items: CatalogItem[], linked?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string], 'pick': [item: CatalogItem] }>()

const el = ref<HTMLTextAreaElement>()
const open = ref(false)
const active = ref(-1)

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const matches = computed(() => {
  const q = norm(props.modelValue.trim())
  if (props.linked && q) return []
  const list = q ? props.items.filter(i => norm(`${i.name} ${i.description ?? ''} ${i.categoryName ?? ''}`).includes(q)) : props.items
  return list.slice(0, 7)
})

function grow() {
  if (!el.value) return
  el.value.style.height = 'auto'
  el.value.style.height = `${el.value.scrollHeight}px`
}

watch(() => props.modelValue, () => nextTick(grow))
onMounted(grow)

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
  open.value = true
  active.value = -1
}

function pick(i: CatalogItem) {
  emit('pick', i)
  open.value = false
}

// En el móvil el teclado tapa media pantalla: el concepto sube para que la lista del catálogo quepa debajo
function onFocus() {
  open.value = true
  if (window.matchMedia('(max-width: 767px)').matches) setTimeout(() => el.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 280)
}

function onKey(e: KeyboardEvent) {
  if (!open.value || !matches.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = (active.value + 1) % matches.value.length
  }
  else if (e.key === 'ArrowUp' && active.value >= 0) {
    e.preventDefault()
    active.value = active.value - 1
  }
  else if (e.key === 'Enter' && active.value >= 0) {
    e.preventDefault()
    pick(matches.value[active.value]!)
  }
  else if (e.key === 'Escape') {
    open.value = false
  }
}
</script>

<template>
  <div class="concept">
    <textarea
      ref="el"
      :value="modelValue"
      rows="1"
      class="cell desc"
      placeholder="Concepto, o búscalo en tu catálogo"
      aria-label="Concepto"
      autocomplete="off"
      @input="onInput"
      @focus="onFocus"
      @blur="open = false"
      @keydown="onKey"
    />
    <Transition name="sug">
      <ul v-if="open && matches.length" class="sug" role="listbox">
        <li class="sug-head">{{ modelValue.trim() ? 'Del catálogo' : 'Tu catálogo' }}</li>
        <li
          v-for="(i, idx) in matches"
          :key="i.id"
          role="option"
          :aria-selected="idx === active"
          class="sug-item"
          :class="{ on: idx === active }"
          @mouseenter="active = idx"
          @mousedown.prevent="pick(i)"
        >
          <img v-if="i.imageUrl" :src="i.imageUrl" alt="" class="sug-pic" loading="lazy">
          <Icon v-else :name="i.kind === 'product' ? 'ph:package' : 'ph:briefcase'" class="sug-ic" />
          <span class="sug-main">
            <span class="sug-name">{{ i.name }}</span>
            <span v-if="i.categoryName" class="sug-cat">{{ i.categoryName }}</span>
          </span>
          <span class="sug-price num">
            <span class="sug-amount">{{ eur(i.unitPrice) }}</span>
            <span v-if="i.unit" class="sug-unit">/ {{ i.unit }}</span>
          </span>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.concept {
  position: relative;
}

.desc {
  display: block;
  scroll-margin-top: calc(var(--topbar-h) + 128px);
  width: 100%;
  min-height: 34px;
  padding-top: 7px;
  padding-bottom: 7px;
  resize: none;
  overflow: hidden;
  line-height: 1.45;
  text-align: left;
}

.sug {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 5;
  width: 460px;
  max-width: calc(100vw - 48px);
  padding: 5px;
  margin: 0;
  list-style: none;
  text-align: left;
  background: #fff;
  border: 1px solid var(--p-line-strong);
  border-radius: 10px;
  box-shadow: 0 12px 32px -8px rgb(16 24 40 / 0.25);
  max-height: min(360px, 52vh);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.sug-head {
  padding: 6px 8px 4px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--p-text-3);
}

.sug-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--p-text);
}

.sug-item.on {
  background: var(--p-soft);
}

.sug-ic {
  width: 15px;
  height: 15px;
  color: var(--p-accent);
  flex-shrink: 0;
}

.sug-pic {
  width: 26px;
  height: 26px;
  margin: -4px 0;
  flex-shrink: 0;
  object-fit: cover;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 0 0 1px var(--p-line, #e7e9ee);
}

.sug-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sug-name {
  min-width: 0;
  overflow: hidden;
  font-weight: 550;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sug-price {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.3;
  text-align: right;
}

.sug-amount {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text);
}

.sug-unit {
  font-size: 11px;
  color: var(--p-text-3);
}

.sug-cat {
  flex: none;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 560;
  color: var(--p-text-3);
  background: var(--p-soft);
  border-radius: 999px;
}

.sug-enter-active {
  transition: opacity 120ms var(--ease-out), transform 160ms var(--ease-out);
}

.sug-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

/* Hoja estrecha: la lista ocupa el ancho del concepto y los nombres no se cortan */
@media (max-width: 767px) {
  /* En el flujo, no flotando: empuja lo de debajo y nunca queda tapada por la barra inferior */
  .sug {
    position: static;
    margin-top: 6px;
    width: auto;
    max-width: none;
    padding: 6px;
    border-radius: 12px;
  }

  .sug-item {
    align-items: flex-start;
    padding: 10px 8px;
  }

  .sug-main {
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }

  .sug-name {
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .sug-ic {
    margin-top: 2px;
  }

  .sug-pic {
    margin: -2px 0 0;
  }

  .sug-cat {
    align-self: flex-start;
  }
}
</style>
