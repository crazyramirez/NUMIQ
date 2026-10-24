<script setup lang="ts">
defineOptions({ inheritAttrs: false })

// class y style van al contenedor (rejilla del formulario); el resto, al campo
const attrs = useAttrs()
const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }))
const fieldAttrs = computed(() => {
  const { class: _c, style: _s, ...rest } = attrs
  return rest
})

defineProps<{
  label?: string
  hint?: string
  error?: string | null
}>()

const model = defineModel<string | null | undefined>()
const id = useId()
const value = computed({ get: () => model.value ?? '', set: v => (model.value = v) })
</script>

<template>
  <div class="field" v-bind="rootAttrs">
    <label v-if="label" :for="id" class="label">{{ label }}</label>
    <textarea :id="id" v-model="value" v-bind="fieldAttrs" class="control" :class="{ invalid: !!error }" />
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>
