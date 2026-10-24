<script setup lang="ts">
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'

/**
 * Mini-mapa de la dirección de un contacto. Teselas vectoriales de OpenFreeMap (gratuitas, sin clave)
 * dibujadas con MapLibre, que solo se descarga cuando el mapa entra en pantalla. Pulsar abre el mapa
 * del dispositivo; "Cómo llegar", la ruta.
 */
const props = defineProps<{ contactId: number, address: string }>()

interface Location { lat: number, lng: number, precision: 'exact' | 'street' | 'area' }

const { data, status } = useFetch<{ location: Location | null }>(() => `/api/contacts/${props.contactId}/location`, {
  key: `contact-location-${props.contactId}`,
  lazy: true,
  // Tras editar la dirección se vuelve a situar
  watch: [() => props.address],
})
const loc = computed(() => data.value?.location ?? null)
// Sin ubicación (o si el servicio falla) el bloque desaparece sin dejar hueco
const visible = computed(() => !!loc.value || status.value === 'pending' || status.value === 'idle')

const { isDark } = useTheme()
const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLElement | null>(null)
const ready = ref(false)
const failed = ref(false)
let map: MapLibreMap | null = null
let marker: { setLngLat: (p: [number, number]) => unknown, remove: () => void } | null = null
let pinEl: HTMLElement | null = null
const reduceMotion = import.meta.client && matchMedia('(prefers-reduced-motion: reduce)').matches

const zoomFor = (p: Location['precision']) => (p === 'exact' ? 15.4 : p === 'street' ? 15 : 12.4)
const styleUrl = () => `https://tiles.openfreemap.org/styles/${isDark.value ? 'dark' : 'positron'}`

// El mapa no se carga hasta que se ve
const seen = ref(false)
const { stop } = useIntersectionObserver(root, ([entry]) => {
  if (entry?.isIntersecting) {
    seen.value = true
    stop()
  }
}, { rootMargin: '200px' })

watch([seen, loc, canvas], () => {
  if (seen.value && loc.value && canvas.value && !map && !failed.value) mount(loc.value)
})

watch(loc, (l) => {
  if (!map || !l) return
  map.jumpTo({ center: [l.lng, l.lat], zoom: zoomFor(l.precision) })
  marker?.setLngLat([l.lng, l.lat])
  pinEl?.classList.toggle('hidden', l.precision === 'area')
  ;(map.getSource('contact-area') as GeoJSONSource | undefined)?.setData(areaData())
})

watch(isDark, () => {
  if (!map) return
  // Recarga completa: así vuelve a aplicarse el tinte (style.load)
  map.setStyle(styleUrl(), { diff: false })
})

async function mount(l: Location) {
  try {
    const [{ default: maplibregl }] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
    if (!canvas.value || map) return
    map = new maplibregl.Map({
      container: canvas.value,
      style: styleUrl(),
      center: [l.lng, l.lat],
      zoom: zoomFor(l.precision),
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    })
    map.on('style.load', tint)
    map.once('idle', () => (ready.value = true))
    map.on('error', (e) => {
      // Sin WebGL o sin red: no se rompe la ficha, el bloque se oculta
      if (!ready.value) console.warn('[mapa]', e.error?.message ?? e)
    })

    pinEl = document.createElement('div')
    pinEl.className = 'cmap-pin'
    pinEl.classList.toggle('hidden', l.precision === 'area')
    pinEl.innerHTML = '<span class="cmap-pulse"></span><span class="cmap-dot"></span>'
    marker = new maplibregl.Marker({ element: pinEl, anchor: 'center' }).setLngLat([l.lng, l.lat]).addTo(map)
  }
  catch (err) {
    failed.value = true
    console.warn('[mapa] No se pudo mostrar', err)
  }
}

/** Colores de la app sobre el estilo del mapa (fondo, agua, edificios, parques): parece parte de la tarjeta */
function tint() {
  if (!map || !root.value) return
  const css = getComputedStyle(root.value)
  const bg = toRgb(css.getPropertyValue('--surface-sunken'))
  const brand = toRgb(css.getPropertyValue('--brand'))
  const text = toRgb(css.getPropertyValue('--text'))
  if (!bg || !brand || !text) return
  const dark = isDark.value
  const green = mix([34, 160, 90], bg, dark ? 0.1 : 0.12)
  const paint: Record<string, [string, number[]]> = {
    'background': ['background-color', bg],
    'water': ['fill-color', mix(brand, bg, dark ? 0.16 : 0.13)],
    'waterway': ['line-color', mix(brand, bg, dark ? 0.16 : 0.13)],
    'building': ['fill-color', mix(text, bg, dark ? 0.07 : 0.06)],
    'landuse_residential': ['fill-color', bg],
    'park': ['fill-color', green],
    'landuse_park': ['fill-color', green],
    'landcover_wood': ['fill-color', green],
  }
  const style = map.getStyle() as StyleSpecification
  for (const layer of style.layers) {
    const p = paint[layer.id]
    if (p) map.setPaintProperty(layer.id, p[0], rgb(p[1]))
    // Flechas de sentido único y escudos de carretera: ruido a este tamaño
    else if (/oneway|shield/.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none')
  }

  // Zona aproximada: un círculo dibujado bajo los rótulos (el nombre de la población sigue legible)
  const firstLabel = style.layers.find(x => x.type === 'symbol')?.id
  map.addSource('contact-area', { type: 'geojson', data: areaData() })
  map.addLayer({
    id: 'contact-area',
    type: 'circle',
    source: 'contact-area',
    paint: {
      'circle-radius': 46,
      'circle-color': rgb(brand),
      'circle-opacity': dark ? 0.16 : 0.12,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': rgb(brand),
      'circle-stroke-opacity': 0.45,
    },
  }, firstLabel)
}

function areaData(): Parameters<GeoJSONSource['setData']>[0] {
  const l = loc.value
  return {
    type: 'FeatureCollection',
    features: l?.precision === 'area' ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [l.lng, l.lat] } }] : [],
  }
}

let probe: CanvasRenderingContext2D | null = null
function toRgb(color: string): [number, number, number] | null {
  probe ??= document.createElement('canvas').getContext('2d')
  if (!probe || !color.trim()) return null
  probe.fillStyle = '#000'
  probe.fillStyle = color.trim()
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(probe.fillStyle))
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null
}
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v * t + b[i]! * (1 - t))) as [number, number, number]
const rgb = (c: number[]) => `rgb(${c.join(',')})`

// Leve acercamiento al pasar por encima: invita a pulsar
function hover(on: boolean) {
  if (!map || !loc.value || reduceMotion) return
  map.easeTo({ zoom: zoomFor(loc.value.precision) + (on ? 0.5 : 0), duration: 700 })
}

const isApple = import.meta.client && /iPhone|iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document
const query = computed(() => props.address.replace(/\n+/g, ', '))
const openUrl = computed(() => {
  const l = loc.value
  if (isApple) return `https://maps.apple.com/?q=${encodeURIComponent(query.value)}${l ? `&ll=${l.lat},${l.lng}` : ''}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l?.precision === 'exact' || !l ? query.value : `${l.lat},${l.lng}`)}`
})
const routeUrl = computed(() => {
  const l = loc.value
  const dest = l?.precision === 'exact' || !l ? query.value : `${l.lat},${l.lng}`
  return isApple ? `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
})

onBeforeUnmount(() => {
  marker?.remove()
  map?.remove()
  map = null
})
</script>

<template>
  <Transition name="cmap-collapse">
    <div
      v-if="visible && !failed"
      ref="root"
      class="cmap"
      :class="{ ready }"
      @mouseenter="hover(true)"
      @mouseleave="hover(false)"
    >
      <div ref="canvas" class="cmap-canvas" aria-hidden="true" />
      <div class="cmap-skel" aria-hidden="true">
        <Icon name="ph:map-trifold" />
      </div>

      <a class="cmap-open" :href="openUrl" target="_blank" rel="noopener" :aria-label="`Ver ${query} en el mapa`">
        <span class="cmap-hint"><Icon name="ph:arrow-square-out" />Abrir en Mapas</span>
      </a>

      <span v-if="loc && loc.precision !== 'exact'" class="cmap-chip">
        <Icon name="ph:crosshair-simple" />{{ loc.precision === 'street' ? 'Calle aproximada' : 'Zona aproximada' }}
      </span>

      <a class="cmap-route" :href="routeUrl" target="_blank" rel="noopener">
        <Icon name="ph:navigation-arrow-fill" />Cómo llegar
      </a>

      <a class="cmap-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
    </div>
  </Transition>
</template>

<style scoped>
.cmap {
  position: relative;
  height: 176px;
  margin-bottom: var(--s-5);
  overflow: hidden;
  isolation: isolate;
  background: var(--surface-sunken);
  border-radius: var(--r-lg);
  box-shadow: inset 0 0 0 1px var(--border-subtle);
}

/* Borde interior por encima del lienzo: el mapa queda enmarcado como la tarjeta */
.cmap::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent);
}

.cmap-canvas {
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: scale(1.02);
  transition: opacity 600ms var(--ease-out), transform 900ms var(--ease-out);
}

.cmap.ready .cmap-canvas {
  opacity: 1;
  transform: none;
}

/* Mientras llega: brillo que recorre la tarjeta */
.cmap-skel {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 26px;
  color: var(--text-4);
  background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--text) 5%, transparent) 50%, transparent 70%) var(--surface-sunken);
  background-size: 220% 100%;
  animation: cmap-shimmer 1.4s linear infinite;
  transition: opacity 400ms var(--ease-out);
}

.cmap.ready .cmap-skel {
  opacity: 0;
  animation: none;
  pointer-events: none;
}

@keyframes cmap-shimmer {
  from { background-position: 120% 0; }
  to { background-position: -120% 0; }
}

.cmap-open {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 10px;
  border-radius: inherit;
}

.cmap-open:focus-visible {
  outline: none;
  box-shadow: inset var(--focus-ring);
}

/* Píldoras de cristal sobre el mapa */
.cmap-hint,
.cmap-chip,
.cmap-route {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text);
  white-space: nowrap;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 9%, transparent);
  border-radius: var(--r-full);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(10px) saturate(1.4);
  -webkit-backdrop-filter: blur(10px) saturate(1.4);
}

.cmap-hint {
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--t-base) var(--ease-out), transform var(--t-base) var(--ease-out);
}

.cmap:hover .cmap-hint,
.cmap-open:focus-visible .cmap-hint {
  opacity: 1;
  transform: none;
}

.cmap-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
  color: var(--text-2);
  pointer-events: none;
}

.cmap-route {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 4;
  color: var(--brand-text);
  transition: transform var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
}

.cmap-route:hover {
  background: var(--surface);
  transform: translateY(-1px);
}

.cmap-route:active {
  transform: scale(0.97);
}

.cmap-route:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.cmap-attr {
  position: absolute;
  right: 8px;
  bottom: 6px;
  z-index: 4;
  font-size: 10px;
  color: var(--text-3);
  opacity: 0.85;
  text-shadow: 0 0 4px var(--surface), 0 0 8px var(--surface);
}

.cmap-attr:hover {
  color: var(--text-2);
}

/* Al quedarse sin ubicación, el hueco se cierra suavemente */
.cmap-collapse-leave-active {
  transition: height var(--t-slow) var(--ease-out), margin var(--t-slow) var(--ease-out), opacity var(--t-base) var(--ease-out);
}

.cmap-collapse-leave-to {
  height: 0;
  margin-bottom: 0;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .cmap-skel {
    animation: none;
  }

  .cmap-canvas {
    transform: none;
  }
}
</style>

<style>
/* Marcador (lo crea MapLibre fuera del ámbito del componente) */
.cmap-pin {
  position: relative;
  width: 18px;
  height: 18px;
}

.cmap-dot {
  position: absolute;
  inset: 0;
  background: var(--brand);
  border: 3px solid #fff;
  border-radius: 50%;
  box-shadow: 0 2px 6px rgb(16 24 40 / 0.35), 0 0 0 1px rgb(16 24 40 / 0.08);
}

.cmap-pulse {
  position: absolute;
  inset: -11px;
  background: color-mix(in srgb, var(--brand) 28%, transparent);
  border-radius: 50%;
  animation: cmap-pulse 2.4s var(--ease-out) infinite;
}

/* Zona aproximada: la marca el círculo del propio mapa */
.cmap-pin.hidden {
  display: none;
}

@keyframes cmap-pulse {
  0% { opacity: 0.9; transform: scale(0.4); }
  70%, 100% { opacity: 0; transform: scale(1.25); }
}

@media (prefers-reduced-motion: reduce) {
  .cmap-pulse {
    animation: none;
    opacity: 0.5;
  }
}
</style>
