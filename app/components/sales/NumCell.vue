<script setup lang="ts">
/** Celda numérica en línea (cantidad, precio, descuento) con coma decimal y formato al salir */
const props = withDefaults(defineProps<{
  modelValue: number | null
  decimals?: number
  suffix?: string
  label: string
  placeholder?: string
}>(), { decimals: 2 })

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const fmt = (v: number | null) =>
  v == null ? '' : v.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: props.decimals, useGrouping: false })

const focused = ref(false)
const text = ref(fmt(props.modelValue))
watch(() => props.modelValue, (v) => {
  if (!focused.value) text.value = fmt(v)
})

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  text.value = raw
  const s = raw.replace(/\s/g, '').replace(',', '.')
  if (s === '' || s === '-') emit('update:modelValue', null)
  else if (!Number.isNaN(Number(s))) emit('update:modelValue', Number(s))
}

function onFocus(e: FocusEvent) {
  focused.value = true
  ;(e.target as HTMLInputElement).select()
}

function onBlur() {
  focused.value = false
  text.value = fmt(props.modelValue)
}
</script>

<template>
  <span class="numcell">
    <input
      :value="text"
      class="cell num"
      inputmode="decimal"
      :aria-label="label"
      :placeholder="placeholder"
      autocomplete="off"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
    >
    <span v-if="suffix" class="sfx" aria-hidden="true">{{ suffix }}</span>
  </span>
</template>

<style scoped>
.numcell {
  position: relative;
  display: block;
}

.cell {
  text-align: right;
}

.sfx {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--p-text-3);
  pointer-events: none;
}

.numcell:has(.sfx) .cell {
  padding-right: 20px;
}
</style>
