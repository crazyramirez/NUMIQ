<script setup lang="ts">
/**
 * Botón flotante para volver arriba con animación suave cuando el usuario
 * se desplaza hacia abajo en visores y listados con mucho contenido.
 */
const route = useRoute()
const visible = ref(false)
/** Con una barra de selección abierta (UiBulkBar) se aparta para no tapar sus acciones */
const bulkOpen = useState('bulk-bar-open', () => false)

// Solo al subir (o al llegar al final): bajando leyendo una lista no tapa los importes de la derecha
let lastY = 0
function onScroll() {
  const y = window.scrollY
  const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 80
  if (y <= 280) visible.value = false
  else if (Math.abs(y - lastY) > 6 || atEnd) visible.value = y < lastY || atEnd
  lastY = y
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

watch(() => route.path, () => {
  // Al cambiar de página, actualizar visibilidad de inmediato
  nextTick(() => {
    onScroll()
  })
})

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <Transition name="scroll-top">
    <button
      v-show="visible && !bulkOpen"
      type="button"
      class="scroll-top-btn"
      aria-label="Volver arriba"
      title="Volver arriba"
      @click="scrollToTop"
    >
      <Icon name="ph:arrow-up-bold" class="arrow-ic" aria-hidden="true" />
    </button>
  </Transition>
</template>

<style scoped>
.scroll-top-btn {
  position: fixed;
  right: var(--s-6);
  bottom: calc(var(--s-6) + var(--bnav) + var(--safe-b));
  z-index: 45;
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--text-2);
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-full);
  box-shadow: var(--shadow-lg), 0 2px 10px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  outline: none;
  transition:
    color var(--t-fast),
    background var(--t-fast),
    border-color var(--t-fast),
    box-shadow var(--t-fast),
    transform var(--t-fast) var(--ease-spring);
}

.scroll-top-btn:hover {
  color: var(--brand-text);
  background: var(--surface);
  border-color: var(--brand);
  box-shadow: var(--shadow-xl), 0 0 0 3px var(--brand-soft);
  transform: translateY(-3px);
}

.scroll-top-btn:active {
  transform: translateY(0);
}

.scroll-top-btn:focus-visible {
  box-shadow: var(--shadow-xl), 0 0 0 3px var(--brand-soft);
  border-color: var(--brand);
}

.arrow-ic {
  width: 20px;
  height: 20px;
  transition: transform var(--t-fast) var(--ease-spring);
}

.scroll-top-btn:hover .arrow-ic {
  transform: translateY(-1px);
}

/* ─── Transición de entrada / salida ─── */
.scroll-top-enter-active,
.scroll-top-leave-active {
  transition:
    opacity 180ms ease,
    transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.scroll-top-enter-from,
.scroll-top-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.85);
}

@media (max-width: 767px) {
  .scroll-top-btn {
    right: var(--s-4);
    bottom: calc(var(--s-4) + var(--bnav) + var(--safe-b));
    width: 40px;
    height: 40px;
  }

  .arrow-ic {
    width: 18px;
    height: 18px;
  }
}

@media print {
  .scroll-top-btn {
    display: none !important;
  }
}
</style>
