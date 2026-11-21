<script setup lang="ts">
/**
 * NUMIQ de escritorio: la cuenta desde la que salen facturas, presupuestos, recordatorios y envíos al
 * gestor. En un servidor va en el .env; aquí se elige en la app y la contraseña se guarda cifrada.
 */
interface MailSettings { configured: boolean, user: string, smtpHost: string, smtpPort: number, fromName: string, hasPassword: boolean }

const toast = useToast()
const { confirm } = useConfirm()
const { bridge } = useDesktop()

const form = ref({ user: '', password: '', smtpHost: 'smtp.gmail.com', smtpPort: 465, fromName: '' })
const original = ref('')
const state = ref<MailSettings | null>(null)
const errors = ref<Record<string, string>>({})
const saving = ref(false)
const loading = ref(true)
const advanced = ref(false)
const check = ref<{ ok: boolean, error?: string } | null>(null)

const PRESETS = [
  { value: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 465 },
  { value: 'outlook', label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587 },
  { value: 'other', label: 'Otro', host: '', port: 465 },
]
const preset = computed(() => PRESETS.find(p => p.host && p.host === form.value.smtpHost)?.value ?? 'other')
function choose(v: string) {
  const p = PRESETS.find(x => x.value === v)
  if (!p) return
  if (p.host) {
    form.value.smtpHost = p.host
    form.value.smtpPort = p.port
  }
  advanced.value = v === 'other'
}

async function load() {
  loading.value = true
  try {
    const r = await $fetch<MailSettings>('/api/desktop/mail')
    state.value = r
    form.value = { user: r.user, password: '', smtpHost: r.smtpHost, smtpPort: r.smtpPort, fromName: r.fromName }
    advanced.value = preset.value === 'other'
  }
  catch (err) {
    toast.error('No se pudo cargar el correo', errorMessage(err))
  }
  finally {
    original.value = JSON.stringify(form.value)
    loading.value = false
  }
}
onMounted(load)

const dirty = computed(() => JSON.stringify(form.value) !== original.value)
const needsPassword = computed(() => !!form.value.user.trim() && (!state.value?.hasPassword || state.value.user !== form.value.user.trim()))

async function save() {
  errors.value = {}
  saving.value = true
  check.value = null
  try {
    const r = await $fetch<{ configured: boolean, check: { ok: boolean, error?: string } | null }>('/api/desktop/mail', { method: 'PUT', body: form.value })
    check.value = r.check
    await load()
    if (!r.configured) toast.info('Correo quitado', 'Ya no se enviarán correos desde NUMIQ')
    else if (r.check?.ok) toast.success('Correo listo', 'Las facturas saldrán desde esta cuenta')
    else toast.error('Guardado, pero no conecta', r.check?.error ?? 'Revisa el email y la contraseña')
  }
  catch (err) {
    const field = errorField(err)
    if (field) errors.value[field] = errorMessage(err)
    else toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

async function test() {
  saving.value = true
  try {
    const r = await $fetch<{ configured: boolean, check: { ok: boolean, error?: string } | null }>('/api/mail/status', { query: { verify: 1 } })
    check.value = r.check
    if (r.check?.ok) toast.success('Conexión correcta')
    else toast.error('No conecta', r.check?.error ?? 'Revisa la cuenta')
  }
  catch (err) {
    toast.error('No se pudo probar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

async function remove() {
  const ok = await confirm({ title: '¿Quitar la cuenta de correo?', body: 'NUMIQ dejará de enviar facturas, recordatorios y envíos al gestor hasta que añadas otra.', confirmLabel: 'Quitar', danger: true })
  if (!ok) return
  form.value = { user: '', password: '', smtpHost: 'smtp.gmail.com', smtpPort: 465, fromName: '' }
  await save()
}
</script>

<template>
  <div class="stack gap-4">
    <UiCard title="Correo de envío" icon="ph:envelope-simple" subtitle="La cuenta desde la que salen tus facturas, presupuestos, recordatorios de cobro y envíos al gestor. Los clientes te responden a ella.">
      <div v-if="loading" class="stack gap-3">
        <div v-for="i in 3" :key="i" class="skeleton" style="height: 40px" />
      </div>
      <form v-else class="stack gap-4" novalidate @submit.prevent="save">
        <div class="status" :class="{ on: state?.configured }">
          <Icon :name="state?.configured ? 'ph:check-circle-fill' : 'ph:envelope-simple-open'" aria-hidden="true" />
          <span v-if="state?.configured">Enviando desde <b>{{ state.user }}</b></span>
          <span v-else>Sin cuenta: NUMIQ no puede enviar correos todavía</span>
        </div>

        <UiSegmented :model-value="preset" :options="PRESETS.map(p => ({ value: p.value, label: p.label }))" label="Proveedor" @update:model-value="choose" />

        <div class="form-grid">
          <UiInput v-model="form.user" class="c-6" label="Email" type="email" placeholder="tu@gmail.com" icon="ph:at" autocomplete="off" :error="errors.user" />
          <UiInput
            v-model="form.password"
            class="c-6"
            :label="preset === 'gmail' ? 'Contraseña de aplicación' : 'Contraseña'"
            type="password"
            autocomplete="new-password"
            icon="ph:key"
            :placeholder="state?.hasPassword && !needsPassword ? '•••••••• (guardada)' : ''"
            :hint="state?.hasPassword && !needsPassword ? 'Déjala vacía para mantener la guardada' : undefined"
            :error="errors.password"
          />
          <UiInput v-model="form.fromName" class="c-12" label="Nombre del remitente (opcional)" placeholder="Si lo dejas vacío, cada correo sale con el nombre de la empresa" :error="errors.fromName" />
          <template v-if="advanced">
            <UiInput v-model="form.smtpHost" class="c-8" label="Servidor SMTP" placeholder="smtp.tudominio.es" :error="errors.smtpHost" />
            <UiInput v-model.number="form.smtpPort" class="c-4" label="Puerto" type="number" hint="465 (SSL) o 587 (STARTTLS)" :error="errors.smtpPort" />
          </template>
        </div>

        <p v-if="preset === 'gmail'" class="note">
          <Icon name="ph:info" aria-hidden="true" />
          <span>Gmail pide una contraseña de aplicación, no la tuya: activa la verificación en 2 pasos y créala en
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener" class="link">myaccount.google.com/apppasswords</a>. Los espacios dan igual.</span>
        </p>
        <p v-if="check && !check.ok" class="note warn"><Icon name="ph:warning-circle" aria-hidden="true" /><span>{{ check.error }}</span></p>

        <div class="actions">
          <UiButton v-if="state?.configured" variant="ghost" icon="ph:trash" :disabled="saving" @click="remove">Quitar</UiButton>
          <UiButton v-if="state?.configured && !dirty" icon="ph:plugs-connected" :loading="saving" @click="test">Probar conexión</UiButton>
          <UiButton type="submit" variant="primary" icon="ph:check-bold" :loading="saving" :disabled="!dirty || !form.user.trim() || (needsPassword && !form.password.trim())">Guardar y probar</UiButton>
        </div>
      </form>
    </UiCard>

    <UiCard v-if="bridge" title="Tus datos en este equipo" icon="ph:hard-drives" subtitle="La base de datos, los archivos subidos y los registros viven en una carpeta de tu usuario. Para llevarlos a otro equipo, usa Ajustes → Copia de seguridad.">
      <div class="actions start">
        <UiButton icon="ph:folder-open" @click="bridge.openDataFolder()">Abrir la carpeta de datos</UiButton>
        <UiButton variant="ghost" icon="ph:file-text" @click="bridge.openLogs()">Ver registros</UiButton>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--surface-2);
  border-radius: var(--r-md);
}

.status :deep(svg) {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--text-3);
}

.status.on {
  color: var(--success);
  background: var(--success-soft);
}

.status.on :deep(svg) {
  color: var(--success);
}

.form-grid .c-12 {
  grid-column: span 12;
}

.note {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--surface-2);
  border-radius: var(--r-md);
}

.note :deep(svg) {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  color: var(--text-3);
}

.note.warn {
  color: var(--warning);
  background: var(--warning-soft);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--s-2);
}

.actions.start {
  justify-content: flex-start;
}
</style>
