<script setup lang="ts">
/**
 * X para vaciar el campo de al lado. Va dentro del contenedor del input (`.control` o `.clearable`)
 * y solo se ve al escribir: campo con foco y con texto. Lanza un `input` de verdad,
 * así vale igual para v-model, UiInput o campos sin modelo.
 */
const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password'])

const el = ref<HTMLButtonElement>()
const has = ref(false)
let input: HTMLInputElement | null = null

const sync = () => {
  has.value = !!input?.value && !input.disabled && !input.readOnly && TEXT_TYPES.has(input.type)
}

onMounted(() => {
  input = el.value?.parentElement?.querySelector('input') ?? null
  input?.addEventListener('input', sync)
  input?.addEventListener('focus', sync)
  sync()
})

onBeforeUnmount(() => {
  input?.removeEventListener('input', sync)
  input?.removeEventListener('focus', sync)
})

function clear() {
  if (!input) return
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus()
}
</script>

<template>
  <!-- mousedown.prevent: el campo no pierde el foco (y la X no desaparece antes del clic) -->
  <button
    ref="el"
    type="button"
    class="clear-x"
    :class="{ on: has }"
    tabindex="-1"
    aria-label="Borrar el texto"
    @mousedown.prevent
    @click="clear"
  >
    <Icon name="ph:x" aria-hidden="true" />
  </button>
</template>
