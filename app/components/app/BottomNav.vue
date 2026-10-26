<script setup lang="ts">
/**
 * Navegación del móvil: lo de cada día a un toque (Inicio, Ingresos, Gastos, Banco) y un «+» central
 * para crear (con la foto del ticket primero). El menú completo se abre con la hamburguesa de arriba.
 */
const route = useRoute()
// El gestor entra en modo consulta: sin crear
const { readOnly } = useMe()
const { open: openScan } = useScan()
const area = computed(() => areaOf(route.path).area?.key ?? null)

const sheet = ref(false)
watch(() => route.fullPath, () => (sheet.value = false))

const actions = [
  { label: 'Nueva factura', icon: 'ph:receipt', to: '/facturas/nueva' },
  { label: 'Añadir gasto', icon: 'ph:wallet', to: '/gastos?nuevo=1' },
  { label: 'Presupuesto', icon: 'ph:file-text', to: '/presupuestos/nuevo' },
  { label: 'Cliente', icon: 'ph:user-plus', to: '/clientes?nuevo=1' },
  { label: 'Proveedor', icon: 'ph:storefront', to: '/proveedores?nuevo=1' },
  { label: 'Factura recurrente', icon: 'ph:arrows-clockwise', to: '/recurrentes?nuevo=factura' },
]

function scan() {
  sheet.value = false
  openScan()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && sheet.value) sheet.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <nav class="bnav" :class="{ ro: readOnly }" aria-label="Navegación principal">
    <NuxtLink to="/" class="bi" :class="{ on: area === 'inicio' }" :aria-current="area === 'inicio' ? 'page' : undefined">
      <Icon :name="area === 'inicio' ? 'ph:squares-four-fill' : 'ph:squares-four'" class="bi-ic" aria-hidden="true" />
      <span>Inicio</span>
    </NuxtLink>
    <NuxtLink to="/facturas" class="bi" :class="{ on: area === 'ingresos' }" :aria-current="area === 'ingresos' ? 'page' : undefined">
      <Icon :name="area === 'ingresos' ? 'ph:receipt-fill' : 'ph:receipt'" class="bi-ic" aria-hidden="true" />
      <span>Ingresos</span>
    </NuxtLink>
    <div v-if="!readOnly" class="plus-slot">
      <button type="button" class="plus" aria-label="Crear: factura, gasto, foto de ticket…" :aria-expanded="sheet" @click="sheet = true">
        <Icon name="ph:plus-bold" aria-hidden="true" />
      </button>
    </div>
    <NuxtLink to="/gastos" class="bi" :class="{ on: area === 'gastos' }" :aria-current="area === 'gastos' ? 'page' : undefined">
      <Icon :name="area === 'gastos' ? 'ph:wallet-fill' : 'ph:wallet'" class="bi-ic" aria-hidden="true" />
      <span>Gastos</span>
    </NuxtLink>
    <NuxtLink to="/banco" class="bi" :class="{ on: area === 'banco' }" :aria-current="area === 'banco' ? 'page' : undefined">
      <Icon :name="area === 'banco' ? 'ph:piggy-bank-fill' : 'ph:piggy-bank'" class="bi-ic" aria-hidden="true" />
      <span>Banco</span>
    </NuxtLink>
  </nav>

  <Teleport to="body">
    <Transition name="bs">
      <div v-if="sheet" class="bs-overlay" @click.self="sheet = false">
        <div class="bs" role="dialog" aria-modal="true" aria-label="Crear">
          <span class="bs-grab" aria-hidden="true" />
          <!-- Lo más frecuente primero: foto del ticket o la factura y la IA lo rellena -->
          <button type="button" class="bs-scan" @click="scan">
            <span class="bs-scan-ic" aria-hidden="true"><Icon name="ph:camera-fill" /></span>
            <span class="bs-scan-t">
              <strong>Foto de un ticket o factura</strong>
              <span>La IA lo lee y lo deja listo para guardar</span>
            </span>
            <Icon name="ph:caret-right" class="bs-go" aria-hidden="true" />
          </button>
          <div class="bs-grid">
            <NuxtLink v-for="a in actions" :key="a.to" :to="a.to" class="bs-tile">
              <span class="bs-tile-ic" aria-hidden="true"><Icon :name="a.icon" /></span>
              {{ a.label }}
            </NuxtLink>
          </div>
          <button type="button" class="bs-close" @click="sheet = false">Cerrar</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bnav {
  display: none;
}

@media (max-width: 767px) {
  .bnav {
    position: fixed;
    inset: auto 0 0;
    z-index: var(--z-sticky);
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    align-items: stretch;
    height: calc(var(--bnav-h) + var(--safe-b));
    padding: 0 6px var(--safe-b);
    background: color-mix(in srgb, var(--surface) 90%, transparent);
    backdrop-filter: saturate(1.6) blur(16px);
    -webkit-backdrop-filter: saturate(1.6) blur(16px);
    border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  }

  .bnav.ro {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.bi {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 560;
  color: var(--text-3);
  -webkit-tap-highlight-color: transparent;
  transition: color var(--t-fast);
}

.bi-ic {
  width: 23px;
  height: 23px;
}


.bi.on {
  color: var(--brand-text);
  font-weight: 650;
}

.bi.on .bi-ic {
  color: var(--brand);
}

.plus-slot {
  display: grid;
  place-items: center;
}

.plus {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin-top: -18px;
  font-size: 24px;
  color: #fff;
  background: linear-gradient(145deg, var(--brand), color-mix(in srgb, var(--brand) 70%, var(--ai-2)));
  border-radius: 18px;
  box-shadow: 0 8px 22px color-mix(in srgb, var(--brand) 40%, transparent), 0 0 0 4px var(--bg);
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--t-fast) var(--ease-out);
}

.plus:active {
  transform: scale(0.94);
}

/* ─── Hoja «Crear» ─── */

.bs-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: flex-end;
  background: var(--overlay);
}

.bs {
  width: 100%;
  padding: 8px var(--s-4) calc(var(--s-4) + env(safe-area-inset-bottom));
  background: var(--surface);
  border-radius: var(--r-2xl) var(--r-2xl) 0 0;
  box-shadow: var(--shadow-xl);
}

.bs-grab {
  display: block;
  width: 40px;
  height: 4px;
  margin: 2px auto 14px;
  background: var(--border-strong);
  border-radius: 2px;
}

.bs-scan {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px;
  text-align: left;
  color: var(--text);
  background: linear-gradient(135deg, color-mix(in srgb, var(--ai-soft) 85%, var(--surface)), var(--surface));
  border: 1px solid color-mix(in srgb, var(--ai-2) 30%, var(--border));
  border-radius: var(--r-xl);
}

.bs-scan-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 46px;
  height: 46px;
  font-size: 22px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: 14px;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ai-2) 35%, transparent);
}

.bs-scan-t {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.bs-scan-t strong {
  font-size: var(--text-md);
  font-weight: 650;
}

.bs-scan-t span {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.bs-go {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--text-3);
}

.bs-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.bs-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 6px 12px;
  font-size: var(--text-sm);
  font-weight: 560;
  line-height: 1.25;
  text-align: center;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.bs-tile:active {
  background: var(--surface-hover);
}

.bs-tile-ic {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  font-size: 20px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 12px;
}

.bs-close {
  width: 100%;
  height: 46px;
  margin-top: 12px;
  font-weight: 600;
  color: var(--text-2);
  border-radius: var(--r-lg);
}

.bs-close:active {
  background: var(--surface-hover);
}

.bs-enter-active,
.bs-leave-active {
  transition: opacity var(--t-base) var(--ease-out);
}

.bs-enter-active .bs,
.bs-leave-active .bs {
  transition: transform var(--t-slow) var(--ease-out);
}

.bs-enter-from,
.bs-leave-to {
  opacity: 0;
}

.bs-enter-from .bs,
.bs-leave-to .bs {
  transform: translateY(100%);
}
</style>
