<script setup lang="ts">
/**
 * Eliminar la empresa activa (solo ella): lo que se borra, quién pierde el acceso y su copia de
 * seguridad; pide la contraseña y escribir ELIMINAR. La cuenta y las demás empresas siguen igual.
 */
type Role = 'owner' | 'admin' | 'member' | 'advisor'
interface Plan {
  id: number
  name: string
  others: Array<{ name: string, role: Role }>
  counts: { documents: number, expenses: number, contacts: number, bank: number, files: number }
  lastBackup: string | null
}

const toast = useToast()
const { me, refresh } = useMe()

const open = ref(false)
const plan = ref<Plan | null>(null)
const loadError = ref<string | null>(null)
const form = reactive({ password: '', confirm: '' })
const errors = reactive<Record<string, string | null>>({ password: null, confirm: null })
const deleting = ref(false)
const saving = ref(false)

const ROLE: Record<Role, string> = { owner: 'Propietario', admin: 'Administrador', member: 'Equipo', advisor: 'Gestor' }
const company = computed(() => me.value?.company ?? null)
const name = computed(() => company.value?.tradeName || company.value?.legalName || '')
/** Las otras empresas de la cuenta, que no se tocan */
const rest = computed(() => (me.value?.companies ?? []).filter(c => c.id !== company.value?.id))
const ready = computed(() => !!plan.value && !!form.password && form.confirm.trim().toUpperCase() === 'ELIMINAR')

function summary(c: Plan['counts']) {
  const n = (v: number, one: string, many: string) => (v ? `${v} ${v === 1 ? one : many}` : null)
  const parts = [n(c.documents, 'factura o presupuesto', 'facturas y presupuestos'), n(c.expenses, 'gasto', 'gastos'), n(c.contacts, 'contacto', 'contactos'), n(c.bank, 'movimiento', 'movimientos'), n(c.files, 'documento', 'documentos')].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Sin datos todavía'
}

async function start() {
  if (!company.value) return
  open.value = true
  plan.value = null
  loadError.value = null
  form.password = ''
  form.confirm = ''
  errors.password = errors.confirm = null
  try {
    plan.value = await $fetch<Plan>(`/api/companies/${company.value.id}/deletion`)
  }
  catch (err) {
    loadError.value = errorMessage(err)
  }
}

async function backup() {
  if (!plan.value) return
  saving.value = true
  try {
    const res = await $fetch.raw<Blob>('/api/backup/download', { query: { company: plan.value.id }, responseType: 'blob' })
    saveDownload(res, 'copia-numiq.zip')
    plan.value.lastBackup = new Date().toISOString()
    toast.success('Copia descargada', `${plan.value.name} · ${fileSize(res._data!.size)}`)
  }
  catch (err) {
    toast.error('No se pudo generar la copia', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

async function remove() {
  if (!ready.value || !plan.value) return
  errors.password = errors.confirm = null
  deleting.value = true
  const removed = plan.value.name
  try {
    const res = await $fetch<{ currentCompanyId: number | null }>(`/api/companies/${plan.value.id}/deletion`, { method: 'POST', body: form })
    open.value = false
    toast.success('Empresa eliminada', `Hemos borrado ${removed} y todos sus datos.`)
    if (!res.currentCompanyId) {
      await refresh()
      await navigateTo('/bienvenida', { replace: true })
      return
    }
    // Pasa a otra de sus empresas: recarga limpia de todas las vistas
    reloadNuxtApp({ path: '/' })
  }
  catch (err) {
    const field = errorField(err)
    if (field && field in errors) errors[field] = errorMessage(err)
    else toast.error('No se pudo eliminar la empresa', errorMessage(err))
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div>
    <UiCard title="Eliminar empresa" icon="ph:warning-octagon" subtitle="Borra esta empresa y todos sus datos. No se puede deshacer.">
      <div class="intro">
        <p class="muted">Se borran {{ name }} y todas sus facturas, gastos, contactos, movimientos del banco y documentos. Tu cuenta<template v-if="rest.length"> y tus otras empresas siguen</template><template v-else> sigue</template> igual.</p>
        <UiButton variant="danger" icon="ph:trash" @click="start">Eliminar empresa…</UiButton>
      </div>
    </UiCard>

    <UiModal v-model="open" size="md" :title="`Eliminar ${name}`" subtitle="Se borra para siempre: no se puede deshacer" :persistent="deleting" no-touch-keyboard>
      <div v-if="loadError" class="alert" role="alert"><Icon name="ph:warning-circle-fill" /> {{ loadError }}</div>
      <div v-else-if="!plan" class="loading" aria-busy="true"><Icon name="ph:circle-notch" class="spin" /> Comprobando la empresa…</div>
      <div v-else class="stack gap-6">
        <section class="stack gap-3">
          <h3 class="h">Se borra con todos sus datos</h3>
          <div class="co">
            <span class="co-ic bad" aria-hidden="true"><Icon name="ph:buildings" /></span>
            <div class="co-main">
              <b class="co-name">{{ plan.name }}</b>
              <span class="small muted">{{ summary(plan.counts) }}</span>
              <span v-if="plan.others.length" class="small warn">Pierden el acceso: {{ plan.others.map(o => `${o.name} (${ROLE[o.role]})`).join(', ') }}</span>
              <span class="small" :class="plan.lastBackup ? 'muted' : 'warn'">{{ plan.lastBackup ? `Última copia ${relTime(plan.lastBackup)}` : 'Sin copia de seguridad' }}</span>
            </div>
            <UiButton size="sm" variant="secondary" icon="ph:download-simple" :loading="saving" :disabled="deleting" @click="backup">Copia</UiButton>
          </div>
          <p class="note"><Icon name="ph:info" aria-hidden="true" /> Hacienda pide conservar facturas y justificantes al menos 4 años: descarga antes la copia de la empresa.</p>
        </section>

        <section v-if="rest.length" class="stack gap-3">
          <h3 class="h">No se tocan</h3>
          <ul class="list">
            <li v-for="c in rest" :key="c.id" class="co">
              <span class="co-ic" aria-hidden="true"><Icon name="ph:check" /></span>
              <div class="co-main">
                <b class="co-name">{{ c.tradeName || c.legalName }}</b>
                <span class="small muted">{{ ROLE[c.role] }} · sigue con todos sus datos</span>
              </div>
            </li>
          </ul>
        </section>
        <p v-else class="small muted">Es tu única empresa: tu cuenta sigue y podrás dar de alta otra al terminar.</p>

        <form id="delete-company" class="stack gap-3" novalidate @submit.prevent="remove">
          <UiInput v-model="form.password" label="Tu contraseña" type="password" autocomplete="current-password" icon="ph:lock-simple" :error="errors.password" />
          <UiInput v-model="form.confirm" label="Escribe ELIMINAR para confirmar" autocomplete="off" autocapitalize="characters" spellcheck="false" :error="errors.confirm" />
        </form>
      </div>

      <template #footer>
        <UiButton variant="ghost" :disabled="deleting" @click="open = false">Cancelar</UiButton>
        <UiButton type="submit" form="delete-company" variant="danger" icon="ph:trash" :loading="deleting" :disabled="!ready">Eliminar empresa</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
}

.intro p {
  max-width: 60ch;
}

@container (max-width: 560px) {
  .intro {
    flex-direction: column;
    align-items: stretch;
  }
}

.h {
  font-size: var(--text-sm);
  font-weight: 650;
  color: var(--text-2);
}

.list {
  display: grid;
  gap: var(--s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.co {
  display: flex;
  align-items: flex-start;
  gap: var(--s-3);
  padding: var(--s-3);
  background: var(--surface-sunken);
  border-radius: var(--r-md);
}

.co-ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  font-size: 17px;
  color: var(--text-3);
  background: var(--surface);
  border-radius: var(--r-sm);
}

.co-ic.bad {
  color: var(--danger);
  background: var(--danger-soft);
}

.co-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.co-name {
  overflow-wrap: anywhere;
}

.small {
  font-size: var(--text-sm);
}

.warn {
  color: var(--warning);
}

.note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--warning-soft);
  border-radius: var(--r-md);
}

.note .iconify {
  flex: none;
  margin-top: 2px;
  color: var(--warning);
}

.spin {
  animation: spin 0.8s linear infinite;
}

.loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--s-5) 0;
  color: var(--text-3);
}

.alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: var(--r-md);
}
</style>
