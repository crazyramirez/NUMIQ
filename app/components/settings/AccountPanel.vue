<script setup lang="ts">
/** Tu cuenta: nombre, email (confirmado o no) y cambio de contraseña */
const toast = useToast()
const { me, refresh } = useMe()
const { fetch: refreshSession } = useUserSession()

const name = ref(me.value?.user.name ?? '')
const savingName = ref(false)
const pw = ref({ current: '', next: '', repeat: '' })
const pwErrors = ref<Record<string, string | null>>({})
const savingPw = ref(false)
const sending = ref(false)
const verified = computed(() => !!(me.value?.user as { emailVerifiedAt?: string | null } | undefined)?.emailVerifiedAt)

async function saveName() {
  savingName.value = true
  try {
    await $fetch('/api/me', { method: 'PATCH', body: { name: name.value } })
    await Promise.all([refresh(), refreshSession()])
    toast.success('Nombre actualizado')
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    savingName.value = false
  }
}

async function savePassword() {
  pwErrors.value = {}
  if (pw.value.next.length < 8) pwErrors.value.next = 'Mínimo 8 caracteres'
  if (pw.value.next !== pw.value.repeat) pwErrors.value.repeat = 'No coinciden'
  if (Object.keys(pwErrors.value).length) return
  savingPw.value = true
  try {
    await $fetch('/api/me', { method: 'PATCH', body: { currentPassword: pw.value.current, newPassword: pw.value.next } })
    pw.value = { current: '', next: '', repeat: '' }
    toast.success('Contraseña cambiada')
  }
  catch (err) {
    if (errorField(err) === 'currentPassword') pwErrors.value.current = errorMessage(err)
    else toast.error('No se pudo cambiar', errorMessage(err))
  }
  finally {
    savingPw.value = false
  }
}

async function resend() {
  sending.value = true
  try {
    const r = await $fetch<{ alreadyVerified?: boolean }>('/api/auth/verify/send', { method: 'POST' })
    if (r.alreadyVerified) await refresh()
    else toast.success('Te hemos enviado el enlace', `Revisa ${me.value?.user.email}`)
  }
  catch (err) {
    toast.error('No se pudo enviar', errorMessage(err))
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="stack gap-4">
    <UiCard title="Tu cuenta" icon="ph:user-circle">
      <div class="form-grid">
        <UiInput v-model="name" class="c-6" label="Nombre" autocomplete="name" />
        <div class="c-6 email">
          <span class="label">Email</span>
          <div class="em">
            <span class="truncate">{{ me?.user.email }}</span>
            <UiBadge v-if="verified" tone="success" size="sm" icon="ph:seal-check-fill">Confirmado</UiBadge>
            <UiBadge v-else tone="warning" size="sm">Sin confirmar</UiBadge>
          </div>
          <button v-if="!verified" type="button" class="link small" :disabled="sending" @click="resend">{{ sending ? 'Enviando…' : 'Enviarme el enlace de confirmación' }}</button>
        </div>
      </div>
      <div class="act">
        <UiButton variant="primary" icon="ph:check-bold" :loading="savingName" :disabled="!name.trim() || name.trim() === me?.user.name" @click="saveName">Guardar</UiButton>
      </div>
    </UiCard>

    <SettingsPasskeysPanel />

    <SettingsPushPanel />

    <UiCard title="Contraseña" icon="ph:lock-key" subtitle="Usa al menos 8 caracteres; mejor una frase larga.">
      <form class="form-grid" novalidate @submit.prevent="savePassword">
        <UiInput v-model="pw.current" class="c-4" label="Contraseña actual" type="password" autocomplete="current-password" :error="pwErrors.current" />
        <UiInput v-model="pw.next" class="c-4" label="Nueva" type="password" autocomplete="new-password" :error="pwErrors.next" />
        <UiInput v-model="pw.repeat" class="c-4" label="Repite la nueva" type="password" autocomplete="new-password" :error="pwErrors.repeat" />
        <div class="c-12 act">
          <UiButton type="submit" variant="primary" icon="ph:lock-key" :loading="savingPw" :disabled="!pw.current || !pw.next">Cambiar contraseña</UiButton>
        </div>
      </form>
    </UiCard>
  </div>
</template>

<style scoped>
.email {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.em {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-height: 38px;
  padding: 0 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}

.small {
  align-self: flex-start;
  font-size: var(--text-sm);
}

.act {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--s-4);
}

.form-grid .c-12 {
  grid-column: span 12;
}

.form-grid .act {
  margin-top: 0;
}
</style>
