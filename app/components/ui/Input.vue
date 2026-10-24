<script setup lang="ts" generic="T extends string | number | null | undefined">
defineOptions({ inheritAttrs: false })

// class y style van al contenedor (rejilla del formulario); el resto, al campo
const attrs = useAttrs()
const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }))
const fieldAttrs = computed(() => {
  const { class: _c, style: _s, ...rest } = attrs
  return rest
})

const props = withDefaults(defineProps<{
  label?: string
  hint?: string
  error?: string | null
  icon?: string
  /** Texto fijo a la derecha: €, %, días… */
  suffix?: string
  required?: boolean
  type?: string
  /** Campo numérico con coma decimal: el modelo es number | null */
  numeric?: boolean
}>(), { type: 'text' })

const model = defineModel<T>()
const id = useId()

// Texto propio mientras se escribe: "12," no debe convertirse en 12 a medias
const show = (v: unknown) => (v == null ? '' : props.numeric ? String(v).replace('.', ',') : String(v))
const text = ref(show(model.value))
const focused = ref(false)
watch(model, (v) => {
  if (!focused.value || !props.numeric) text.value = show(v)
})

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  text.value = raw
  if (!props.numeric) {
    model.value = raw as T
    return
  }
  const s = raw.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (s === '' || s === '-') model.value = null as T
  else if (!Number.isNaN(Number(s))) model.value = Number(s) as T
}

function onBlur() {
  focused.value = false
  text.value = show(model.value)
}
</script>

<template>
  <div class="field" v-bind="rootAttrs">
    <label v-if="label" :for="id" class="label">{{ label }}<span v-if="required" class="req" aria-hidden="true">*</span></label>
    <div class="control input" :class="{ invalid: !!error }">
      <Icon v-if="icon" :name="icon" class="lead" aria-hidden="true" />
      <input
        :id="id"
        :value="text"
        v-bind="fieldAttrs"
        :type="numeric ? 'text' : type"
        :inputmode="numeric ? 'decimal' : (fieldAttrs.inputmode as 'numeric' | 'text' | undefined)"
        :required="required"
        :aria-invalid="!!error || undefined"
        :aria-describedby="error || hint ? `${id}-d` : undefined"
        :class="{ num: numeric }"
        @input="onInput"
        @focus="focused = true"
        @blur="onBlur"
      >
      <span v-if="suffix" class="suffix">{{ suffix }}</span>
      <slot name="end" />
    </div>
    <p v-if="error" :id="`${id}-d`" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="hint" :id="`${id}-d`" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.input input {
  flex: 1;
  min-width: 0;
  height: 36px;
  background: none;
  border: 0;
  outline: none;
  color: var(--text);
}

.input input::placeholder {
  color: var(--text-4);
}

.lead {
  width: 16px;
  height: 16px;
  color: var(--text-3);
  flex-shrink: 0;
}

.suffix {
  color: var(--text-3);
  font-size: var(--text-sm);
  flex-shrink: 0;
}
</style>
