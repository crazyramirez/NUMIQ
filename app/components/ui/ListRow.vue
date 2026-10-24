<script setup lang="ts">
import { NuxtLink } from '#components'

/**
 * Fila de lista en el móvil, igual en todas las pantallas: el nombre y la descripción se leen
 * enteros arriba y, debajo, una línea con los datos (nº, fecha…) y, a la derecha, el estado y el importe.
 * Abre con `to` (enlace) o emitiendo `open`; en modo selección marca la fila (`toggle`).
 */
const props = defineProps<{
  to?: string
  selecting?: boolean
  selected?: boolean
}>()
const emit = defineEmits<{ open: [], toggle: [] }>()

const isLink = computed(() => !props.selecting && !!props.to)

function onClick() {
  if (props.selecting) emit('toggle')
  else if (!props.to) emit('open')
}
</script>

<template>
  <div class="lrow" :class="{ sel: selecting && selected, 'has-menu': !!$slots.menu }">
    <component
      :is="isLink ? NuxtLink : 'button'"
      :to="isLink ? to : undefined"
      :type="isLink ? undefined : 'button'"
      :aria-pressed="selecting ? !!selected : undefined"
      class="lrow-hit"
      @click="onClick"
    >
      <span v-if="selecting" class="lrow-tick" :class="{ on: selected }" aria-hidden="true">
        <Icon v-if="selected" name="ph:check-bold" />
      </span>
      <span v-else-if="$slots.lead" class="lrow-lead"><slot name="lead" /></span>

      <span class="lrow-body">
        <span class="lrow-title"><slot name="title" /></span>
        <span v-if="$slots.sub" class="lrow-sub"><slot name="sub" /></span>
        <span v-if="$slots.note" class="lrow-note"><slot name="note" /></span>
        <span v-if="$slots.info || $slots.status || $slots.amount" class="lrow-meta">
          <span class="lrow-left">
            <span v-if="$slots.info" class="lrow-info"><slot name="info" /></span>
            <span v-if="$slots.status" class="lrow-status"><slot name="status" /></span>
          </span>
          <span v-if="$slots.amount" class="lrow-amount num"><slot name="amount" /></span>
        </span>
      </span>
    </component>

    <div v-if="$slots.menu" class="lrow-menu" @click.stop @keydown.stop>
      <slot name="menu" />
    </div>
    <slot name="after" />
  </div>
</template>

<style scoped>
.lrow {
  position: relative;
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--t-fast);
}

li:last-child > .lrow {
  border-bottom: 0;
}

.lrow.sel {
  background: color-mix(in srgb, var(--brand) 6%, transparent);
}

.lrow-hit {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 14px var(--s-4);
  color: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}

.lrow-hit:active {
  background: var(--surface-hover);
}

@media (hover: hover) {
  .lrow-hit:hover {
    background: var(--surface-hover);
  }
}

.lrow-hit:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -2px;
}

.lrow-lead,
.lrow-tick {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
}

.lrow-tick {
  font-size: 16px;
  color: var(--on-brand);
  background: var(--surface);
  border: 1.5px solid var(--border-strong);
  border-radius: 10px;
  transition: background var(--t-fast), border-color var(--t-fast);
}

.lrow-tick.on {
  background: var(--brand);
  border-color: var(--brand);
}

.lrow-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* Nombre completo, sin cortar; deja sitio al botón de acciones */
.lrow-title {
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.005em;
  color: var(--text);
  overflow-wrap: anywhere;
}

.has-menu .lrow-title {
  padding-right: 30px;
}

.lrow-sub {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--text-sm);
  line-height: 1.4;
  color: var(--text-3);
  overflow-wrap: anywhere;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.lrow-note {
  display: block;
  margin-top: 2px;
}

/* Abajo: a la izquierda nº, fecha y estado; a la derecha, el importe */
.lrow-meta {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}

.lrow-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.lrow-info {
  font-size: var(--text-xs);
  line-height: 1.35;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.lrow-status {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.lrow-amount {
  flex: none;
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--text);
  text-align: right;
}

.lrow-amount :slotted(small) {
  display: block;
  font-size: var(--text-2xs);
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-3);
}

.lrow-menu {
  position: absolute;
  top: 9px;
  right: 8px;
}
</style>
