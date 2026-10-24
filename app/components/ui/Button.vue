<script setup lang="ts">
import { NuxtLink } from '#components'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger' | 'ai'
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  iconRight?: string
  loading?: boolean
  disabled?: boolean
  to?: string
  type?: 'button' | 'submit'
  block?: boolean
  /** Solo icono: requiere aria-label */
  square?: boolean
  /** En el móvil, solo el icono (el texto sigue ahí para lectores de pantalla) */
  compact?: boolean
}>(), { variant: 'secondary', size: 'md', type: 'button' })

const tag = computed(() => (props.to ? NuxtLink : 'button'))
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :type="to ? undefined : type"
    :disabled="to ? undefined : disabled || loading"
    :aria-busy="loading || undefined"
    class="btn"
    :class="[`btn-${variant}`, `btn-${size}`, { 'btn-block': block, 'btn-square': square, 'btn-compact': compact, 'is-loading': loading }]"
  >
    <span v-if="loading" class="spinner" aria-hidden="true" />
    <Icon v-else-if="icon" :name="icon" class="btn-icon" aria-hidden="true" />
    <span v-if="$slots.default" class="btn-label"><slot /></span>
    <Icon v-if="iconRight && !loading" :name="iconRight" class="btn-icon" aria-hidden="true" />
  </component>
</template>

<style scoped>
.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-weight: 560;
  white-space: nowrap;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  user-select: none;
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast) var(--ease-out);
}

.btn:active:not(:disabled) {
  transform: scale(0.98);
}

.btn:disabled {
  opacity: 0.5;
}

.btn-sm {
  height: 32px;
  padding: 0 11px;
  font-size: var(--text-sm);
  border-radius: var(--r-sm);
}

.btn-md {
  height: 38px;
  padding: 0 15px;
  font-size: var(--text-base);
}

.btn-lg {
  height: 46px;
  padding: 0 20px;
  font-size: var(--text-md);
  border-radius: var(--r-lg);
}

.btn-square.btn-sm { width: 32px; padding: 0; }
.btn-square.btn-md { width: 38px; padding: 0; }
.btn-square.btn-lg { width: 46px; padding: 0; }

.btn-block {
  width: 100%;
}

@media (max-width: 767px) {
  .btn-compact {
    width: 40px;
    height: 40px;
    padding: 0;
  }

  .btn-compact .btn-icon {
    width: 20px;
    height: 20px;
  }

  .btn-compact .btn-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

.btn-icon {
  width: 1.15em;
  height: 1.15em;
  flex-shrink: 0;
}

.btn-sm .btn-icon {
  width: 15px;
  height: 15px;
}

/* Variantes */

.btn-primary {
  color: var(--on-brand);
  background: var(--brand);
  box-shadow: 0 1px 2px rgb(30 27 120 / 0.25), inset 0 1px 0 rgb(255 255 255 / 0.14);
}

.btn-primary:hover:not(:disabled) {
  background: var(--brand-hover);
}

.btn-secondary {
  color: var(--text);
  background: var(--surface);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-xs);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--surface-hover);
}

.btn-ghost {
  color: var(--text-2);
}

.btn-ghost:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-hover);
}

.btn-soft {
  color: var(--brand-text);
  background: var(--brand-soft);
}

.btn-soft:hover:not(:disabled) {
  background: var(--brand-soft-2);
}

.btn-danger {
  color: #fff;
  background: var(--danger-solid);
  box-shadow: 0 1px 2px rgb(127 29 29 / 0.25), inset 0 1px 0 rgb(255 255 255 / 0.12);
}

.btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger-solid) 88%, black);
}

.btn-ai {
  color: #fff;
  background: var(--ai-grad);
  background-size: 140% 100%;
  background-position: 0 0;
  box-shadow: 0 1px 2px rgb(76 29 149 / 0.3), 0 4px 14px -4px rgb(99 70 229 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.18);
  transition: background-position var(--t-slow) var(--ease-out), box-shadow var(--t-base), transform var(--t-fast);
}

.btn-ai:hover:not(:disabled) {
  background-position: 100% 0;
}

.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  opacity: 0.85;
}

/* Dedo: los botones pequeños (⋯ de las filas, acciones de 32 px) tocan en 42 px sin cambiar su tamaño visible */
@media (pointer: coarse) {
  .btn-sm::after {
    content: '';
    position: absolute;
    inset: -5px;
  }
}
</style>
