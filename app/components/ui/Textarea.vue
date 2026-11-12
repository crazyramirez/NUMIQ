<script setup lang="ts">
import type { AiAssist } from '../../utils/ai-assist'

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
  /** Asistente de redacción con IA junto a la etiqueta */
  ai?: AiAssist
}>()

const model = defineModel<string | null | undefined>()
const id = useId()
const value = computed({ get: () => model.value ?? '', set: v => (model.value = v) })
</script>

<template>
  <div class="field" v-bind="rootAttrs">
    <div v-if="label && ai" class="label-row">
      <label :for="id" class="label">{{ label }}</label>
      <AiWrite v-model="value" :field="ai.field" :context="ai.context" :write-hint="ai.writeHint" :disabled="!!fieldAttrs.disabled" />
    </div>
    <label v-else-if="label" :for="id" class="label">{{ label }}</label>
    <textarea :id="id" v-model="value" v-bind="fieldAttrs" class="control" :class="{ invalid: !!error }" />
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>
