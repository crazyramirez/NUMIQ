<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { CtxItem } from '~/composables/useContextMenu'

/**
 * El menú contextual de toda la app (uno solo, en app.vue). En escritorio flota junto al puntero,
 * nunca se sale de la pantalla y abre submenús al pasar por encima; con el teclado: flechas, Intro,
 * ← → para entrar y salir de un submenú, la inicial para saltar a una opción y Esc para cerrar.
 * En táctil es una hoja inferior: los submenús se abren dentro de ella con «‹ Atrás».
 */

interface Level {
  items: CtxItem[]
  label?: string
  /** Fila del nivel anterior de la que cuelga (para colocarlo a su lado) */
  from?: DOMRect
  style: CSSProperties
  origin: string
}

const { state, close } = useContextMenu()
const route = useRoute()

const levels = ref<Level[]>([])
const active = ref<number[]>([])
const panels = ref<HTMLElement[]>([])
const sheetEl = ref<HTMLElement>()
const sheet = computed(() => !!state.value?.sheet)
const MARGIN = 8
let lastFocus: HTMLElement | null = null
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let typed = ''
let typedTimer: ReturnType<typeof setTimeout> | undefined

// Colores propios del sitio donde se abre (el visor, siempre oscuro; la hoja de la factura, siempre clara)
const TOKENS = ['--surface', '--surface-2', '--surface-hover', '--surface-active', '--surface-sunken', '--border', '--border-subtle', '--border-strong', '--text', '--text-2', '--text-3', '--text-4', '--brand-text', '--brand-soft', '--danger', '--danger-soft']
const tokens = ref<Record<string, string>>({})
// Zonas siempre oscuras (el visor) lo piden con data-ctx-theme="dark"
const dark = ref(false)
function localTokens(el: HTMLElement | null) {
  if (!el) return {}
  const local = getComputedStyle(el)
  const global = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const t of TOKENS) {
    const v = local.getPropertyValue(t)
    if (v && v !== global.getPropertyValue(t)) out[t] = v
  }
  if (local.colorScheme !== global.colorScheme) out.colorScheme = local.colorScheme
  return out
}

const usable = (it: CtxItem | undefined) => !!it && !it.divider && !it.heading && !it.disabled

watch(() => state.value?.seq, async (seq, prev) => {
  clearTimeout(hoverTimer)
  const s = state.value
  if (!s || !seq) {
    levels.value = []
    active.value = []
    if (prev) restoreFocus()
    return
  }
  if (!prev) lastFocus = document.activeElement as HTMLElement | null
  tokens.value = localTokens(s.target)
  dark.value = s.target?.closest('[data-ctx-theme]')?.getAttribute('data-ctx-theme') === 'dark'
  levels.value = [{ items: s.items, style: { left: `${s.x}px`, top: `${s.y}px`, visibility: 'hidden' }, origin: 'top left' }]
  active.value = [s.keyboard ? firstUsable(s.items) : -1]
  await nextTick()
  if (!sheet.value) place(0)
  focusActive()
})

// Resalta el elemento sobre el que se abrió el menú (la fila, el día…)
watch(() => state.value?.target, (el, old) => {
  old?.classList.remove('ctx-target')
  el?.classList.add('ctx-target')
})

watch(() => route.fullPath, () => close())

function restoreFocus() {
  if (lastFocus && document.contains(lastFocus) && !document.activeElement?.closest('[role="dialog"]')) lastFocus.focus({ preventScroll: true })
  lastFocus = null
}

function firstUsable(items: CtxItem[]) {
  return items.findIndex(usable)
}

// ─── Posición: junto al puntero o junto a la fila del submenú, girando si no cabe ───

function place(i: number) {
  const el = panels.value[i]
  const lv = levels.value[i]
  if (!el || !lv) return
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const w = el.offsetWidth
  const h = el.offsetHeight
  let x: number
  let y: number
  let ox = 'left'
  let oy = 'top'
  if (lv.from) {
    x = lv.from.right + 2
    y = lv.from.top - 6
    if (x + w > vw - MARGIN) {
      x = lv.from.left - w - 2
      ox = 'right'
    }
  }
  else {
    x = state.value!.x
    y = state.value!.y
    if (x + w > vw - MARGIN) {
      x -= w
      ox = 'right'
    }
    if (y + h > vh - MARGIN && y - h > MARGIN) {
      y -= h
      oy = 'bottom'
    }
  }
  x = Math.max(MARGIN, Math.min(x, vw - w - MARGIN))
  y = Math.max(MARGIN, Math.min(y, vh - h - MARGIN))
  lv.style = { left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, maxHeight: `${vh - MARGIN * 2}px` }
  lv.origin = `${oy} ${ox}`
}

// ─── Submenús ───

async function openChild(level: number, index: number, focus = false) {
  const item = levels.value[level]?.items[index]
  if (!item?.children?.length) return
  const from = (sheet.value ? undefined : panels.value[level]?.querySelectorAll<HTMLElement>('[data-i]')[index]?.getBoundingClientRect())
  levels.value = [...levels.value.slice(0, level + 1), { items: item.children, label: item.label, from, style: { visibility: 'hidden' }, origin: 'top left' }]
  active.value = [...active.value.slice(0, level + 1), focus || sheet.value ? firstUsable(item.children) : -1]
  await nextTick()
  if (!sheet.value) place(level + 1)
  if (focus) focusActive()
}

function back() {
  if (levels.value.length < 2) return close()
  levels.value = levels.value.slice(0, -1)
  active.value = active.value.slice(0, levels.value.length)
  nextTick(focusActive)
}

function onEnter(level: number, index: number) {
  const item = levels.value[level]?.items[index]
  if (!usable(item)) return
  active.value = [...active.value.slice(0, level), index, ...active.value.slice(level + 1)]
  clearTimeout(hoverTimer)
  const hasOpenChild = levels.value.length > level + 1
  if (item!.children?.length) {
    // Un poco de espera: cruzar en diagonal por otras opciones no cambia de submenú
    hoverTimer = setTimeout(() => openChild(level, index), hasOpenChild ? 140 : 60)
  }
  else if (hasOpenChild) {
    hoverTimer = setTimeout(() => {
      levels.value = levels.value.slice(0, level + 1)
      active.value = active.value.slice(0, level + 1)
    }, 160)
  }
  panels.value[level]?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.focus({ preventScroll: true })
}

function onPanelEnter(level: number) {
  // Llegar al submenú cancela el cierre que la diagonal había programado
  if (level > 0) clearTimeout(hoverTimer)
}

function run(level: number, index: number) {
  const item = levels.value[level]?.items[index]
  if (!usable(item)) return
  if (item!.children?.length) return openChild(level, index, true)
  lastFocus = null
  close()
  if (item!.to) navigateTo(item!.to)
  item!.onClick?.()
}

// ─── Teclado ───

function focusActive() {
  const level = levels.value.length - 1
  const i = active.value[level] ?? -1
  const root = sheet.value ? sheetEl.value : panels.value[level]
  if (i < 0) return root?.focus({ preventScroll: true })
  root?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus({ preventScroll: true })
}

function move(dir: 1 | -1 | 'home' | 'end') {
  const level = levels.value.length - 1
  const items = levels.value[level]!.items
  const idx = items.map((it, i) => (usable(it) ? i : -1)).filter(i => i >= 0)
  if (!idx.length) return
  const cur = active.value[level] ?? -1
  let next: number
  if (dir === 'home') next = idx[0]!
  else if (dir === 'end') next = idx.at(-1)!
  else {
    const pos = idx.indexOf(cur)
    next = pos < 0 ? (dir === 1 ? idx[0]! : idx.at(-1)!) : idx[(pos + dir + idx.length) % idx.length]!
  }
  active.value = [...active.value.slice(0, level), next]
  focusActive()
}

function typeAhead(ch: string) {
  clearTimeout(typedTimer)
  typed += ch.toLowerCase()
  typedTimer = setTimeout(() => (typed = ''), 600)
  const level = levels.value.length - 1
  const items = levels.value[level]!.items
  const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const cur = active.value[level] ?? -1
  const order = [...items.keys()].map(k => (k + cur + 1) % items.length)
  const hit = order.find(k => usable(items[k]) && norm(items[k]!.label).startsWith(norm(typed)))
  if (hit == null) return
  active.value = [...active.value.slice(0, level), hit]
  focusActive()
}

function onKey(e: KeyboardEvent) {
  if (!state.value) return
  const level = levels.value.length - 1
  const keys: Record<string, () => void> = {
    Escape: () => (sheet.value || level === 0 ? close() : back()),
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    Home: () => move('home'),
    End: () => move('end'),
    ArrowRight: () => openChild(level, active.value[level] ?? -1, true),
    ArrowLeft: () => level > 0 && back(),
    Enter: () => run(level, active.value[level] ?? -1),
    ' ': () => run(level, active.value[level] ?? -1),
    Tab: () => close(),
  }
  const fn = keys[e.key]
  if (fn) {
    e.preventDefault()
    e.stopPropagation()
    return fn()
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    e.stopPropagation()
    typeAhead(e.key)
  }
}

// ─── Cierre: clic fuera, rueda, ventana que cambia o pierde el foco ───

const inside = (t: EventTarget | null) => t instanceof Node && (panels.value.some(p => p?.contains(t)) || !!sheetEl.value?.contains(t))

function onPointerDown(e: PointerEvent) {
  if (!state.value || sheet.value) return
  if (!inside(e.target)) close()
}

function onWheel(e: WheelEvent) {
  if (state.value && !sheet.value && !inside(e.target)) close()
}

function onWindowContext(e: MouseEvent) {
  // Sin menú del navegador encima del nuestro
  if (state.value && inside(e.target)) e.preventDefault()
}

const onBlur = () => state.value && !sheet.value && close()
const onResize = () => state.value && close()

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('wheel', onWheel, { capture: true, passive: true })
  window.addEventListener('contextmenu', onWindowContext)
  window.addEventListener('blur', onBlur)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('wheel', onWheel, true)
  window.removeEventListener('contextmenu', onWindowContext)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('resize', onResize)
})

// ─── Hoja inferior: arrastrar hacia abajo la cierra ───

const drag = ref(0)
let dragFrom: number | null = null

function onSheetStart(e: TouchEvent) {
  const scroller = (e.target as Element).closest('.sh-list')
  if (scroller && scroller.scrollTop > 0) return
  dragFrom = e.touches[0]!.clientY
}

function onSheetMove(e: TouchEvent) {
  if (dragFrom == null) return
  drag.value = Math.max(0, e.touches[0]!.clientY - dragFrom)
}

function onSheetEnd() {
  if (drag.value > 70) close()
  drag.value = 0
  dragFrom = null
}

const level = computed(() => levels.value.at(-1))
</script>

<template>
  <Teleport to="body">
    <!-- Escritorio: paneles flotantes (el raíz y sus submenús abiertos) -->
    <template v-if="state && !sheet">
      <TransitionGroup name="ctx" appear>
        <div
          v-for="(lv, li) in levels"
          :key="`${state.seq}-${li}`"
          :ref="(el) => { if (el) panels[li] = el as HTMLElement }"
          class="ctx-panel"
          :class="{ 'ctx-dark': dark }"
          :style="{ ...tokens, ...lv.style, transformOrigin: lv.origin }"
          role="menu"
          tabindex="-1"
          :aria-label="li ? lv.label : (state.title || 'Acciones')"
          @mouseenter="onPanelEnter(li)"
        >
          <header v-if="li === 0 && state.title" class="ctx-head">
            <span v-if="state.icon" class="ctx-head-ic"><Icon :name="state.icon" /></span>
            <span class="ctx-head-txt">
              <strong class="truncate">{{ state.title }}</strong>
              <small v-if="state.subtitle" class="truncate">{{ state.subtitle }}</small>
            </span>
          </header>
          <template v-for="(it, i) in lv.items" :key="i">
            <hr v-if="it.divider" class="ctx-sep">
            <p v-else-if="it.heading" class="ctx-heading">{{ it.heading }}</p>
            <button
              v-else
              type="button"
              role="menuitem"
              class="ctx-item"
              :class="{ danger: it.danger, on: active[li] === i, open: levels[li + 1] && active[li] === i && it.children }"
              :data-i="i"
              :aria-disabled="it.disabled || undefined"
              :aria-haspopup="it.children ? 'menu' : undefined"
              :aria-expanded="it.children ? !!(levels[li + 1] && active[li] === i) : undefined"
              tabindex="-1"
              @mouseenter="onEnter(li, i)"
              @click="run(li, i)"
            >
              <Icon v-if="it.icon" :name="it.icon" class="ctx-ic" aria-hidden="true" />
              <span v-else class="ctx-ic" aria-hidden="true" />
              <span class="ctx-label">
                <span class="truncate">{{ it.label }}</span>
                <small v-if="it.sub" class="truncate">{{ it.sub }}</small>
              </span>
              <span v-if="it.keys" class="ctx-keys" aria-hidden="true"><kbd v-for="k in it.keys" :key="k">{{ k }}</kbd></span>
              <span v-else-if="it.hint" class="ctx-hint">{{ it.hint }}</span>
              <Icon v-if="it.active" name="ph:check-bold" class="ctx-check" aria-hidden="true" />
              <Icon v-if="it.children" name="ph:caret-right-bold" class="ctx-caret" aria-hidden="true" />
            </button>
          </template>
          <p v-if="li === 0 && state.footer" class="ctx-foot">{{ state.footer }}</p>
        </div>
      </TransitionGroup>
    </template>

    <!-- Táctil: hoja inferior con las opciones grandes -->
    <Transition name="ctx-sheet" appear>
      <div v-if="state && sheet" :key="state.seq" class="ctx-overlay" :class="{ 'ctx-dark': dark }" @click.self="close()">
        <div
          ref="sheetEl"
          class="ctx-sheet"
          role="menu"
          tabindex="-1"
          :aria-label="state.title || 'Acciones'"
          :style="drag ? { ...tokens, transform: `translateY(${drag}px)`, transition: 'none' } : tokens"
          @touchstart.passive="onSheetStart"
          @touchmove.passive="onSheetMove"
          @touchend="onSheetEnd"
        >
          <span class="sh-grab" aria-hidden="true" />
          <header v-if="levels.length > 1 || state.title" class="sh-head">
            <button v-if="levels.length > 1" type="button" class="sh-back" @click="back">
              <Icon name="ph:caret-left-bold" aria-hidden="true" /> Atrás
            </button>
            <span class="sh-title">
              <strong class="truncate">{{ levels.length > 1 ? level?.label : state.title }}</strong>
              <small v-if="levels.length < 2 && state.subtitle" class="truncate">{{ state.subtitle }}</small>
            </span>
          </header>
          <Transition :name="levels.length > 1 ? 'sh-fwd' : 'sh-bwd'" mode="out-in">
            <div v-if="level" :key="levels.length" class="sh-list">
              <template v-for="(it, i) in level.items" :key="i">
                <hr v-if="it.divider" class="sh-sep">
                <p v-else-if="it.heading" class="ctx-heading sh-heading">{{ it.heading }}</p>
                <button
                  v-else
                  type="button"
                  role="menuitem"
                  class="sh-item"
                  :class="{ danger: it.danger }"
                  :data-i="i"
                  :aria-disabled="it.disabled || undefined"
                  @click="run(levels.length - 1, i)"
                >
                  <Icon v-if="it.icon" :name="it.icon" class="sh-ic" aria-hidden="true" />
                  <span class="ctx-label">
                    <span>{{ it.label }}</span>
                    <small v-if="it.sub">{{ it.sub }}</small>
                  </span>
                  <Icon v-if="it.active" name="ph:check-bold" class="ctx-check" aria-hidden="true" />
                  <Icon v-if="it.children" name="ph:caret-right-bold" class="ctx-caret" aria-hidden="true" />
                </button>
              </template>
            </div>
          </Transition>
          <button type="button" class="sh-cancel" @click="close()">Cancelar</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ─── Escritorio ─── */

/* Mismos colores que el tema oscuro, sobre zonas que siempre lo son */
.ctx-dark {
  --surface: #181b22;
  --surface-hover: #20242d;
  --surface-active: #272c37;
  --surface-sunken: #0d1015;
  --border: #2a2f3a;
  --border-subtle: #222732;
  --border-strong: #353b49;
  --text: #eef0f4;
  --text-2: #c2c7d1;
  --text-3: #9098a7;
  --text-4: #626a79;
  --brand-text: #a5b4fc;
  --brand-soft: rgb(99 102 241 / 0.18);
  --brand-ring: rgb(129 140 248 / 0.4);
  --danger: #f87171;
  --danger-soft: rgb(248 113 113 / 0.14);
  color-scheme: dark;
}

.ctx-panel {
  position: fixed;
  z-index: var(--z-popover);
  min-width: 228px;
  max-width: 320px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 5px;
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg), 0 0 0 0.5px rgb(0 0 0 / 0.04);
  backdrop-filter: blur(18px) saturate(1.6);
  -webkit-backdrop-filter: blur(18px) saturate(1.6);
  outline: none;
  user-select: none;
}

.ctx-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -1px -1px 5px;
  padding: 8px 9px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.ctx-head-ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-md);
}

.ctx-head-ic svg {
  width: 16px;
  height: 16px;
}

.ctx-head-txt {
  display: grid;
  min-width: 0;
  line-height: 1.25;
}

.ctx-head-txt strong {
  font-size: var(--text-sm);
  font-weight: 620;
}

.ctx-head-txt small {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 32px;
  padding: 5px 9px;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-2);
  text-align: left;
  border-radius: var(--r-sm);
  outline: none;
  cursor: default;
}

.ctx-item.on,
.ctx-item.open {
  color: var(--text);
  background: var(--surface-active);
}

.ctx-item.on .ctx-ic,
.ctx-item.open .ctx-ic {
  color: var(--brand-text);
}

.ctx-item[aria-disabled] {
  opacity: 0.42;
}

.ctx-item[aria-disabled].on {
  background: transparent;
}

.ctx-ic {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--text-3);
}

.ctx-label {
  display: grid;
  flex: 1;
  min-width: 0;
  line-height: 1.3;
}

.ctx-label small {
  font-size: var(--text-xs);
  font-weight: 450;
  color: var(--text-3);
}

.ctx-item.danger,
.ctx-item.danger .ctx-ic {
  color: var(--danger);
}

.ctx-item.danger.on {
  background: var(--danger-soft);
}

.ctx-keys {
  display: inline-flex;
  gap: 3px;
  margin-left: 12px;
}

kbd {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 560;
  color: var(--text-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-bottom-width: 1.5px;
  border-radius: 4px;
}

.ctx-hint {
  margin-left: 12px;
  font-size: var(--text-xs);
  color: var(--text-4);
}

.ctx-check {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--brand-text);
}

.ctx-caret {
  flex: none;
  width: 11px;
  height: 11px;
  margin-right: -2px;
  color: var(--text-4);
}

.ctx-heading {
  padding: 8px 9px 3px;
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-4);
}

.ctx-sep {
  height: 1px;
  margin: 5px -5px;
  background: var(--border-subtle);
  border: 0;
}

.ctx-foot {
  margin: 5px -5px -5px;
  padding: 7px 14px 8px;
  font-size: var(--text-2xs);
  color: var(--text-4);
  border-top: 1px solid var(--border-subtle);
}

.ctx-enter-active {
  transition: opacity 110ms var(--ease-out), transform 160ms var(--ease-out);
}

.ctx-leave-active {
  transition: opacity 90ms var(--ease-in);
}

.ctx-enter-from {
  opacity: 0;
  transform: scale(0.96);
}

.ctx-leave-to {
  opacity: 0;
}

/* ─── Táctil ─── */

.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
  display: flex;
  align-items: flex-end;
  background: var(--overlay);
  -webkit-tap-highlight-color: transparent;
}

.ctx-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 82dvh;
  padding: 6px var(--s-3) calc(var(--s-3) + env(safe-area-inset-bottom));
  background: var(--surface);
  border-radius: var(--r-2xl) var(--r-2xl) 0 0;
  box-shadow: 0 -10px 40px -10px rgb(0 0 0 / 0.3);
  outline: none;
  transition: transform 260ms var(--ease-out);
  user-select: none;
}

.sh-grab {
  align-self: center;
  flex: none;
  width: 38px;
  height: 5px;
  margin: 2px 0 8px;
  background: var(--border-strong);
  border-radius: var(--r-full);
}

.sh-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 var(--s-2) var(--s-2);
  border-bottom: 1px solid var(--border-subtle);
}

.sh-back {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px 0 6px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.sh-title {
  display: grid;
  min-width: 0;
  line-height: 1.3;
}

.sh-title strong {
  font-size: var(--text-md);
  font-weight: 620;
}

.sh-title small {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.sh-list {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px 0;
}

.sh-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 50px;
  padding: 8px var(--s-3);
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text);
  text-align: left;
  border-radius: var(--r-lg);
}

.sh-item:active {
  background: var(--surface-active);
}

.sh-item[aria-disabled] {
  opacity: 0.42;
}

.sh-item.danger,
.sh-item.danger .sh-ic {
  color: var(--danger);
}

.sh-ic {
  flex: none;
  width: 21px;
  height: 21px;
  color: var(--text-3);
}

.sh-item .ctx-label small {
  font-size: var(--text-sm);
}

.sh-heading {
  padding-inline: var(--s-3);
}

.sh-sep {
  height: 1px;
  margin: 6px var(--s-3);
  background: var(--border-subtle);
  border: 0;
}

.sh-cancel {
  flex: none;
  height: 48px;
  margin-top: 4px;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-lg);
}

.ctx-sheet-enter-active,
.ctx-sheet-leave-active {
  transition: background 220ms ease;
}

.ctx-sheet-enter-active .ctx-sheet {
  transition: transform 300ms var(--ease-out);
}

.ctx-sheet-leave-active .ctx-sheet {
  transition: transform 200ms var(--ease-in);
}

.ctx-sheet-enter-from,
.ctx-sheet-leave-to {
  background: transparent;
}

.ctx-sheet-enter-from .ctx-sheet,
.ctx-sheet-leave-to .ctx-sheet {
  transform: translateY(100%);
}

.sh-fwd-enter-active,
.sh-fwd-leave-active,
.sh-bwd-enter-active,
.sh-bwd-leave-active {
  transition: opacity 120ms ease, transform 160ms var(--ease-out);
}

.sh-fwd-enter-from,
.sh-bwd-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

.sh-fwd-leave-to,
.sh-bwd-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}

@media (prefers-reduced-motion: reduce) {
  .ctx-enter-active,
  .ctx-sheet-enter-active .ctx-sheet,
  .ctx-sheet-leave-active .ctx-sheet {
    transition: none;
  }
}
</style>

<style>
/* Lo que tiene menú contextual: sin la burbuja de iOS (vista previa del enlace, seleccionar texto) */
@media (hover: none) {
  .has-ctx {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
}

/* Pulsación larga en curso: la fila se hunde un poco antes de abrir el menú */
.has-ctx.ctx-press {
  transform: scale(0.985);
  transition: transform 300ms var(--ease-out);
}

/* El elemento sobre el que se abrió el menú queda marcado */
.ctx-target:not(tr) {
  border-radius: var(--r-md);
  box-shadow: inset 0 0 0 1.5px var(--brand-ring);
}

tr.ctx-target > td {
  background: var(--surface-hover);
}

tr.ctx-target > td:first-child {
  box-shadow: inset 2px 0 0 var(--brand);
}
</style>
