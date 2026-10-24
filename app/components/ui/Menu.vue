<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'

export interface MenuItem {
  label?: string
  icon?: string
  hint?: string
  to?: string
  danger?: boolean
  divider?: boolean
  heading?: string
  active?: boolean
  onClick?: () => void
}

const props = withDefaults(defineProps<{ items: MenuItem[], align?: 'start' | 'end', width?: number, up?: boolean }>(), { align: 'end', width: 220 })

const open = ref(false)
const root = ref<HTMLElement>()
const panel = ref<HTMLElement>()
// El panel vive en <body> (Teleport): un clic dentro de él no cuenta como "fuera"
onClickOutside(root, () => (open.value = false), { ignore: [panel] })
const { style, placedUp } = useFloating(root, panel, open, { align: () => props.align, width: () => props.width, up: () => props.up })

function run(item: MenuItem) {
  open.value = false
  if (item.to) navigateTo(item.to)
  item.onClick?.()
}

const focusTrigger = () => root.value?.querySelector<HTMLElement>('button, [tabindex]')?.focus()

function onKey(e: KeyboardEvent) {
  if (!open.value) return
  // Esc o Tab cierran el menú (y no el modal en el que esté) y devuelven el foco al botón
  if (e.key === 'Escape' || (e.key === 'Tab' && panel.value?.contains(document.activeElement))) {
    e.preventDefault()
    open.value = false
    focusTrigger()
    return
  }
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
  e.preventDefault()
  const els = [...(panel.value?.querySelectorAll<HTMLElement>('.item') ?? [])]
  const i = els.indexOf(document.activeElement as HTMLElement)
  els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus()
}
</script>

<template>
  <div ref="root" class="menu" @keydown="onKey">
    <slot :open="open" :toggle="() => (open = !open)" />
    <Teleport to="body">
      <Transition name="pop">
        <div v-if="open" ref="panel" class="panel" :class="{ up: placedUp }" :style="style" role="menu" @keydown="onKey">
          <template v-for="(item, i) in items" :key="i">
            <hr v-if="item.divider" class="divider sep">
            <p v-else-if="item.heading" class="heading">{{ item.heading }}</p>
            <button v-else type="button" role="menuitem" class="item" :class="{ danger: item.danger, active: item.active }" @click="run(item)">
              <Icon v-if="item.icon" :name="item.icon" class="ic" aria-hidden="true" />
              <span class="grow truncate">{{ item.label }}</span>
              <span v-if="item.hint" class="hint-k">{{ item.hint }}</span>
              <Icon v-if="item.active" name="ph:check" class="check" aria-hidden="true" />
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.menu {
  position: relative;
  display: inline-flex;
}

/* Posición fija calculada por useFloating */
.panel {
  position: fixed;
  z-index: var(--z-popover);
  max-height: var(--float-max, 70vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 5px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-2);
  text-align: left;
  border-radius: var(--r-sm);
  outline: none;
  transition: background var(--t-fast), color var(--t-fast);
}

.item:hover,
.item:focus-visible {
  color: var(--text);
  background: var(--surface-hover);
}

.ic {
  width: 16px;
  height: 16px;
  color: var(--text-3);
}

.item.danger,
.item.danger .ic {
  color: var(--danger);
}

.item.danger:hover {
  background: var(--danger-soft);
}

.check {
  width: 15px;
  height: 15px;
  color: var(--brand-text);
}

.hint-k {
  font-size: var(--text-xs);
  color: var(--text-4);
}

.heading {
  padding: 8px 10px 4px;
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-4);
}

.sep {
  margin: 5px -5px;
}

.pop-enter-active {
  transition: opacity var(--t-fast) var(--ease-out), transform var(--t-base) var(--ease-out);
}

.pop-leave-active {
  transition: opacity 100ms var(--ease-in);
}

.pop-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.panel.up.pop-enter-from {
  transform: translateY(4px) scale(0.98);
}

.pop-leave-to {
  opacity: 0;
}
</style>
