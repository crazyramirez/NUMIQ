<script setup lang="ts">
/**
 * Diálogo modal o panel lateral (`side`). Cierra con Esc y con clic fuera; devuelve el foco al
 * elemento que lo abrió.
 */
const props = withDefaults(defineProps<{
  title?: string
  subtitle?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Panel lateral derecho en lugar de diálogo centrado */
  side?: boolean
  /** Impide cerrar por fuera (formularios con cambios) */
  persistent?: boolean
}>(), { size: 'md' })

const open = defineModel<boolean>({ default: false })
const panel = ref<HTMLElement>()
let lastFocus: HTMLElement | null = null
const self = Symbol('modal')
// Posición en la pila: el último abierto queda encima aunque su Teleport esté antes en el DOM
// (AppConfirm se monta al arrancar y si no quedaría detrás del modal desde el que se pide)
const depth = ref(0)

function close() {
  if (!props.persistent) open.value = false
}

// Modales anidados (p. ej. nuevo proveedor dentro de un gasto): Esc cierra solo el de arriba.
// Entre un listener y otro Vue ya ha sacado de la pila al que se cerró: defaultPrevented marca la tecla como atendida
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.defaultPrevented && open.value && modalStack.at(-1) === self) {
    e.preventDefault()
    e.stopPropagation()
    open.value = false
  }
}

function release() {
  const i = modalStack.indexOf(self)
  if (i >= 0) modalStack.splice(i, 1)
  if (!modalStack.length) document.documentElement.style.overflow = ''
}

// Foco inicial: primero el campo marcado con autofocus aunque haya botones antes (p. ej. «Rellenar con IA»);
// si no hay, el primero del cuerpo (nunca un botón del pie)
const FOCUSABLE = 'input:not([type=hidden]):not([tabindex="-1"]), select, textarea, button:not([tabindex="-1"])'
let watcher: MutationObserver | null = null

function focusFirst() {
  const p = panel.value
  if (!p) return
  const target = p.querySelector<HTMLElement>('[autofocus]') ?? p.querySelector<HTMLElement>(`.body :is(${FOCUSABLE})`)
  ;(target ?? p).focus()
  // Formularios que cargan sus datos: cuando aparece el campo con autofocus, se le pasa el foco
  if (!p.querySelector('[autofocus]')) {
    watcher = new MutationObserver(() => {
      const el = p.querySelector<HTMLElement>('[autofocus]')
      if (!el) return
      if (document.activeElement === p || !p.contains(document.activeElement)) el.focus()
      stopWatching()
    })
    watcher.observe(p, { childList: true, subtree: true })
  }
}

function stopWatching() {
  watcher?.disconnect()
  watcher = null
}

watch(open, async (v) => {
  if (v) {
    lastFocus = document.activeElement as HTMLElement
    depth.value = modalStack.push(self)
    document.documentElement.style.overflow = 'hidden'
    await nextTick()
    focusFirst()
  }
  else {
    stopWatching()
    release()
    lastFocus?.focus?.()
  }
})

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  stopWatching()
  release()
})
</script>

<script lang="ts">
const modalStack: symbol[] = []
</script>

<template>
  <Teleport to="body">
    <Transition :name="side ? 'sheet' : 'dialog'">
      <div v-if="open" class="overlay" :class="{ side }" :style="{ '--depth': depth }" @mousedown.self="close">
        <div ref="panel" class="panel" :class="`w-${size}`" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
          <header v-if="title || $slots.head" class="head">
            <div class="grow">
              <slot name="head">
                <h2 class="title">{{ title }}</h2>
                <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
              </slot>
            </div>
            <UiButton class="x" variant="ghost" size="sm" square icon="ph:x" aria-label="Cerrar" @click="open = false" />
          </header>
          <div class="body"><slot /></div>
          <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-modal) + var(--depth, 0));
  display: grid;
  /* Pista limitada al ancho de la pantalla: un texto largo sin cortes no ensancha el diálogo */
  grid-template-columns: minmax(0, 1fr);
  place-items: center;
  padding: var(--s-4);
  background: var(--overlay);
  backdrop-filter: blur(3px);
}

.panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: calc(100dvh - 2 * var(--s-4));
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-xl);
  outline: none;
}

.w-sm { max-width: 420px; }
.w-md { max-width: 560px; }
.w-lg { max-width: 760px; }
.w-xl { max-width: 1000px; }

.head {
  display: flex;
  align-items: flex-start;
  gap: var(--s-3);
  padding: var(--s-5) var(--s-5) var(--s-4) var(--s-6);
  border-bottom: 1px solid var(--border-subtle);
}

.title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.subtitle {
  margin-top: 3px;
  color: var(--text-3);
  font-size: var(--text-sm);
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: var(--s-6);
}

.foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--s-2);
  padding: var(--s-4) var(--s-6);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-2);
  border-radius: 0 0 var(--r-2xl) var(--r-2xl);
}

/* Panel lateral */
.side {
  /* Fila del alto de la pantalla: sin esto el panel crece con su contenido y el cuerpo no hace scroll */
  grid-template-rows: minmax(0, 1fr);
  place-items: stretch end;
  padding: var(--s-2);
}

.side .panel {
  height: 100%;
  min-height: 0;
  max-height: none;
  border-radius: var(--r-xl);
}

.side .foot {
  border-radius: 0 0 var(--r-xl) var(--r-xl);
}

/* El panel lateral tiene todo el alto: algo más ancho para que etiquetas y ayudas no se partan */
.side .w-md { max-width: 720px; }

.dialog-enter-active,
.sheet-enter-active {
  transition: opacity var(--t-base) var(--ease-out);
}

.dialog-leave-active,
.sheet-leave-active {
  transition: opacity 140ms var(--ease-in);
}

.dialog-enter-active .panel {
  transition: transform var(--t-slow) var(--ease-spring), opacity var(--t-base) var(--ease-out);
}

.sheet-enter-active .panel {
  transition: transform var(--t-slow) var(--ease-out);
}

.sheet-leave-active .panel,
.dialog-leave-active .panel {
  transition: transform 140ms var(--ease-in), opacity 140ms var(--ease-in);
}

.dialog-enter-from,
.dialog-leave-to,
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.dialog-enter-from .panel {
  transform: translateY(10px) scale(0.97);
}

.dialog-leave-to .panel {
  transform: scale(0.98);
}

.sheet-enter-from .panel,
.sheet-leave-to .panel {
  transform: translateX(32px);
}

@media (max-width: 640px) {
  .overlay:not(.side) {
    place-items: end stretch;
    padding: 0;
  }

  .overlay:not(.side) .panel {
    max-height: 92dvh;
    border-radius: var(--r-2xl) var(--r-2xl) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .side {
    padding: 0;
  }

  .side .panel {
    border-radius: 0;
  }

  .body {
    padding: var(--s-4);
  }

  .dialog-enter-from .panel {
    transform: translateY(40px);
  }
}
</style>
