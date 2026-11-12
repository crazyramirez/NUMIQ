<script setup lang="ts">
/**
 * Asistente de redacción de un campo: «✨ IA» junto a la etiqueta abre las acciones (mejorar, corregir,
 * más breve, más detallado, tono…) o «Redactar con IA» si está vacío, y un «Pídele otra cosa» libre.
 * El texto nuevo sustituye al del campo y «Deshacer» lo devuelve. Solo se ve con IA configurada y
 * para quien puede escribir.
 */
import { onClickOutside } from '@vueuse/core'
import type { AiContextValue, AiField } from '../utils/ai-assist'

type AiAction = 'write' | 'improve' | 'fix' | 'shorter' | 'longer' | 'formal' | 'friendly' | 'custom'

const props = defineProps<{
  modelValue: string | null | undefined
  field: AiField
  /** Datos del documento para orientar a la IA (cliente, conceptos, proveedor…); se lee al pulsar */
  context?: () => Record<string, AiContextValue>
  /** Qué usa para redactar desde cero (bajo «Redactar con IA») */
  writeHint?: string
  /** Solo el icono (líneas de conceptos) */
  compact?: boolean
  /** Sobre la hoja de la factura: siempre con colores claros */
  onPaper?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { available } = useAiStatus()
const toast = useToast()

const open = ref(false)
const busy = ref(false)
const ask = ref('')
const undoText = ref<string | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | undefined

const root = ref<HTMLElement>()
const panel = ref<HTMLElement>()
const askInput = ref<HTMLInputElement>()
onClickOutside(root, () => (open.value = false), { ignore: [panel] })
const { style, placedUp } = useFloating(root, panel, open, { align: 'end', width: 292 })

const text = computed(() => props.modelValue ?? '')
const empty = computed(() => !text.value.trim())

const ACTIONS: Array<{ key: AiAction, label: string, icon: string }> = [
  { key: 'improve', label: 'Mejorar redacción', icon: 'ph:magic-wand' },
  { key: 'fix', label: 'Corregir ortografía', icon: 'ph:text-aa' },
  { key: 'shorter', label: 'Más breve', icon: 'ph:arrows-in-simple' },
  { key: 'longer', label: 'Más detallado', icon: 'ph:arrows-out-simple' },
  { key: 'formal', label: 'Tono más formal', icon: 'ph:briefcase' },
  { key: 'friendly', label: 'Tono más cercano', icon: 'ph:smiley' },
]
const DONE: Record<AiAction, string> = {
  write: 'Texto redactado',
  improve: 'Redacción mejorada',
  fix: 'Ortografía corregida',
  shorter: 'Texto acortado',
  longer: 'Texto ampliado',
  formal: 'Tono más formal',
  friendly: 'Tono más cercano',
  custom: 'Hecho',
}

function toggle() {
  if (busy.value || props.disabled) return
  open.value = !open.value
  if (open.value) nextTick(() => (empty.value ? askInput.value?.focus() : panel.value?.querySelector<HTMLElement>('.ai-item')?.focus()))
}

function cleanContext() {
  const out: Record<string, string | number | boolean | string[]> = {}
  for (const [k, v] of Object.entries(props.context?.() ?? {})) {
    if (v == null || v === '') continue
    if (Array.isArray(v)) {
      const list = v.map(s => String(s).trim().slice(0, 400)).filter(Boolean).slice(0, 60)
      if (list.length) out[k.slice(0, 40)] = list
    }
    else out[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, 2900) : v
  }
  return out
}

async function run(action: AiAction, instruction?: string) {
  open.value = false
  busy.value = true
  const before = text.value
  try {
    const r = await $fetch<{ text: string }>('/api/ai/write', {
      method: 'POST',
      body: { field: props.field, action, text: before, instruction, context: cleanContext() },
    })
    if (text.value !== before) {
      toast.push({ tone: 'info', title: 'Has cambiado el texto mientras la IA escribía', body: 'No se ha tocado tu texto.', action: { label: 'Usar la propuesta', run: () => apply(r.text, text.value) } }, 9000)
      return
    }
    if (r.text.trim() === before.trim()) {
      toast.info('Sin cambios', action === 'fix' ? 'No había nada que corregir.' : 'La IA lo ha dejado igual.')
      return
    }
    apply(r.text, before)
    toast.success(DONE[action])
    ask.value = ''
  }
  catch (err) {
    toast.error('La IA no ha podido escribir', errorMessage(err))
  }
  finally {
    busy.value = false
  }
}

function runCustom() {
  const q = ask.value.trim()
  if (q) run(empty.value ? 'write' : 'custom', q)
}

function apply(next: string, prev: string) {
  emit('update:modelValue', next)
  undoText.value = prev
  clearTimeout(undoTimer)
  undoTimer = setTimeout(() => (undoText.value = null), 20_000)
}

function undo() {
  if (undoText.value === null) return
  emit('update:modelValue', undoText.value)
  undoText.value = null
  clearTimeout(undoTimer)
}

onBeforeUnmount(() => clearTimeout(undoTimer))

function onKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    open.value = false
    root.value?.querySelector<HTMLElement>('.ai-btn')?.focus()
    return
  }
  if (!['ArrowDown', 'ArrowUp'].includes(e.key) || document.activeElement === askInput.value) return
  e.preventDefault()
  const els = [...(panel.value?.querySelectorAll<HTMLElement>('.ai-item') ?? [])]
  const i = els.indexOf(document.activeElement as HTMLElement)
  els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus()
}
</script>

<template>
  <span v-if="available" ref="root" class="ai-w" :class="{ 'ai-compact': compact, 'ai-busy': busy, 'ai-open': open, 'ai-paper': onPaper }" @keydown="onKey">
    <button
      v-if="undoText !== null && !busy"
      type="button"
      class="ai-undo"
      title="Volver al texto de antes"
      @mousedown.prevent
      @click="undo"
    >
      <Icon name="ph:arrow-counter-clockwise" aria-hidden="true" /><span>Deshacer</span>
    </button>
    <button
      type="button"
      class="ai-btn"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-label="busy ? 'La IA está escribiendo' : 'Escribir con IA'"
      :title="busy ? 'La IA está escribiendo…' : empty ? 'Redactar con IA' : 'Mejorar con IA'"
      @mousedown.prevent
      @click="toggle"
    >
      <span v-if="busy" class="ai-spin" aria-hidden="true" />
      <Icon v-else name="ph:sparkle-fill" class="ai-ic" aria-hidden="true" />
      <span v-if="!compact" class="ai-t">{{ busy ? 'Escribiendo…' : 'IA' }}</span>
    </button>

    <Teleport to="body">
      <Transition name="pop">
        <div v-if="open" ref="panel" class="ai-panel" :class="{ up: placedUp }" :style="style" role="dialog" aria-label="Asistente de redacción" @keydown="onKey">
          <p class="ai-head"><Icon name="ph:sparkle-fill" aria-hidden="true" /> Asistente de redacción</p>
          <template v-if="empty">
            <button type="button" class="ai-item main" @click="run('write')">
              <Icon name="ph:pen-nib" class="ic" aria-hidden="true" />
              <span class="grow min0">
                <span class="ai-l">Redactar con IA</span>
                <span v-if="writeHint" class="ai-s">{{ writeHint }}</span>
              </span>
            </button>
          </template>
          <template v-else>
            <button v-for="a in ACTIONS" :key="a.key" type="button" class="ai-item" @click="run(a.key)">
              <Icon :name="a.icon" class="ic" aria-hidden="true" />
              <span class="ai-l">{{ a.label }}</span>
            </button>
          </template>
          <form class="ai-ask" @submit.prevent="runCustom">
            <input
              ref="askInput"
              v-model="ask"
              type="text"
              maxlength="500"
              :placeholder="empty ? 'O dile qué escribir…' : 'Pídele otra cosa…'"
              aria-label="Instrucción para la IA"
              autocomplete="off"
            >
            <button type="submit" class="ai-go" :disabled="!ask.trim()" aria-label="Enviar a la IA"><Icon name="ph:arrow-up-bold" aria-hidden="true" /></button>
          </form>
          <p class="ai-foot">Revisa el resultado: puedes deshacerlo.</p>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
.ai-w {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: middle;
  /* Junto a etiquetas en mayúsculas (la hoja): el botón con su propia letra */
  text-transform: none;
  letter-spacing: normal;
}

.ai-btn,
.ai-undo {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 7px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
  border-radius: 999px;
  transition: background var(--t-fast), color var(--t-fast), box-shadow var(--t-fast), opacity var(--t-fast);
}

.ai-btn {
  color: var(--ai-text);
  background: var(--ai-soft);
  box-shadow: inset 0 0 0 1px rgb(124 58 237 / 0.18);
}

.ai-btn:hover:not(:disabled),
.ai-open .ai-btn {
  box-shadow: inset 0 0 0 1px rgb(124 58 237 / 0.4);
}

.ai-btn:focus-visible,
.ai-undo:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ai-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.ai-ic {
  width: 12px;
  height: 12px;
}

.ai-compact .ai-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  justify-content: center;
}

.ai-compact .ai-ic {
  width: 13px;
  height: 13px;
}

/* Mientras escribe: el degradado de la IA se mueve */
.ai-busy .ai-btn {
  color: #fff;
  background: var(--ai-grad);
  background-size: 200% 100%;
  box-shadow: none;
  animation: ai-flow 1.6s linear infinite;
}

@keyframes ai-flow {
  to {
    background-position: -200% 0;
  }
}

.ai-spin {
  width: 11px;
  height: 11px;
  border: 1.6px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.ai-undo {
  color: var(--text-3);
  background: var(--surface-hover);
}

.ai-undo:hover {
  color: var(--text);
}

.ai-undo :deep(svg) {
  width: 12px;
  height: 12px;
}

/* Sobre la hoja (siempre clara, también en modo oscuro) */
.ai-paper .ai-btn {
  color: #5b3fd9;
  background: linear-gradient(120deg, rgb(124 58 237 / 0.08), rgb(14 165 233 / 0.08));
}

.ai-paper.ai-busy .ai-btn {
  color: #fff;
  background: linear-gradient(120deg, #7c3aed 0%, #4f46e5 45%, #0ea5e9 100%);
  background-size: 200% 100%;
}

.ai-paper .ai-undo {
  color: #626a79;
  background: #f1f2f5;
}

.ai-paper .ai-undo:hover {
  color: #11141b;
}

/* Panel */
.ai-panel {
  position: fixed;
  z-index: var(--z-popover);
  max-height: var(--float-max, 70vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
}

.ai-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px;
  font-size: var(--text-2xs);
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ai-text);
}

.ai-head :deep(svg) {
  width: 12px;
  height: 12px;
}

.ai-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-2);
  text-align: left;
  border-radius: var(--r-sm);
  outline: none;
  transition: background var(--t-fast), color var(--t-fast);
}

.ai-item:hover,
.ai-item:focus-visible {
  color: var(--text);
  background: var(--surface-hover);
}

.ai-item .ic {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--text-3);
}

.ai-item.main .ic {
  color: var(--ai-text);
}

.ai-l {
  display: block;
}

.ai-item.main .ai-l {
  font-weight: 600;
  color: var(--text);
}

.ai-s {
  display: block;
  margin-top: 1px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.min0 {
  min-width: 0;
}

.ai-ask {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 2px 2px;
  padding: 4px 4px 4px 10px;
  background: var(--surface-2, var(--surface-hover));
  border: 1px solid var(--border);
  border-radius: 10px;
  transition: border-color var(--t-fast), box-shadow var(--t-fast);
}

.ai-ask:focus-within {
  border-color: rgb(124 58 237 / 0.5);
  box-shadow: 0 0 0 3px rgb(124 58 237 / 0.12);
}

.ai-ask input {
  flex: 1;
  min-width: 0;
  height: 28px;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--text);
  background: transparent;
  border: 0;
  outline: none;
}

.ai-ask input::placeholder {
  color: var(--text-4);
}

.ai-go {
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: 8px;
  transition: opacity var(--t-fast);
}

.ai-go:disabled {
  opacity: 0.35;
}

.ai-go :deep(svg) {
  width: 13px;
  height: 13px;
}

.ai-foot {
  padding: 6px 8px 2px;
  font-size: var(--text-2xs);
  color: var(--text-4);
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

.ai-panel.up.pop-enter-from {
  transform: translateY(4px) scale(0.98);
}

.pop-leave-to {
  opacity: 0;
}

/* Dedo: 22 px de alto se tocan en 40 */
@media (pointer: coarse) {
  .ai-btn,
  .ai-undo {
    position: relative;
  }

  .ai-btn::after,
  .ai-undo::after {
    content: '';
    position: absolute;
    inset: -9px -4px;
  }
}
</style>
