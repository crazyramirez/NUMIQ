<script setup lang="ts">
/**
 * «Hoy»: lo que hay que hacer, de lo más urgente a lo menos, cada cosa con su botón.
 * Si no hay nada pendiente, lo celebra: también es información.
 */
interface Task {
  key: string
  icon: string
  tone: 'danger' | 'warning' | 'info' | 'brand'
  title: string
  detail: string | null
  action: { label: string, to: string }
}

defineProps<{ tasks: Task[] }>()

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
// El gestor no las hace él: ve lo que la empresa tiene pendiente
const { readOnly } = useMe()
</script>

<template>
  <UiCard class="today" padding="none">
    <header class="today-h">
      <div>
        <h2 class="today-t">Hoy</h2>
        <p class="today-s">{{ tasks.length ? `${readOnly ? `${plural(tasks.length, 'cosa pendiente', 'cosas pendientes')} en la empresa` : `${plural(tasks.length, 'cosa', 'cosas')} por hacer`}, de más a menos urgente` : 'Nada urgente' }}</p>
      </div>
      <span v-if="tasks.length" class="today-n num" aria-hidden="true">{{ tasks.length }}</span>
    </header>

    <ul v-if="tasks.length" class="tasks">
      <li v-for="t in tasks" :key="t.key" class="task" :class="t.tone">
        <span class="t-ic" aria-hidden="true"><Icon :name="t.icon" /></span>
        <div class="t-main">
          <p class="t-title">{{ t.title }}</p>
          <p v-if="t.detail" class="t-detail">{{ t.detail }}</p>
        </div>
        <UiButton
          class="t-act"
          size="sm"
          :variant="t.tone === 'danger' ? 'primary' : 'secondary'"
          icon-right="ph:arrow-right"
          compact
          :to="t.action.to"
        >
          {{ t.action.label }}
        </UiButton>
      </li>
    </ul>

    <div v-else class="calm">
      <span class="calm-ic" aria-hidden="true"><Icon name="ph:check-circle-fill" /></span>
      <div>
        <p class="calm-t">Todo al día</p>
        <p class="calm-s">Sin vencidas, sin borradores y con el banco revisado.{{ readOnly ? '' : ' Buen momento para facturar.' }}</p>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
/* Columnas según el ancho de la tarjeta (la barra lateral también resta) */
.today {
  container: today / inline-size;
}

.today-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-5) var(--s-3);
}

.today-t {
  font-size: var(--text-lg);
  font-weight: 680;
  letter-spacing: -0.015em;
}

.today-s {
  margin-top: 1px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.today-n {
  display: grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--on-brand);
  background: var(--brand);
  border-radius: var(--r-full);
}

.tasks {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--border-subtle);
}

.task {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 14px var(--s-5);
  border-bottom: 1px solid var(--border-subtle);
}

.task:last-child {
  border-bottom: 0;
}

@container today (min-width: 960px) {
  .tasks {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .task:nth-child(odd) {
    border-right: 1px solid var(--border-subtle);
  }

  .task:nth-last-child(2):nth-child(odd) {
    border-bottom: 0;
  }
}

.t-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  font-size: 19px;
  border-radius: 11px;
}

.danger .t-ic {
  color: var(--danger);
  background: var(--danger-soft);
}

.warning .t-ic {
  color: var(--warning);
  background: var(--warning-soft);
}

.info .t-ic {
  color: var(--info);
  background: var(--info-soft);
}

.brand .t-ic {
  color: var(--brand-text);
  background: var(--brand-soft);
}

.t-main {
  flex: 1;
  min-width: 0;
}

.t-title {
  font-weight: 600;
  line-height: 1.3;
  color: var(--text);
}

.t-detail {
  margin-top: 2px;
  font-size: var(--text-sm);
  line-height: 1.35;
  color: var(--text-3);
}

.t-act {
  flex: none;
}

.calm {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: var(--s-4) var(--s-5) var(--s-5);
  border-top: 1px solid var(--border-subtle);
}

.calm-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 42px;
  height: 42px;
  font-size: 24px;
  color: var(--success);
  background: var(--success-soft);
  border-radius: var(--r-full);
}

.calm-t {
  font-weight: 650;
}

.calm-s {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

@container today (max-width: 600px) {
  .today-h {
    padding: var(--s-4) var(--s-4) var(--s-3);
  }

  .task {
    padding: 14px var(--s-4);
  }
}
</style>
