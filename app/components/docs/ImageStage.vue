<script setup lang="ts">
/** Imagen del visor: ajustada a la pantalla, con zoom (rueda, pellizco, doble clic o doble toque), arrastre y giro */
const props = defineProps<{ src: string, alt: string, rotation: number }>()
const emit = defineEmits<{ loaded: [width: number, height: number], error: [] }>()
const zoom = defineModel<number>('zoom', { default: 1 })

const stage = ref<HTMLElement>()
const wrap = ref<HTMLElement>()
const natural = reactive({ w: 0, h: 0 })
const box = reactive({ w: 0, h: 0 })
const ready = ref(false)

const { zoomAt, panning, pinching } = useZoomStage(stage, wrap, zoom, { min: 0.2, max: 8, wheel: 'always', pan: () => zoom.value > 1.01 })

const turned = computed(() => Math.abs(props.rotation % 180) === 90)
// Ajuste sin ampliar las imágenes pequeñas por encima de su tamaño real
const base = computed(() => {
  if (!natural.w || !box.w) return 1
  const pad = box.w < 640 ? 16 : 56
  const w = turned.value ? natural.h : natural.w
  const h = turned.value ? natural.w : natural.h
  return Math.min(1, (box.w - pad) / w, (box.h - pad) / h)
})
const scale = computed(() => base.value * zoom.value)
const imgStyle = computed(() => ({ width: `${natural.w * scale.value}px`, height: `${natural.h * scale.value}px`, transform: `translate(-50%, -50%) rotate(${props.rotation}deg)` }))
const wrapStyle = computed(() => {
  const w = natural.w * scale.value
  const h = natural.h * scale.value
  return { width: `${turned.value ? h : w}px`, height: `${turned.value ? w : h}px` }
})

function onLoad(e: Event) {
  const img = e.target as HTMLImageElement
  natural.w = img.naturalWidth
  natural.h = img.naturalHeight
  ready.value = true
  emit('loaded', img.naturalWidth, img.naturalHeight)
}

function toggle(x: number, y: number) {
  if (zoom.value > 1.05) zoomAt(1)
  else zoomAt(Math.max(2.5, 1 / base.value), x, y)
}

// Doble toque en pantallas táctiles (el navegador no amplía: touch-action lo impide)
let lastTap = { t: 0, x: 0, y: 0 }
function onPointerUp(e: PointerEvent) {
  if (e.pointerType !== 'touch' || pinching.value) return
  const now = performance.now()
  if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 32) {
    toggle(e.clientX, e.clientY)
    lastTap = { t: 0, x: 0, y: 0 }
    return
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY }
}

let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(() => {
    if (!stage.value) return
    box.w = stage.value.clientWidth
    box.h = stage.value.clientHeight
  })
  if (stage.value) ro.observe(stage.value)
})
onBeforeUnmount(() => ro?.disconnect())

// Tamaño real (1 px de la imagen = 1 px de pantalla), para el menú contextual del visor
defineExpose({ actualSize: () => zoomAt(1 / base.value) })
</script>

<template>
  <div
    ref="stage"
    class="img-stage"
    :class="{ zoomed: zoom > 1.01, panning }"
    @dblclick="toggle($event.clientX, $event.clientY)"
    @pointerup="onPointerUp"
  >
    <div ref="wrap" class="img-wrap" :style="wrapStyle">
      <img :src="src" :alt="alt" class="img" :class="{ ready }" :style="imgStyle" draggable="false" @load="onLoad" @error="emit('error')">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.img-stage {
  position: absolute;
  inset: 0;
  display: flex;
  overflow: auto;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
  cursor: zoom-in;
  scrollbar-width: none;
}

.img-stage::-webkit-scrollbar {
  display: none;
}

.img-stage.zoomed {
  cursor: grab;
}

.img-stage.panning {
  cursor: grabbing;
}

.img-wrap {
  position: relative;
  flex-shrink: 0;
  margin: auto;
}

.img {
  position: absolute;
  top: 50%;
  left: 50%;
  max-width: none;
  opacity: 0;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), 0 24px 64px -16px rgba(0, 0, 0, 0.6);
  transition: opacity 220ms var(--ease-out), transform 260ms var(--ease-out);
  user-select: none;
  -webkit-user-drag: none;
}

.img.ready {
  opacity: 1;
}
</style>
