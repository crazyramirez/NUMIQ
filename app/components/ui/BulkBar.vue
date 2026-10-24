<script setup lang="ts">
/** Barra flotante con las acciones para lo seleccionado en un listado (eliminar, mover, marcar…) */
import type { MenuItem } from './Menu.vue'

export interface BulkAction {
  label: string
  icon: string
  tone?: 'success' | 'warning' | 'danger'
  onClick?: () => void
  /** Abre un menú en lugar de actuar directamente */
  menu?: MenuItem[]
  menuWidth?: number
}

const props = defineProps<{
  count: number
  /** Cuántos hay a la vista: con menos seleccionados aparece «Todos» */
  total?: number
  /** «facturas seleccionadas», «seleccionados»… */
  title?: string
  sub?: string | null
  actions: BulkAction[]
  busy?: boolean
  label?: string
}>()
const emit = defineEmits<{ clear: [], all: [] }>()

const showAll = computed(() => props.total != null && props.count < props.total)

// El botón flotante de volver arriba se aparta mientras la barra está a la vista
const bulkOpen = useState('bulk-bar-open', () => false)
watch(() => props.count > 0, v => (bulkOpen.value = v), { immediate: true })
onBeforeUnmount(() => (bulkOpen.value = false))
const cols = computed(() => Math.min(4, props.actions.length + (showAll.value ? 1 : 0)))
</script>

<template>
  <Transition name="bulk">
    <div v-if="count" class="bulk-dock">
      <div class="bulk" role="toolbar" :aria-label="label ?? 'Acciones con lo seleccionado'">
        <div class="bulk-info">
          <span class="bulk-n num">{{ count }}</span>
          <span class="bulk-t">
            <span class="strong">{{ title ?? (count === 1 ? 'seleccionado' : 'seleccionados') }}</span>
            <span v-if="sub" class="muted">{{ sub }}</span>
          </span>
          <button type="button" class="bulk-x x-m" aria-label="Quitar la selección" @click="emit('clear')">
            <Icon name="ph:x" />
          </button>
        </div>
        <div class="bulk-acts" :style="{ '--cols': cols }">
          <button v-if="showAll" type="button" class="bulk-btn" :disabled="busy" @click="emit('all')">
            <Icon name="ph:checks" aria-hidden="true" /><span>Todos</span>
          </button>
          <template v-for="a in actions" :key="a.label">
            <UiMenu v-if="a.menu" :items="a.menu" :width="a.menuWidth ?? 240" up align="end">
              <template #default="{ toggle }">
                <button type="button" class="bulk-btn" :class="a.tone" :disabled="busy" aria-haspopup="menu" @click="toggle">
                  <Icon :name="a.icon" aria-hidden="true" /><span>{{ a.label }}</span>
                </button>
              </template>
            </UiMenu>
            <button v-else type="button" class="bulk-btn" :class="a.tone" :disabled="busy" @click="a.onClick?.()">
              <Icon :name="a.icon" aria-hidden="true" /><span>{{ a.label }}</span>
            </button>
          </template>
          <button type="button" class="bulk-x x-d" aria-label="Quitar la selección" title="Quitar la selección" @click="emit('clear')">
            <Icon name="ph:x" />
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.bulk-dock {
  position: sticky;
  bottom: calc(var(--s-5) + var(--bnav) + env(safe-area-inset-bottom));
  z-index: var(--z-sticky);
  display: flex;
  justify-content: center;
  margin-top: var(--s-4);
  pointer-events: none;
}

.bulk {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  max-width: 100%;
  padding: 8px 8px 8px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xl);
  pointer-events: auto;
}

.bulk-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.bulk-n {
  display: grid;
  place-items: center;
  flex: none;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--on-brand);
  background: var(--brand);
  border-radius: var(--r-md);
}

.bulk-t {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: var(--text-sm);
  line-height: 1.25;
  white-space: nowrap;
}

.bulk-t .muted {
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
}

.bulk-acts {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: var(--s-3);
  border-left: 1px solid var(--border-subtle);
}

.bulk-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  font-size: var(--text-sm);
  font-weight: 580;
  color: var(--text-2);
  white-space: nowrap;
  border-radius: var(--r-md);
  transition: background var(--t-fast), color var(--t-fast);
}

.bulk-btn :deep(svg) {
  width: 16px;
  height: 16px;
  flex: none;
  color: var(--text-3);
}

.bulk-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-hover);
}

.bulk-btn:disabled {
  opacity: 0.55;
  cursor: progress;
}

.bulk-btn:focus-visible,
.bulk-x:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.bulk-btn.success :deep(svg) {
  color: var(--success);
}

.bulk-btn.warning :deep(svg) {
  color: var(--warning);
}

.bulk-btn.danger,
.bulk-btn.danger :deep(svg) {
  color: var(--danger-solid);
}

.bulk-btn.danger:hover:not(:disabled) {
  background: var(--danger-soft);
  color: var(--danger-solid);
}

.bulk-x {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  color: var(--text-3);
  border-radius: var(--r-md);
  transition: background var(--t-fast), color var(--t-fast);
}

.bulk-x:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.bulk-x.x-m {
  display: none;
}

.bulk-enter-active {
  transition: opacity var(--t-base) var(--ease-out), transform var(--t-slow) var(--ease-spring);
}

.bulk-leave-active {
  transition: opacity var(--t-fast) var(--ease-in), transform var(--t-fast) var(--ease-in);
}

.bulk-enter-from,
.bulk-leave-to {
  opacity: 0;
  transform: translateY(14px);
}

/* Móvil: a lo ancho, el resumen arriba y las acciones en rejilla debajo */
@media (max-width: 767px) {
  .bulk-dock {
    bottom: calc(var(--s-3) + var(--bnav) + env(safe-area-inset-bottom));
  }

  .bulk {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    width: 100%;
    padding: 10px;
  }

  .bulk-x.x-m {
    display: grid;
    margin-left: auto;
  }

  .bulk-x.x-d {
    display: none;
  }

  .bulk-acts {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    padding: 8px 0 0;
    border-left: 0;
    border-top: 1px solid var(--border-subtle);
  }

  .bulk-acts > :deep(.menu) {
    display: flex;
  }

  .bulk-btn {
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    width: 100%;
    height: 52px;
    padding: 0 2px;
    font-size: var(--text-2xs);
  }

  .bulk-btn :deep(svg) {
    width: 18px;
    height: 18px;
  }
}
</style>
