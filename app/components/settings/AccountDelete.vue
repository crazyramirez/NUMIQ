<script setup lang="ts">
/**
 * Eliminar la cuenta: muestra qué empresas se borran (y quién pierde el acceso) y de cuáles solo sales,
 * ofrece la copia de seguridad de cada una y pide la contraseña y escribir ELIMINAR.
 */
type Role = 'owner' | 'admin' | 'member' | 'advisor'
interface Removed {
  id: number
  name: string
  role: Role
  others: Array<{ name: string, role: Role }>
  counts: { documents: number, expenses: number, contacts: number, bank: number, files: number }
  lastBackup: string | null
}
interface Plan {
  remove: Removed[]
  leave: Array<{ id: number, name: string, role: Role }>
}

const toast = useToast()
const { me } = useMe()
const { clear } = useUserSession()

const open = ref(false)
const plan = ref<Plan | null>(null)
const loadError = ref<string | null>(null)
const form = reactive({ password: '', confirm: '' })
const errors = reactive<Record<string, string | null>>({ password: null, confirm: null })
const deleting = ref(false)
const saving = ref<number | null>(null)

const ROLE: Record<Role, string> = { owner: 'Propietario', admin: 'Administrador', member: 'Equipo', advisor: 'Gestor' }
const ready = computed(() => !!plan.value && !!form.password && form.confirm.trim().toUpperCase() === 'ELIMINAR')

function summary(c: Removed['counts']) {
  const n = (v: number, one: string, many: string) => (v ? `${v} ${v === 1 ? one : many}` : null)
  const parts = [n(c.documents, 'factura o presupuesto', 'facturas y presupuestos'), n(c.expenses, 'gasto', 'gastos'), n(c.contacts, 'contacto', 'contactos'), n(c.bank, 'movimiento', 'movimientos'), n(c.files, 'documento', 'documentos')].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Sin datos todavía'
}

async function start() {
  open.value = true
  plan.value = null
  loadError.value = null
  form.password = ''
  form.confirm = ''
  errors.password = errors.confirm = null
  try {
    plan.value = await $fetch<Plan>('/api/me/deletion')
  }
  catch (err) {
    loadError.value = errorMessage(err)
  }
}

async function backup(c: Removed) {
  saving.value = c.id
  try {
    const res = await $fetch.raw<Blob>('/api/backup/download', { query: { company: c.id }, responseType: 'blob' })
    saveDownload(res, 'copia-numiq.zip')
    c.lastBackup = new Date().toISOString()
    toast.success('Copia descargada', `${c.name} · ${fileSize(res._data!.size)}`)
  }
  catch (err) {
    toast.error('No se pudo generar la copia', errorMessage(err))
  }
  finally {
    saving.value = null
  }
}

async function remove() {
  if (!ready.value) return
  errors.password = errors.confirm = null
  deleting.value = true
  try {
    await $fetch('/api/me/deletion', { method: 'POST', body: form })
    // La llave de este dispositivo ya no vale: el login deja de ofrecerla
    markPasskeyOnDevice('')
    await clear()
    me.value = null
    open.value = false
    toast.success('Cuenta eliminada', 'Hemos borrado tu cuenta y sus datos. Hasta pronto.')
    await navigateTo('/login', { replace: true })
  }
  catch (err) {
    const field = errorField(err)
    if (field && field in errors) errors[field] = errorMessage(err)
    else toast.error('No se pudo eliminar la cuenta', errorMessage(err))
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <UiCard title="Eliminar cuenta" icon="ph:warning-octagon" subtitle="Borra tu cuenta y todos sus datos. No se puede deshacer.">
    <div class="intro">
      <p class="muted">Las empresas de las que eres el único propietario se borran con todas sus facturas, gastos, contactos y documentos. De las demás, solo sales.</p>
      <UiButton variant="danger" icon="ph:trash" @click="start">Eliminar mi cuenta…</UiButton>
    </div>
  </UiCard>

  <UiModal v-model="open" size="md" title="Eliminar tu cuenta" subtitle="Se borra para siempre: no se puede deshacer" :persistent="deleting" no-touch-keyboard>
    <div v-if="loadError" class="alert" role="alert"><Icon name="ph:warning-circle-fill" /> {{ loadError }}</div>
    <div v-else-if="!plan" class="loading" aria-busy="true"><Icon name="ph:circle-notch" class="spin" /> Comprobando tus empresas…</div>
    <div v-else class="stack gap-6">
      <section v-if="plan.remove.length" class="stack gap-3">
        <h3 class="h">Se borran con todos sus datos</h3>
        <ul class="list">
          <li v-for="c in plan.remove" :key="c.id" class="co">
            <span class="co-ic bad" aria-hidden="true"><Icon name="ph:buildings" /></span>
            <div class="co-main">
              <b class="co-name">{{ c.name }}</b>
              <span class="small muted">{{ summary(c.counts) }}</span>
              <span v-if="c.others.length" class="small warn">Pierden el acceso: {{ c.others.map(o => `${o.name} (${ROLE[o.role]})`).join(', ') }}</span>
              <span class="small" :class="c.lastBackup ? 'muted' : 'warn'">{{ c.lastBackup ? `Última copia ${relTime(c.lastBackup)}` : 'Sin copia de seguridad' }}</span>
            </div>
            <UiButton size="sm" variant="secondary" icon="ph:download-simple" :loading="saving === c.id" :disabled="deleting" @click="backup(c)">Copia</UiButton>
          </li>
        </ul>
        <p class="note"><Icon name="ph:info" aria-hidden="true" /> Hacienda pide conservar facturas y justificantes al menos 4 años: descarga antes la copia de cada empresa. Si quieres que una siga funcionando, nombra propietario a otra persona en Equipo.</p>
      </section>

      <section v-if="plan.leave.length" class="stack gap-3">
        <h3 class="h">Sales de</h3>
        <ul class="list">
          <li v-for="c in plan.leave" :key="c.id" class="co">
            <span class="co-ic" aria-hidden="true"><Icon name="ph:sign-out" /></span>
            <div class="co-main">
              <b class="co-name">{{ c.name }}</b>
              <span class="small muted">{{ ROLE[c.role] }} · la empresa sigue; lo que hiciste en ella se queda, sin tu nombre</span>
            </div>
          </li>
        </ul>
      </section>

      <p class="small muted">También se borran tu acceso con huella o Face ID, los avisos, tus conversaciones con el asistente y tu clave de OpenAI.</p>

      <form id="delete-account" class="stack gap-3" novalidate @submit.prevent="remove">
        <UiInput v-model="form.password" label="Tu contraseña" type="password" autocomplete="current-password" icon="ph:lock-simple" :error="errors.password" />
        <UiInput v-model="form.confirm" label="Escribe ELIMINAR para confirmar" autocomplete="off" autocapitalize="characters" spellcheck="false" :error="errors.confirm" />
      </form>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="deleting" @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" form="delete-account" variant="danger" icon="ph:trash" :loading="deleting" :disabled="!ready">Eliminar mi cuenta</UiButton>
    </template>
  </UiModal>
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
