<script setup lang="ts">
import type { Tone } from '~/utils/labels'
import type { MenuItem } from '~/components/ui/Menu.vue'

/**
 * Etiqueta de estado que abre un menú para cambiarlo desde el propio listado.
 * Vale dentro de una fila enlazada (UiListRow): el clic no navega ni abre la fila.
 * Sin opciones (o con `disabled`, p. ej. en modo selección) se queda en una etiqueta normal.
 */
const props = withDefaults(defineProps<{
  items: MenuItem[]
  tone?: Tone
  dot?: boolean
  icon?: string
  size?: 'sm' | 'md'
  width?: number
  label?: string
  disabled?: boolean
}>(), { tone: 'neutral', size: 'md', width: 230 })

const active = computed(() => !props.disabled && props.items.length > 0)
</script>

<template>
  <UiMenu v-if="active" :items="items" :width="width" align="start">
    <template #default="{ open, toggle }">
      <span
        class="bdg-menu"
        :class="{ on: open }"
        role="button"
        tabindex="0"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-label="label"
        :title="label"
        @click.stop.prevent="toggle"
        @keydown.enter.stop.prevent="toggle"
        @keydown.space.stop.prevent="toggle"
      >
        <UiBadge :tone="tone" :dot="dot" :icon="icon" :size="size">
          <slot />
          <Icon name="ph:caret-down-bold" class="bdg-caret" aria-hidden="true" />
        </UiBadge>
      </span>
    </template>
  </UiMenu>
  <UiBadge v-else :tone="tone" :dot="dot" :icon="icon" :size="size"><slot /></UiBadge>
</template>

<style scoped>
.bdg-menu {
  display: inline-flex;
  border-radius: var(--r-full);
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.bdg-menu :deep(.badge) {
  transition: box-shadow var(--t-fast), filter var(--t-fast);
}

.bdg-caret {
  width: 9px;
  height: 9px;
  margin-right: -2px;
  opacity: 0.5;
  transition: opacity var(--t-fast), transform var(--t-base) var(--ease-out);
}

.bdg-menu:hover :deep(.badge),
.bdg-menu.on :deep(.badge) {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 32%, transparent);
}

.bdg-menu:hover .bdg-caret,
.bdg-menu.on .bdg-caret {
  opacity: 1;
}

.bdg-menu.on .bdg-caret {
  transform: rotate(180deg);
}

.bdg-menu:focus-visible :deep(.badge) {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--brand);
}

.bdg-menu:active :deep(.badge) {
  filter: brightness(0.96);
}
</style>
