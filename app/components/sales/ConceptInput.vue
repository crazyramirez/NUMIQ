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
      placeholder="Describe el servicio o producto, o búscalo en tu catálogo"
      aria-label="Concepto"
      autocomplete="off"
      @input="onInput"
      @focus="open = true"
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
          <span class="grow truncate">{{ i.name }}</span>
          <span v-if="i.categoryName" class="sug-cat truncate">{{ i.categoryName }}</span>
          <span class="sug-price num">{{ eur(i.unitPrice) }}<template v-if="i.unit"> / {{ i.unit }}</template></span>
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
  background: #fff;
  border: 1px solid var(--p-line-strong);
  border-radius: 10px;
  box-shadow: 0 12px 32px -8px rgb(16 24 40 / 0.25);
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

.sug-price {
  font-size: 12px;
  color: var(--p-text-3);
}

.sug-cat {
  max-width: 120px;
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
</style>
