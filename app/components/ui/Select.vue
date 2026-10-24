<script setup lang="ts" generic="T extends string | number | null | undefined">
defineOptions({ inheritAttrs: false })

// class y style van al contenedor (rejilla del formulario); el resto, al campo
const attrs = useAttrs()
const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }))
const fieldAttrs = computed(() => {
  const { class: _c, style: _s, ...rest } = attrs
  return rest
})

type Option = { value: string | number | null, label: string, disabled?: boolean }

defineProps<{
  label?: string
  hint?: string
  error?: string | null
  required?: boolean
  options: Option[]
  placeholder?: string
}>()

const model = defineModel<T>()
const id = useId()
</script>

<template>
  <div class="field" v-bind="rootAttrs">
    <label v-if="label" :for="id" class="label">{{ label }}<span v-if="required" class="req" aria-hidden="true">*</span></label>
    <select :id="id" v-model="model" v-bind="fieldAttrs" class="control" :class="{ invalid: !!error }" :required="required" :aria-invalid="!!error || undefined">
      <option v-if="placeholder" :value="null" disabled>{{ placeholder }}</option>
      <option v-for="o in options" :key="String(o.value)" :value="o.value" :disabled="o.disabled">{{ o.label }}</option>
    </select>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>
