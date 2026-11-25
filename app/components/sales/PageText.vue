<script setup lang="ts">
/** Bloque de texto de una página adicional: texto con formato y su ✨ IA arriba a la derecha */
import type { AiContextValue } from '~/utils/ai-assist'

defineProps<{ placeholder?: string, context: () => Record<string, AiContextValue> }>()
const doc = defineModel<RichDoc | null>({ default: null })

// A la IA va (y vuelve) con marcas sencillas (## , - , **negrita**), como la descripción
const md = computed({
  get: () => richToMarkdown(doc.value),
  set: (v: string) => (doc.value = markdownToRich(v)),
})
const { available } = useAiStatus()
</script>

<template>
  <div class="xp-text" :class="{ 'has-ai': available, 'is-blank': richIsEmpty(doc) }">
    <UiRichText v-model="doc" label="Texto de la página" :placeholder="placeholder" />
    <AiWrite
      v-model="md"
      field="sales_page"
      :context="context"
      write-hint="A partir del título de la página y del documento"
      compact
      on-paper
      class="xp-ai no-print"
    />
  </div>
</template>

<style scoped>
.xp-text {
  position: relative;
}

/* Sitio para el ✨ a la derecha del texto (y para «Deshacer» cuando aparece) */
.xp-text.has-ai :deep(.rt-area) {
  padding-right: 36px;
}

.xp-text.has-ai:has(.ai-undo) :deep(.rt-area) {
  padding-right: 128px;
}

.xp-ai {
  position: absolute;
  top: 6px;
  right: -2px;
  z-index: 2;
  opacity: 0;
  transition: opacity var(--t-fast);
}

/* Visible al pasar o escribir; en un bloque vacío, siempre (invita a «Redactar con IA») */
.xp-text:hover .xp-ai,
.xp-text:focus-within .xp-ai,
.xp-text.is-blank .xp-ai,
.xp-ai.ai-busy,
.xp-ai.ai-open,
.xp-ai:has(.ai-undo) {
  opacity: 1;
}

@media (hover: none) {
  .xp-ai {
    opacity: 1;
  }
}
</style>
