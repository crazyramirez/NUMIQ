<script setup lang="ts">
/**
 * Editor de texto con formato: negrita, cursiva, subrayado, subtítulos y listas.
 * Guarda bloques (RichDoc), nunca HTML; lo pegado de Word, Google Docs o una web se limpia.
 * Atajos: Ctrl+B / Ctrl+I / Ctrl+U, «- » o «1. » al empezar una línea crea una lista.
 */
const props = defineProps<{ placeholder?: string, label?: string }>()
const model = defineModel<RichDoc | null>({ default: null })

const el = ref<HTMLDivElement>()
const focused = ref(false)
const empty = ref(true)
const state = reactive({ b: false, i: false, u: false, h: false, ul: false, ol: false })
let lastJson = 'null'

function measureEmpty() {
  empty.value = !el.value?.textContent?.trim() && !el.value?.querySelector('li')
}

function render() {
  if (!el.value) return
  el.value.innerHTML = richToHtml(model.value)
  lastJson = JSON.stringify(model.value ?? null)
  measureEmpty()
}

onMounted(render)
// Solo se repinta si el valor cambia desde fuera (cargar el documento): escribir no mueve el cursor
watch(model, v => JSON.stringify(v ?? null) !== lastJson && render())

function sync() {
  if (!el.value) return
  const doc = normalizeRich(htmlToRich(el.value))
  lastJson = JSON.stringify(doc)
  model.value = doc
  measureEmpty()
}

function refresh() {
  if (!focused.value) return
  state.b = document.queryCommandState('bold')
  state.i = document.queryCommandState('italic')
  state.u = document.queryCommandState('underline')
  state.ul = document.queryCommandState('insertUnorderedList')
  state.ol = document.queryCommandState('insertOrderedList')
  state.h = /h3/i.test(String(document.queryCommandValue('formatBlock')))
}

function run(name: string, value?: string) {
  el.value?.focus()
  document.execCommand(name, false, value)
  sync()
  refresh()
}

const toggleHeading = () => run('formatBlock', state.h ? '<p>' : '<h3>')

function clearFormat() {
  run('removeFormat')
  if (state.h) run('formatBlock', '<p>')
}

function onFocus() {
  focused.value = true
  // Párrafos <p> al pulsar Enter (no <div>)
  document.execCommand('defaultParagraphSeparator', false, 'p')
  refresh()
}

function onBlur() {
  focused.value = false
  sync()
}

function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  const html = e.clipboardData?.getData('text/html')
  const text = e.clipboardData?.getData('text/plain') ?? ''
  const doc = html
    ? normalizeRich(htmlToRich(new DOMParser().parseFromString(html, 'text/html').body))
    : normalizeRich(text.split(/\r?\n/).map(l => ({ k: 'p' as const, c: [{ t: l }] })))
  if (!doc) return
  // Un solo párrafo se pega dentro de la línea; varios, como bloques
  const only = doc.length === 1 ? doc[0]! : null
  document.execCommand('insertHTML', false, only?.k === 'p' ? spansToHtml(only.c) : richToHtml(doc))
  sync()
}

// «- », «* » o «1. » al principio de una línea vacía → lista
function onKeydown(e: KeyboardEvent) {
  if (e.key !== ' ') return
  const sel = window.getSelection()
  if (!sel?.isCollapsed || !sel.anchorNode || !el.value) return
  const node = sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode as HTMLElement
  const block = node?.closest('p, h3, li, div')
  if (!block || !el.value.contains(block) || block.tagName === 'LI') return
  const t = (block === el.value ? sel.anchorNode.textContent : block.textContent) ?? ''
  const list = /^[-*•]$/.test(t) ? 'insertUnorderedList' : /^1[.)]$/.test(t) ? 'insertOrderedList' : null
  if (!list) return
  e.preventDefault()
  const r = document.createRange()
  r.selectNodeContents(block === el.value ? sel.anchorNode : block)
  sel.removeAllRanges()
  sel.addRange(r)
  document.execCommand('delete')
  run(list)
}

function onSelection() {
  if (focused.value) refresh()
}
onMounted(() => document.addEventListener('selectionchange', onSelection))
onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelection))

const tools = computed(() => [
  { key: 'b', icon: 'ph:text-b-bold', label: 'Negrita (Ctrl+B)', on: state.b, act: () => run('bold') },
  { key: 'i', icon: 'ph:text-italic', label: 'Cursiva (Ctrl+I)', on: state.i, act: () => run('italic') },
  { key: 'u', icon: 'ph:text-underline', label: 'Subrayado (Ctrl+U)', on: state.u, act: () => run('underline') },
  { key: 'sep1' },
  { key: 'h', icon: 'ph:text-h', label: 'Subtítulo', on: state.h, act: toggleHeading },
  { key: 'ul', icon: 'ph:list-bullets', label: 'Lista con viñetas («- » al empezar)', on: state.ul, act: () => run('insertUnorderedList') },
  { key: 'ol', icon: 'ph:list-numbers', label: 'Lista numerada («1. » al empezar)', on: state.ol, act: () => run('insertOrderedList') },
  { key: 'sep2' },
  { key: 'x', icon: 'ph:text-t-slash', label: 'Quitar formato', on: false, act: clearFormat },
])
</script>

<template>
  <div class="rich-edit" :class="{ focused, empty }">
    <div class="rt-bar" role="toolbar" :aria-label="`Formato${label ? ` de ${label.toLowerCase()}` : ''}`">
      <template v-for="t in tools" :key="t.key">
        <span v-if="!t.icon" class="rt-sep" aria-hidden="true" />
        <button
          v-else
          type="button"
          class="rt-btn"
          :class="{ on: t.on }"
          :aria-pressed="t.on"
          :aria-label="t.label"
          :title="t.label"
          tabindex="-1"
          @mousedown.prevent="t.act?.()"
        >
          <Icon :name="t.icon" aria-hidden="true" />
        </button>
      </template>
    </div>
    <div
      ref="el"
      class="rt-area rich"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      :aria-label="label"
      :data-placeholder="props.placeholder"
      spellcheck="true"
      @input="sync"
      @focus="onFocus"
      @blur="onBlur"
      @paste="onPaste"
      @keydown="onKeydown"
    />
  </div>
</template>

<style scoped>
.rich-edit {
  position: relative;
}

/* Barra flotante a la derecha, sobre el campo: no tapa la etiqueta ni empuja el contenido */
.rt-bar {
  position: absolute;
  bottom: calc(100% + 4px);
  right: -8px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--p-line-strong, #d6d9e0);
  border-radius: 10px;
  box-shadow: 0 10px 28px -10px rgb(16 24 40 / 0.3);
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition: opacity 140ms var(--ease-out), transform 160ms var(--ease-out);
}

.focused .rt-bar {
  opacity: 1;
  pointer-events: auto;
  transform: none;
}

.rt-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  font-size: 16px;
  color: var(--p-text-2, #3d4452);
  border-radius: 7px;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}

.rt-btn:hover {
  background: var(--p-soft, #f6f7f9);
  color: var(--p-text, #11141b);
}

.rt-btn.on {
  color: var(--p-accent, #4f46e5);
  background: color-mix(in srgb, var(--p-accent, #4f46e5) 12%, #fff);
}

.rt-sep {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--p-line, #e7e9ee);
}

.rt-area {
  min-height: 34px;
  padding: 6px 8px;
  margin: 0 -8px;
  color: var(--p-text, #11141b);
  border: 1px solid transparent;
  border-radius: 8px;
  outline: none;
  overflow-wrap: anywhere;
  transition: border-color 120ms, background 120ms;
}

.rt-area:hover {
  background: var(--p-soft, #f6f7f9);
}

.rt-area:focus {
  background: #fff;
  border-color: var(--p-accent, #4f46e5);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-accent, #4f46e5) 14%, transparent);
}

/* Marcador de posición: flota sin ocupar sitio, el cursor queda al principio */
.empty .rt-area::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: var(--p-text-3, #6b7280);
  opacity: 0.75;
  pointer-events: none;
}

@media (hover: none) {
  .rt-bar {
    position: static;
    margin-bottom: 6px;
    width: max-content;
    max-width: 100%;
    flex-wrap: wrap;
    display: none;
  }

  .focused .rt-bar {
    display: flex;
  }
}
</style>
