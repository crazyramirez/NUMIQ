<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import type { CtxSpec } from '~/composables/useContextMenu'
import type { Placement } from '~/composables/useSignSession'

/** Firmas colocadas sobre una página del visor: se arrastran (también a otra página) y se escalan por las esquinas */
const props = defineProps<{ page: number }>()
const session = inject(SIGN_SESSION)!
const toast = useToast()

const mine = computed(() => session.placements.value.filter(p => p.page === props.page))
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const
const layerEl = ref<HTMLElement>()
const { width: layerWidth } = useElementSize(layerEl)
// En una firma pequeña (la fecha, unas iniciales) cuatro asas se pisarían: basta la de abajo a la derecha
const corners = (p: Placement) => (p.w * layerWidth.value < 96 || p.w * layerWidth.value * p.ratio < 34 ? (['se'] as const) : CORNERS)

const style = (p: Placement) => ({
  left: `${p.x * 100}%`,
  top: `${p.y * 100}%`,
  width: `${p.w * 100}%`,
  aspectRatio: `${1 / p.ratio}`,
})

function everyPage(p: Placement) {
  const n = session.everyPage(p.id)
  if (n) toast.success(`«${p.label}» en todas las páginas`, `Añadida en ${n} ${n === 1 ? 'página más' : 'páginas más'}. Deshaz con Ctrl+Z.`)
  else toast.info('Ya está en todas las páginas')
}

function menu(p: Placement): CtxSpec {
  const pages = session.pageCount()
  return {
    title: p.label,
    subtitle: pages > 1 ? `Página ${p.page + 1}` : undefined,
    icon: 'ph:signature',
    items: [
      { label: 'Duplicar', icon: 'ph:copy-simple', keys: [modKey(), 'D'], onClick: () => session.duplicate(p.id) },
      ...(pages > 1 ? [{ label: 'Poner en todas las páginas', icon: 'ph:stack', onClick: () => everyPage(p) }] : []),
      { divider: true },
      { label: 'Quitar', icon: 'ph:trash', keys: ['Supr'], danger: true, onClick: () => session.remove(p.id) },
    ],
  }
}
</script>

<template>
  <div ref="layerEl" class="sign-layer" :data-sign-page="page" @pointerdown.self="session.selected.value = null">
    <TransitionGroup :name="session.active.value ? 'plc-none' : 'plc'">
      <div
        v-for="p in mine"
        :key="p.id"
        v-ctx="() => menu(p)"
        class="plc"
        :class="{ on: session.selected.value === p.id, moving: session.active.value === 'move' && session.selected.value === p.id, sizing: session.active.value === 'resize' && session.selected.value === p.id }"
        :data-placement="p.id"
        :style="style(p)"
        role="img"
        :aria-label="`${p.label}, página ${page + 1}`"
        @pointerdown="session.start($event, p.id)"
        @dblclick.stop
      >
        <img :src="p.src" alt="" class="plc-img" draggable="false">
        <template v-if="session.selected.value === p.id">
          <span
            v-for="c in corners(p)"
            :key="c"
            class="hd"
            :class="c"
            aria-hidden="true"
            @pointerdown="session.start($event, p.id, c)"
          />
        </template>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.sign-layer {
  position: absolute;
  inset: 0;
  z-index: 4;
}

.plc {
  position: absolute;
  touch-action: none;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  border-radius: 4px;
  outline: 1.5px dashed transparent;
  outline-offset: 3px;
  transition: outline-color var(--t-fast), box-shadow var(--t-fast);
}

.plc:hover {
  outline-color: rgba(64, 98, 255, 0.45);
}

.plc.on {
  outline: 1.5px solid #4062ff;
  box-shadow: 0 0 0 4px rgba(64, 98, 255, 0.12);
}

.plc.moving {
  cursor: grabbing;
  filter: drop-shadow(0 10px 18px rgba(15, 18, 30, 0.22));
}

.plc-img {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.hd {
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border: 2px solid #4062ff;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(15, 18, 30, 0.25);
  touch-action: none;
  transition: transform var(--t-fast);
}

.hd:hover {
  transform: scale(1.25);
}

/* Zona táctil generosa alrededor de cada esquina */
.hd::after {
  position: absolute;
  inset: -12px;
  content: '';
}

.hd.nw { top: -10px; left: -10px; cursor: nwse-resize; }
.hd.ne { top: -10px; right: -10px; cursor: nesw-resize; }
.hd.sw { bottom: -10px; left: -10px; cursor: nesw-resize; }
.hd.se { right: -10px; bottom: -10px; cursor: nwse-resize; }

.plc-enter-active {
  transition: opacity 220ms var(--ease-out), transform 320ms var(--ease-spring);
}

.plc-leave-active {
  transition: opacity 140ms var(--ease-in), transform 140ms var(--ease-in);
}

.plc-enter-from {
  opacity: 0;
  transform: scale(1.12) translateY(-6px);
}

.plc-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

@media (hover: none) {
  .hd {
    width: 18px;
    height: 18px;
  }

  .hd.nw { top: -12px; left: -12px; }
  .hd.ne { top: -12px; right: -12px; }
  .hd.sw { bottom: -12px; left: -12px; }
  .hd.se { right: -12px; bottom: -12px; }
}
</style>
