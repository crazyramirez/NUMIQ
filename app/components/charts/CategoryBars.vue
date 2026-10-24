<script setup lang="ts">
/** Gasto por categoría: barras horizontales ordenadas, con icono y color de la categoría */
interface Row { id: number | null, name: string, icon: string | null, color: string | null, amount: number, total?: number }

/** `showTotal`: en Informes las barras van sobre la base y, debajo, el total con impuestos */
const props = withDefaults(defineProps<{ rows: Row[], max?: number, showTotal?: boolean }>(), { max: 6, showTotal: false })

const list = computed(() => {
  const sorted = [...props.rows].filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount)
  if (sorted.length <= props.max) return sorted
  // El resto se agrupa en "Otros": nunca un color inventado para la categoría 7ª
  const head = sorted.slice(0, props.max - 1)
  const others = sorted.slice(props.max - 1)
  const rest = others.reduce((s, r) => s + r.amount, 0)
  const restTotal = others.reduce((s, r) => s + (r.total ?? 0), 0)
  return [...head, { id: null, name: 'Otras categorías', icon: 'ph:dots-three-circle', color: null, amount: rest, total: restTotal }]
})

const total = computed(() => list.value.reduce((s, r) => s + r.amount, 0))
const top = computed(() => list.value[0]?.amount || 1)
</script>

<template>
  <ul v-if="list.length" class="cat-bars">
    <li v-for="(r, i) in list" :key="r.id ?? `otros-${i}`" class="row" :style="{ '--c': r.color || 'var(--text-4)', '--i': i }">
      <span class="ic" aria-hidden="true"><Icon :name="r.icon || 'ph:tag'" /></span>
      <div class="main">
        <div class="line">
          <span class="name truncate">{{ r.name }}</span>
          <span class="val num">{{ eur(r.amount, false) }}</span>
        </div>
        <div class="track" :title="`${r.name}: ${eur(r.amount)} (${pct(r.amount / total * 100)})`">
          <span class="fill" :style="{ width: `${Math.max(2, (r.amount / top) * 100)}%` }" />
        </div>
        <p v-if="showTotal && r.total != null" class="meta num">Importe total {{ eur(r.total, false) }}</p>
      </div>
      <span class="share num">{{ pct((r.amount / total) * 100) }}</span>
    </li>
  </ul>
  <UiEmpty v-else compact icon="ph:wallet" title="Sin gastos este trimestre" text="Registra tus gastos y verás en qué se va el dinero." />
</template>

<style scoped>
.cat-bars {
  display: flex;
  flex-direction: column;
  gap: 14px;
  list-style: none;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  animation: rise 420ms var(--ease-out) both;
  animation-delay: calc(var(--i) * 40ms);
}

.ic {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  font-size: 16px;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 13%, transparent);
  border-radius: var(--r-md);
}

.main {
  flex: 1;
  min-width: 0;
}

.line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.name {
  font-size: var(--text-sm);
  font-weight: 540;
  color: var(--text);
}

.val {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text);
}

.track {
  height: 8px;
  background: var(--surface-sunken);
  border-radius: 0 4px 4px 0;
}

.fill {
  display: block;
  height: 100%;
  background: var(--c);
  border-radius: 0 4px 4px 0;
  transform-origin: left;
  animation: grow-x 700ms var(--ease-out) both;
  animation-delay: calc(var(--i) * 40ms + 80ms);
}

@keyframes grow-x {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

.meta {
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.share {
  width: 42px;
  flex-shrink: 0;
  text-align: right;
  font-size: var(--text-xs);
  color: var(--text-3);
}
</style>
