<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Invitación · NUMIQ' })

interface Invite {
  company: string
  inviter: string | null
  email: string
  role: string
  roleLabel: string
  expired: boolean
  accepted: boolean
  hasAccount: boolean
}

const route = useRoute()
const { loggedIn, user, clear } = useUserSession()
const { refresh: refreshMe } = useMe()
const token = typeof route.query.token === 'string' ? route.query.token : ''
const { data: invite, error } = await useFetch<Invite>(`/api/invites/${token}`, { immediate: !!token })

const mine = computed(() => !!invite.value && loggedIn.value && user.value?.email?.toLowerCase() === invite.value.email.toLowerCase())
const here = computed(() => `/invitacion?token=${token}`)
const accepting = ref(false)
const failure = ref<string | null>(null)

async function accept() {
  accepting.value = true
  failure.value = null
  try {
    await $fetch(`/api/invites/${token}/accept`, { method: 'POST' })
    await refreshMe()
    useToast().success(`Ya formas parte de ${invite.value?.company}`)
    await navigateTo('/')
  }
  catch (err) {
    failure.value = errorMessage(err)
  }
  finally {
    accepting.value = false
  }
}

async function switchAccount() {
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  await clear()
  await navigateTo({ path: '/login', query: { r: here.value, email: invite.value?.email } })
}

const ROLE_HINT: Record<string, string> = {
  advisor: 'Podrás consultar facturas, gastos, informes e impuestos y descargar la documentación.',
  admin: 'Podrás gestionarlo todo, también el equipo y los ajustes.',
  member: 'Podrás crear facturas, presupuestos y gastos.',
}
</script>

<template>
  <div class="rise inv">
    <template v-if="!token || error || !invite">
      <span class="ic bad" aria-hidden="true"><Icon name="ph:link-break" /></span>
      <h1 class="title">Invitación no válida</h1>
      <p class="lead">El enlace no existe o se ha anulado. Pide a quien te invitó que te envíe otro.</p>
      <UiButton class="go" variant="secondary" size="lg" block to="/login">Ir a NUMIQ</UiButton>
    </template>

    <template v-else>
      <span class="ic" aria-hidden="true"><Icon name="ph:users-three-fill" /></span>
      <p class="eyebrow">Invitación</p>
      <h1 class="title">Únete a {{ invite.company }}</h1>
      <p class="lead">{{ invite.inviter ? `${invite.inviter} te invita` : 'Te han invitado' }} como <b>{{ invite.roleLabel }}</b>. {{ ROLE_HINT[invite.role] }}</p>
      <p class="for"><Icon name="ph:envelope-simple" aria-hidden="true" /> Para {{ invite.email }}</p>

      <p v-if="invite.accepted" class="alert ok"><Icon name="ph:check-circle-fill" /> Esta invitación ya se aceptó.</p>
      <p v-else-if="invite.expired" class="alert"><Icon name="ph:clock-countdown" /> La invitación ha caducado: pide una nueva.</p>

      <div v-else class="actions">
        <template v-if="loggedIn">
          <UiButton v-if="mine" variant="primary" size="lg" block icon="ph:check" :loading="accepting" @click="accept">Aceptar y entrar</UiButton>
          <template v-else>
            <p class="alert">Has entrado como {{ user?.email }}. La invitación es para {{ invite.email }}.</p>
            <UiButton variant="primary" size="lg" block @click="switchAccount">Entrar con {{ invite.email }}</UiButton>
          </template>
        </template>
        <template v-else>
          <UiButton v-if="invite.hasAccount" variant="primary" size="lg" block :to="`/login?r=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`">Entrar para aceptar</UiButton>
          <UiButton v-else variant="primary" size="lg" block :to="`/registro?invitacion=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}`">Crear mi cuenta y aceptar</UiButton>
        </template>
        <p v-if="failure" class="alert" role="alert"><Icon name="ph:warning-circle-fill" /> {{ failure }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ic {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--s-5);
  font-size: 28px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-xl);
}

.ic.bad {
  color: var(--danger);
  background: var(--danger-soft);
}

.title {
  margin-top: 4px;
  font-size: var(--text-3xl);
  letter-spacing: -0.03em;
}

.lead {
  margin-top: var(--s-2);
  color: var(--text-3);
  font-size: var(--text-md);
}

.lead b {
  color: var(--text);
}

.for {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-4);
  padding: 6px 12px;
  font-size: var(--text-sm);
  font-weight: 560;
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.actions {
  display: grid;
  gap: var(--s-3);
  margin-top: var(--s-7);
}

.go {
  margin-top: var(--s-7);
}

.alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--s-4);
  padding: 10px 12px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: var(--r-md);
}

.alert.ok {
  color: var(--success);
  background: var(--success-soft);
}

.actions .alert {
  margin-top: 0;
}
</style>
