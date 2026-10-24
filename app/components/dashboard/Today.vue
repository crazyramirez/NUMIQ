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
  action: { label: string, to?: string, kind?: 'remind' }
  secondary?: { label: string, to: string }
}

defineProps<{ tasks: Task[], readOnly?: boolean }>()
const emit = defineEmits<{ done: [] }>()

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const toast = useToast()
const { confirm } = useConfirm()
const busy = ref<string | null>(null)

// Recordar a todos los vencidos: primero cuántos saldrían, luego confirmar
async function remindAll() {
  busy.value = 'overdue'
  try {
    const plan = await $fetch<{ count: number, amount: number, noEmail: number, recent: number }>('/api/reminders/overdue')
    if (!plan.count) {
      toast.info('Nada que recordar ahora', plan.recent ? 'A las vencidas ya les llegó un aviso hace menos de 4 días.' : 'Las facturas vencidas no tienen email del cliente.')
      return
    }
    const left = [
      plan.recent ? `${plural(plan.recent, 'ya recibió', 'ya recibieron')} un aviso hace menos de 4 días` : null,
      plan.noEmail ? `${plural(plan.noEmail, 'no tiene', 'no tienen')} email del cliente` : null,
    ].filter(Boolean)
    const ok = await confirm({
      title: `¿Enviar ${plural(plan.count, 'recordatorio', 'recordatorios')} de pago?`,
      body: `Cada cliente recibirá un email amable con su factura adjunta: ${eur(plan.amount)} en total.${left.length ? `\n\nSe quedan fuera: ${left.join(' y ')}.` : ''}`,
      confirmLabel: plan.count === 1 ? 'Enviar recordatorio' : 'Enviar recordatorios',
    })
    if (!ok) return
    const r = await $fetch<{ sent: number, failed: number }>('/api/reminders/overdue', { method: 'POST' })
    if (r.sent) toast.success(`${plural(r.sent, 'recordatorio enviado', 'recordatorios enviados')}`, r.failed ? `${r.failed} no se ${r.failed === 1 ? 'pudo' : 'pudieron'} enviar.` : 'Te avisamos en Inicio cuando cobres.')
    else toast.error('No se pudo enviar ningún recordatorio', 'Revisa el correo en Ajustes y vuelve a intentarlo.')
    emit('done')
  }
  catch (err) {
    toast.error('No se pudieron enviar los recordatorios', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

function run(t: Task) {
  if (t.action.kind === 'remind') remindAll()
  else if (t.action.to) navigateTo(t.action.to)
}
</script>

<template>
  <UiCard class="today" padding="none">
    <header class="today-h">
      <div>
        <h2 class="today-t">Hoy</h2>
        <p class="today-s">{{ tasks.length ? `${plural(tasks.length, 'cosa', 'cosas')} por hacer, de más a menos urgente` : 'Nada urgente' }}</p>
      </div>
      <span v-if="tasks.length" class="today-n num" aria-hidden="true">{{ tasks.length }}</span>
    </header>

    <ul v-if="tasks.length" class="tasks">
      <li v-for="t in tasks" :key="t.key" class="task" :class="[t.tone, { wide: t.action.kind === 'remind' }]">
        <span class="t-ic" aria-hidden="true"><Icon :name="t.icon" /></span>
        <div class="t-main">
          <p class="t-title">{{ t.title }}</p>
          <p v-if="t.detail" class="t-detail">{{ t.detail }}</p>
        </div>
        <div class="t-acts">
          <UiButton v-if="t.secondary" size="sm" variant="ghost" :to="t.secondary.to">{{ t.secondary.label }}</UiButton>
          <UiButton
            v-if="!(readOnly && t.action.kind === 'remind')"
            size="sm"
            :variant="t.tone === 'danger' ? 'primary' : 'secondary'"
            :icon="t.action.kind === 'remind' ? 'ph:paper-plane-tilt' : undefined"
            :icon-right="t.action.kind === 'remind' ? undefined : 'ph:arrow-right'"
            :loading="busy === t.key"
            :compact="t.action.kind !== 'remind'"
            @click="run(t)"
          >
            {{ t.action.label }}
          </UiButton>
        </div>
      </li>
    </ul>

    <div v-else class="calm">
      <span class="calm-ic" aria-hidden="true"><Icon name="ph:check-circle-fill" /></span>
      <div>
        <p class="calm-t">Todo al día</p>
        <p class="calm-s">Sin vencidas, sin borradores y con el banco revisado. Buen momento para facturar.</p>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

.task:nth-child(odd) {
  border-right: 1px solid var(--border-subtle);
}

.task:last-child,
.task:nth-last-child(2):nth-child(odd) {
  border-bottom: 0;
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

.t-acts {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
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

@media (max-width: 1100px) {
  .tasks {
    grid-template-columns: minmax(0, 1fr);
  }

  .task:nth-child(odd) {
    border-right: 0;
  }

  .task:nth-last-child(2):nth-child(odd) {
    border-bottom: 1px solid var(--border-subtle);
  }
}

/* Móvil: el botón baja debajo del texto, a todo el ancho de la columna */
@media (max-width: 640px) {
  .today-h {
    padding: var(--s-4) var(--s-4) var(--s-3);
  }

  .task {
    padding: 14px var(--s-4);
  }

  /* Las tareas de enlace se quedan en una línea con su flecha; «Recordar a todos» lleva sus botones debajo */
  .task.wide {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .task.wide .t-main {
    flex-basis: calc(100% - 50px);
  }

  .task.wide .t-acts {
    width: 100%;
    justify-content: flex-end;
    padding-left: 50px;
  }
}
</style>
