<script setup lang="ts">
/** Ranking de clientes o proveedores del periodo: base imponible, peso sobre el total y, debajo, total con impuestos */
interface Row { id: number | null, name: string, amount: number, count: number, total?: number }

const props = withDefaults(defineProps<{
  rows: Row[]
  /** Total del periodo para calcular el peso de cada uno */
  total: number
  kind: 'client' | 'supplier'
}>(), {})

const top = computed(() => Math.max(...props.rows.map(r => Math.abs(r.amount)), 1))
const share = (r: Row) => (props.total ? (r.amount / props.total) * 100 : 0)
const link = (r: Row) => (r.id ? `/${props.kind === 'client' ? 'clientes' : 'proveedores'}/${r.id}` : props.kind === 'client' ? '/clientes' : '/proveedores')
</script>

<template>
  <ul class="rank" :class="kind">
    <li v-for="(r, i) in rows" :key="r.id ?? `${r.name}-${i}`" :style="{ '--i': i }">
      <NuxtLink :to="link(r)" class="rank-row">
        <UiAvatar :name="r.name" :size="30" />
        <div class="grow">
          <div class="line">
            <span class="name">{{ r.name }}</span>
            <span class="num amount">{{ eur(r.amount, false) }}</span>
          </div>
          <div class="track" :title="`${pct(share(r), 1)} del total · ${r.count} ${kind === 'client' ? 'factura' : 'gasto'}${r.count === 1 ? '' : 's'}`">
            <span class="fill" :style="{ width: `${Math.max(3, (Math.abs(r.amount) / top) * 100)}%` }" />
          </div>
          <p v-if="r.total != null" class="meta num">Importe total {{ eur(r.total, false) }} · {{ r.count }} {{ kind === 'client' ? 'factura' : 'gasto' }}{{ r.count === 1 ? '' : 's' }}</p>
        </div>
        <span class="share num">{{ pct(share(r)) }}</span>
      </NuxtLink>
    </li>
  </ul>
</template>

<style scoped>
.rank {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  padding: 0;
}

.rank li {
  animation: rise 420ms var(--ease-out) both;
  animation-delay: calc(var(--i) * 35ms);
}

.rank-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 7px 8px;
  margin: 0 -8px;
  border-radius: var(--r-md);
  transition: background var(--t-fast);
}

.rank-row:hover {
  background: var(--surface-hover);
}

.line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

/* Nombre entero: si no cabe, baja a otra línea en vez de cortarse */
.name {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: 560;
  overflow-wrap: anywhere;
}

.amount {
  flex: none;
  font-size: var(--text-sm);
  font-weight: 600;
}

.track {
  height: 6px;
  background: var(--surface-sunken);
  border-radius: 0 3px 3px 0;
}

.fill {
  display: block;
  height: 100%;
  background: var(--chart-income);
  border-radius: 0 3px 3px 0;
}

.supplier .fill {
  background: var(--chart-expense);
}

.meta {
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.share {
  width: 40px;
  text-align: right;
  font-size: var(--text-xs);
  color: var(--text-3);
}
</style>
