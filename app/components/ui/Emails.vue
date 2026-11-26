<script setup lang="ts">
/**
 * Campo de varios correos en píldoras: cada email se convierte en una píldora al escribir coma, punto y coma,
 * espacio o Intro (también al pegar una lista o «Nombre <email>»). Clic en la píldora para editarla, X o
 * Retroceso para quitarla, flechas para moverse entre ellas. Sugiere contactos y correos ya usados.
 * El modelo sigue siendo un texto «a@x.es, b@y.es», como el que espera el servidor.
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  label?: string
  hint?: string
  error?: string | null
  icon?: string
  placeholder?: string
  required?: boolean
  /** Máximo de correos */
  max?: number
  /** Sugerir contactos y correos ya usados */
  suggest?: boolean
  /** Correos que no se sugieren (los del otro campo: Para ↔ CC) */
  exclude?: string
}>(), { max: 5, suggest: true })

const model = defineModel<string>({ default: '' })
const attrs = useAttrs()
const id = useId()

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const isValid = (e: string) => EMAIL.test(e)
const SEP = /[,;\s]+/

/** «Ana <ana@x.es>, b@y.es» → ['ana@x.es', 'b@y.es'] */
function parse(text: string): string[] {
  const clean = text.replace(/mailto:/gi, '')
  const list = clean.includes('<') || clean.includes('"')
    ? clean.match(/[^\s,;<>"'()[\]]*@[^\s,;<>"'()[\]]*/g) ?? []
    : clean.split(SEP)
  return list.map(s => s.trim().toLowerCase().replace(/^[.]+|[.]+$/g, '')).filter(Boolean)
}

const chips = ref<string[]>(parse(model.value))
const draft = ref('')
const joined = () => chips.value.join(', ')
watch(model, (v) => {
  if ((v ?? '') !== joined()) chips.value = parse(v ?? '')
})
const emit = () => (model.value = joined())

// ─── Avisos breves (duplicado, máximo) ───
const notice = ref<string | null>(null)
const flash = ref<string | null>(null)
let noticeT: ReturnType<typeof setTimeout> | undefined
function say(msg: string, chip?: string) {
  notice.value = msg
  flash.value = chip ?? null
  clearTimeout(noticeT)
  noticeT = setTimeout(() => {
    notice.value = null
    flash.value = null
  }, 2200)
}

/** Añade correos; devuelve lo que no cupo para dejarlo en el borrador */
function add(list: string[], at = chips.value.length): string[] {
  const next = [...chips.value]
  const rest: string[] = []
  for (const e of list) {
    if (next.includes(e)) {
      say('Ese correo ya está', e)
      continue
    }
    if (next.length >= props.max) {
      rest.push(e)
      say(`Máximo ${props.max} correos`)
      continue
    }
    next.splice(at++, 0, e)
  }
  chips.value = next
  emit()
  return rest
}

function commit() {
  const list = parse(draft.value)
  draft.value = list.length ? add(list).join(', ') : ''
  sugIndex.value = 0
}

function remove(i: number, focusAfter: 'prev' | 'next' | 'input' = 'input') {
  chips.value = chips.value.filter((_, k) => k !== i)
  emit()
  nextTick(() => {
    if (focusAfter === 'input' || !chips.value.length) return input.value?.focus()
    const k = focusAfter === 'prev' ? Math.max(0, i - 1) : i
    if (k >= chips.value.length) input.value?.focus()
    else focusChip(k)
  })
}

// ─── Entrada ───
const input = ref<HTMLInputElement>()
const root = ref<HTMLElement>()
const focused = ref(false)

function focusChip(i: number) {
  root.value?.querySelectorAll<HTMLElement>('.em-chip')[i]?.focus()
}

function onInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  // Separador escrito (también en teclados móviles que no informan la tecla): lo de antes pasa a píldora
  if (SEP.test(v)) {
    const parts = v.split(SEP)
    const tail = parts.pop() ?? ''
    const left = add(parse(parts.join(',')))
    draft.value = [...left, tail].filter(Boolean).join(', ')
    if (input.value) input.value.value = draft.value
  }
  else draft.value = v
  sugIndex.value = 0
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!SEP.test(text) && !text.includes('<')) return
  e.preventDefault()
  const left = add(parse(`${draft.value} ${text}`))
  draft.value = left.join(', ')
}

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLInputElement
  const atStart = !el.value || (el.selectionStart === 0 && el.selectionEnd === 0)
  if (open.value && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault()
    const n = matches.value.length
    sugIndex.value = (sugIndex.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
    return
  }
  if (e.key === 'Enter' || (e.key === 'Tab' && draft.value.trim())) {
    if (open.value && matches.value[sugIndex.value]) {
      e.preventDefault()
      pick(matches.value[sugIndex.value]!.email)
      return
    }
    if (draft.value.trim()) {
      e.preventDefault()
      commit()
    }
    return
  }
  if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    e.stopPropagation()
    dismissed.value = true
    return
  }
  if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && atStart && chips.value.length) {
    e.preventDefault()
    focusChip(chips.value.length - 1)
  }
}

function onChipKey(e: KeyboardEvent, i: number) {
  const n = chips.value.length
  if (e.key === 'Backspace') {
    e.preventDefault()
    remove(i, 'prev')
  }
  else if (e.key === 'Delete') {
    e.preventDefault()
    remove(i, 'next')
  }
  else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    focusChip(Math.max(0, i - 1))
  }
  else if (e.key === 'ArrowRight') {
    e.preventDefault()
    if (i + 1 < n) focusChip(i + 1)
    else input.value?.focus()
  }
  else if (e.key === 'Enter' || e.key === 'F2' || e.key === ' ') {
    e.preventDefault()
    startEdit(i)
  }
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    input.value?.focus()
  }
}

// ─── Editar una píldora en su sitio ───
const editing = ref<number | null>(null)
const editText = ref('')
const editEl = ref<HTMLInputElement[]>([])

function startEdit(i: number) {
  editing.value = i
  editText.value = chips.value[i] ?? ''
  nextTick(() => {
    const el = editEl.value[0]
    el?.focus()
    el?.select()
  })
}

/** Guarda (o descarta) la edición; con el teclado, el foco vuelve al campo. Al salir con un clic, se queda donde va */
function endEdit(save = true, refocus = false) {
  const i = editing.value
  if (i == null) return
  editing.value = null
  if (save) {
    const list = parse(editText.value)
    chips.value = chips.value.filter((_, k) => k !== i)
    if (list.length) add(list, i)
    else emit()
  }
  if (refocus) nextTick(() => (save ? input.value?.focus() : focusChip(i)))
}

function onEditKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
    e.preventDefault()
    endEdit(true, true)
  }
  else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    endEdit(false, true)
  }
}

// Al salir del campo, lo escrito pasa a píldora
function onFocusOut(e: FocusEvent) {
  if (root.value?.contains(e.relatedTarget as Node)) return
  focused.value = false
  commit()
}

// ─── Sugerencias ───
type Rec = { email: string, name: string | null, uses: number }
const { data: recs } = useFetch<Rec[]>('/api/mail/recipients', { lazy: true, server: false, key: 'mail-recipients', immediate: props.suggest, default: () => [] })
const names = computed(() => new Map((recs.value ?? []).map(r => [r.email, r.name])))
const sugIndex = ref(0)
const dismissed = ref(false)
watch(draft, () => (dismissed.value = false))

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const matches = computed(() => {
  const q = norm(draft.value.trim())
  if (!props.suggest || !q) return []
  const skip = new Set([...chips.value, ...parse(props.exclude ?? '')])
  return (recs.value ?? [])
    .filter(r => !skip.has(r.email) && (norm(r.email).includes(q) || (r.name && norm(r.name).split(/\s+/).some(w => w.startsWith(q))) || (r.name && norm(r.name).startsWith(q))))
    .slice(0, 6)
})
const open = computed(() => focused.value && !dismissed.value && editing.value == null && matches.value.length > 0)

function pick(email: string) {
  draft.value = ''
  add([email])
  sugIndex.value = 0
  nextTick(() => input.value?.focus())
}

/** Resalta lo buscado dentro del texto */
function parts(text: string) {
  const q = norm(draft.value.trim())
  const k = q ? norm(text).indexOf(q) : -1
  return k < 0 ? [{ t: text, m: false }] : [{ t: text.slice(0, k), m: false }, { t: text.slice(k, k + q.length), m: true }, { t: text.slice(k + q.length), m: false }]
}

// Inicial y color estable por correo
function initial(e: string) {
  const n = names.value.get(e)
  return (n || e).replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '@'
}
function hue(e: string) {
  let h = 0
  for (const ch of e) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

const full = computed(() => chips.value.length >= props.max)
const invalidCount = computed(() => chips.value.filter(e => !isValid(e)).length)
const helper = computed(() => notice.value
  ?? (invalidCount.value ? (invalidCount.value === 1 ? 'Hay un correo no válido: haz clic en él para corregirlo' : `Hay ${invalidCount.value} correos no válidos: haz clic para corregirlos`) : null)
  ?? props.hint)
</script>

<template>
  <div class="field" :class="attrs.class" :style="attrs.style as any">
    <label v-if="label" :for="id" class="label">{{ label }}<span v-if="required" class="req" aria-hidden="true">*</span></label>
    <div
      ref="root"
      class="control em"
      :class="{ invalid: !!error || invalidCount > 0 }"
      @mousedown.self.prevent="input?.focus()"
      @focusin="focused = true"
      @focusout="onFocusOut"
    >
      <Icon v-if="icon" :name="icon" class="em-lead" aria-hidden="true" />
      <TransitionGroup name="em-pop" tag="ul" class="em-list" role="list" :aria-label="label">
        <li v-for="(e, i) in chips" :key="e" class="em-item">
          <input
            v-if="editing === i"
            ref="editEl"
            v-model="editText"
            class="em-edit"
            type="text"
            inputmode="email"
            autocomplete="off"
            spellcheck="false"
            :size="Math.max(6, editText.length + 1)"
            :aria-label="`Editar ${e}`"
            @keydown="onEditKey"
            @blur="endEdit()"
          >
          <span
            v-else
            class="em-chip"
            :class="{ bad: !isValid(e), flash: flash === e }"
            tabindex="-1"
            role="button"
            :title="isValid(e) ? `${names.get(e) ? `${names.get(e)} · ` : ''}Clic para editar` : 'Correo no válido · clic para corregir'"
            @click="startEdit(i)"
            @keydown="onChipKey($event, i)"
          >
            <span class="em-av" :style="{ '--h': hue(e) }" aria-hidden="true">
              <Icon v-if="!isValid(e)" name="ph:warning-bold" />
              <template v-else>{{ initial(e) }}</template>
            </span>
            <span class="em-txt">
              <span v-if="names.get(e)" class="em-name">{{ names.get(e) }}</span>
              <span class="em-mail">{{ e }}</span>
            </span>
            <button type="button" class="em-x" tabindex="-1" :aria-label="`Quitar ${e}`" @mousedown.prevent @click.stop="remove(i)">
              <Icon name="ph:x-bold" />
            </button>
          </span>
        </li>
        <li key="__input" class="em-in">
          <input
            :id="id"
            ref="input"
            :value="draft"
            v-bind="{ ...attrs, class: undefined, style: undefined }"
            type="text"
            inputmode="email"
            enterkeyhint="next"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            role="combobox"
            :aria-expanded="open"
            :aria-controls="`${id}-l`"
            :aria-activedescendant="open ? `${id}-o${sugIndex}` : undefined"
            :aria-invalid="!!error || undefined"
            :aria-describedby="error || helper ? `${id}-d` : undefined"
            :aria-required="required || undefined"
            :placeholder="chips.length ? (full ? '' : 'Añadir otro…') : placeholder"
            @input="onInput"
            @keydown="onKey"
            @paste="onPaste"
          >
        </li>
      </TransitionGroup>
      <span v-if="chips.length > 1 || full" class="em-count" :class="{ full }" aria-hidden="true">{{ chips.length }}/{{ max }}</span>

      <Transition name="em-fade">
        <ul v-if="open" :id="`${id}-l`" class="em-sug" role="listbox" :aria-label="`Sugerencias para ${label ?? 'el correo'}`">
          <li
            v-for="(r, k) in matches"
            :id="`${id}-o${k}`"
            :key="r.email"
            role="option"
            :aria-selected="k === sugIndex"
            class="em-opt"
            :class="{ on: k === sugIndex }"
            @mousedown.prevent="pick(r.email)"
            @mousemove="sugIndex = k"
          >
            <span class="em-av lg" :style="{ '--h': hue(r.email) }" aria-hidden="true">{{ (r.name || r.email).replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() }}</span>
            <span class="em-opt-t">
              <strong v-if="r.name"><template v-for="(p, j) in parts(r.name)" :key="j"><mark v-if="p.m">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template></strong>
              <span><template v-for="(p, j) in parts(r.email)" :key="j"><mark v-if="p.m">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template></span>
            </span>
            <span v-if="r.uses" class="em-opt-u">{{ r.uses === 1 ? 'Usado 1 vez' : `Usado ${r.uses} veces` }}</span>
            <kbd v-if="k === sugIndex" class="em-kbd">↵</kbd>
          </li>
        </ul>
      </Transition>
    </div>
    <p v-if="error" :id="`${id}-d`" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="helper" :id="`${id}-d`" class="hint" :class="{ 'em-warn': !!notice || invalidCount > 0 }" aria-live="polite">{{ helper }}</p>
  </div>
</template>

<style scoped>
.em {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 8px 4px 12px;
  cursor: text;
}

.em-lead {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-top: 10px;
  color: var(--text-3);
}

.em-list {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.em-item {
  display: flex;
  max-width: 100%;
}

.em-in {
  display: flex;
  flex: 1 1 120px;
  min-width: 120px;
}

.em-in input {
  width: 100%;
  height: 28px;
  padding: 0 2px;
  color: var(--text);
  background: none;
  border: 0;
  outline: none;
}

.em-in input::placeholder {
  color: var(--text-4);
}

/* Píldora */
.em-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 28px;
  padding: 0 3px 0 3px;
  font-size: var(--text-sm);
  color: var(--text);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 999px;
  outline: none;
  cursor: pointer;
  user-select: none;
  transition: background var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
}

.em-chip:hover {
  background: var(--surface-active);
  border-color: var(--border-strong);
}

.em-chip:focus-visible,
.em-chip:focus {
  background: var(--brand-soft);
  border-color: var(--brand);
  box-shadow: var(--focus-ring);
}

.em-chip.bad {
  color: var(--danger);
  background: var(--danger-soft);
  border-color: color-mix(in srgb, var(--danger-solid) 45%, transparent);
  border-style: dashed;
}

.em-chip.flash {
  animation: em-shake 0.42s ease;
  border-color: var(--warning-solid);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning-solid) 22%, transparent);
}

.em-av {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 20px;
  height: 20px;
  font-size: 10.5px;
  font-weight: 650;
  line-height: 1;
  color: hsl(var(--h) 55% 32%);
  background: hsl(var(--h) 75% 90%);
  border-radius: 50%;
}

:root[data-theme="dark"] .em-av {
  color: hsl(var(--h) 80% 82%);
  background: hsl(var(--h) 40% 24%);
}

.em-chip.bad .em-av {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger-solid) 16%, transparent);
}

.em-av :deep(svg) {
  width: 11px;
  height: 11px;
}

.em-av.lg {
  width: 30px;
  height: 30px;
  font-size: 13px;
}

.em-txt {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.em-name {
  flex-shrink: 0;
  font-weight: 560;
}

.em-name + .em-mail {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.em-mail {
  overflow: hidden;
  text-overflow: ellipsis;
}

.em-x {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--text-3);
  background: none;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.em-x:hover {
  color: var(--on-brand);
  background: var(--text-3);
}

.em-chip.bad .em-x:hover {
  background: var(--danger-solid);
}

.em-x :deep(svg) {
  width: 10px;
  height: 10px;
}

/* Edición en su sitio */
.em-edit {
  height: 28px;
  max-width: 100%;
  padding: 0 10px;
  font-size: var(--text-sm);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--brand);
  border-radius: 999px;
  outline: none;
  box-shadow: var(--focus-ring);
}

.em-count {
  flex-shrink: 0;
  margin-top: 7px;
  padding: 1px 7px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-4);
  border-radius: 999px;
}

.em-count.full {
  color: var(--warning);
  background: var(--warning-soft);
}

.em-warn {
  color: var(--warning);
}

/* Sugerencias */
.em-sug {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lg);
  cursor: default;
}

.em-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
}

.em-opt.on {
  background: var(--surface-hover);
}

.em-opt-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: var(--text-sm);
  line-height: 1.3;
}

.em-opt-t > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.em-opt-t strong {
  font-weight: 580;
}

.em-opt-t strong + span {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.em-opt mark {
  font-weight: 700;
  color: var(--brand-text);
  background: none;
}

.em-opt-u {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-4);
}

.em-kbd {
  flex-shrink: 0;
  min-width: 20px;
  padding: 1px 5px;
  font-family: inherit;
  font-size: 11px;
  text-align: center;
  color: var(--text-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 4px;
}

/* Animaciones */
.em-pop-enter-active {
  transition: opacity 160ms ease, transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.em-pop-leave-active {
  position: absolute;
  transition: opacity 120ms ease, transform 120ms ease;
}

.em-pop-enter-from,
.em-pop-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

.em-pop-move {
  transition: transform 180ms ease;
}

.em-fade-enter-active,
.em-fade-leave-active {
  transition: opacity 120ms ease, transform 140ms ease;
}

.em-fade-enter-from,
.em-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes em-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-3px); }
  40% { transform: translateX(3px); }
  60% { transform: translateX(-2px); }
  80% { transform: translateX(2px); }
}

@media (prefers-reduced-motion: reduce) {
  .em-pop-enter-active,
  .em-pop-leave-active,
  .em-pop-move,
  .em-fade-enter-active,
  .em-fade-leave-active {
    transition: none;
  }

  .em-chip.flash {
    animation: none;
  }
}

@media (max-width: 640px) {
  .em-opt-u {
    display: none;
  }
}

@media (hover: none) {
  .em-kbd {
    display: none;
  }
}
</style>
