<script setup lang="ts">
import type { Tone } from '~/utils/labels'

/** Equipo: miembros con su rol, invitaciones (por correo o enlace) y salida de la empresa */
interface Member { userId: number, name: string, email: string, role: Role, joinedAt: string, lastLoginAt: string | null, isYou: boolean }
interface Invite { id: number, email: string, role: Exclude<Role, 'owner'>, expiresAt: string, lastSentAt: string | null, createdAt: string }
type Role = 'owner' | 'admin' | 'member' | 'advisor'

const toast = useToast()
const { confirm } = useConfirm()
const { refresh: refreshMe } = useMe()
const { data, refresh } = await useFetch<{ myRole: Role, canManage: boolean, mail: boolean, members: Member[], invites: Invite[] }>('/api/team')

const ROLES: Record<Role, { label: string, hint: string, tone: Tone, icon: string }> = {
  owner: { label: 'Propietario', hint: 'Control total de la empresa', tone: 'brand', icon: 'ph:crown-simple' },
  admin: { label: 'Administrador', hint: 'Todo, también equipo y ajustes', tone: 'info', icon: 'ph:shield-check' },
  member: { label: 'Equipo', hint: 'Facturas, presupuestos y gastos', tone: 'neutral', icon: 'ph:user' },
  advisor: { label: 'Gestor', hint: 'Consulta datos, informes e impuestos; no emite ni borra', tone: 'ai', icon: 'ph:briefcase' },
}
const roleOptions = (owner: boolean) => (['admin', 'member', 'advisor', ...(owner ? ['owner'] : [])] as Role[]).map(r => ({ value: r, label: ROLES[r].label }))

// ─── Invitar ───
const inviteOpen = ref(false)
const invite = ref({ email: '', role: 'advisor' as Exclude<Role, 'owner'>, send: true })
const inviting = ref(false)
const inviteError = ref<string | null>(null)
const link = ref<string | null>(null)

function openInvite(role: Exclude<Role, 'owner'> = 'advisor') {
  invite.value = { email: '', role, send: !!data.value?.mail }
  inviteError.value = null
  link.value = null
  inviteOpen.value = true
}

async function sendInvite() {
  inviting.value = true
  inviteError.value = null
  try {
    const r = await $fetch<{ link: string, sent: boolean }>('/api/team/invites', { method: 'POST', body: invite.value })
    link.value = r.link
    toast.success(r.sent ? 'Invitación enviada' : 'Invitación creada', r.sent ? `Le llegará a ${invite.value.email}` : 'Copia el enlace y compártelo')
    await refresh()
  }
  catch (err) {
    inviteError.value = errorMessage(err)
  }
  finally {
    inviting.value = false
  }
}

async function copyLink() {
  if (!link.value) return
  const ok = await copyToClipboard(link.value)
  if (ok) toast.success('Enlace copiado')
  else toast.error('No se pudo copiar el enlace')
}

async function resend(i: Invite) {
  try {
    await $fetch(`/api/team/invites/${i.id}/resend`, { method: 'POST' })
    toast.success('Invitación reenviada', i.email)
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo reenviar', errorMessage(err))
  }
}

async function cancel(i: Invite) {
  const ok = await confirm({ title: '¿Anular la invitación?', body: `El enlace enviado a ${i.email} dejará de funcionar.`, confirmLabel: 'Anular', danger: true })
  if (!ok) return
  await $fetch(`/api/team/invites/${i.id}`, { method: 'DELETE' }).catch(err => toast.error('No se pudo anular', errorMessage(err)))
  await refresh()
}

async function changeRole(m: Member, role: Role) {
  if (role === m.role) return
  try {
    await $fetch(`/api/team/members/${m.userId}`, { method: 'PATCH', body: { role } })
    toast.success('Rol actualizado', `${m.name}: ${ROLES[role].label}`)
    await refresh()
    if (m.isYou) await refreshMe()
  }
  catch (err) {
    toast.error('No se pudo cambiar', errorMessage(err))
    await refresh()
  }
}

async function remove(m: Member) {
  const ok = await confirm({
    title: m.isYou ? '¿Salir de la empresa?' : `¿Quitar a ${m.name}?`,
    body: m.isYou ? 'Dejarás de ver sus datos hasta que te vuelvan a invitar.' : 'Dejará de tener acceso a los datos de la empresa.',
    confirmLabel: m.isYou ? 'Salir' : 'Quitar',
    danger: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/team/members/${m.userId}`, { method: 'DELETE' })
    if (m.isYou) {
      await refreshMe()
      return navigateTo('/')
    }
    toast.success('Acceso retirado')
    await refresh()
  }
  catch (err) {
    toast.error('No se pudo', errorMessage(err))
  }
}
</script>

<template>
  <div v-if="data" class="stack gap-4">
    <UiCard padding="none">
      <template #head>
        <div class="t-head">
          <div>
            <h2 class="section-title">Equipo</h2>
            <p class="muted small">Quién puede entrar en esta empresa y qué puede hacer.</p>
          </div>
          <UiButton v-if="data.canManage" variant="primary" icon="ph:user-plus" @click="openInvite()">Invitar</UiButton>
        </div>
      </template>

      <ul class="members">
        <li v-for="m in data.members" :key="m.userId" class="member">
          <UiAvatar :name="m.name" :size="36" />
          <div class="grow min0">
            <p class="m-name truncate">{{ m.name }} <span v-if="m.isYou" class="you">(tú)</span></p>
            <p class="m-sub truncate">{{ m.email }} · {{ m.lastLoginAt ? `entró ${relTime(m.lastLoginAt)}` : 'aún no ha entrado' }}</p>
          </div>
          <UiSelect
            v-if="data.canManage && !(m.role === 'owner' && data.myRole !== 'owner')"
            :model-value="m.role"
            :options="roleOptions(data.myRole === 'owner')"
            :aria-label="`Rol de ${m.name}`"
            class="role-sel"
            @update:model-value="changeRole(m, $event as Role)"
          />
          <UiBadge v-else :tone="ROLES[m.role].tone" :icon="ROLES[m.role].icon" size="sm">{{ ROLES[m.role].label }}</UiBadge>
          <UiButton
            v-if="m.isYou ? m.role !== 'owner' : data.canManage && m.role !== 'owner'"
            variant="ghost"
            size="sm"
            square
            :icon="m.isYou ? 'ph:sign-out' : 'ph:user-minus'"
            :aria-label="m.isYou ? 'Salir de la empresa' : `Quitar a ${m.name}`"
            @click="remove(m)"
          />
        </li>
      </ul>

      <div v-if="data.invites.length" class="pending">
        <p class="eyebrow">Invitaciones pendientes</p>
        <ul class="members">
          <li v-for="i in data.invites" :key="i.id" class="member">
            <span class="inv-ic" aria-hidden="true"><Icon name="ph:envelope-simple" /></span>
            <div class="grow min0">
              <p class="m-name truncate">{{ i.email }}</p>
              <p class="m-sub">{{ ROLES[i.role].label }} · {{ i.lastSentAt ? `enviada ${relTime(i.lastSentAt)}` : 'enlace creado' }} · caduca {{ relDays(toISODate(new Date(i.expiresAt))) }}</p>
            </div>
            <UiButton v-if="data.mail" variant="ghost" size="sm" icon="ph:paper-plane-tilt" @click="resend(i)">Reenviar</UiButton>
            <UiButton variant="ghost" size="sm" square icon="ph:x" :aria-label="`Anular invitación a ${i.email}`" @click="cancel(i)" />
          </li>
        </ul>
      </div>
    </UiCard>

    <SettingsApprovalsCard :can-edit="data.canManage" />

    <div v-if="data.canManage" class="roles">
      <button v-for="r in (['advisor', 'member', 'admin'] as const)" :key="r" type="button" class="role-card" @click="openInvite(r)">
        <span class="rc-ic" :class="r" aria-hidden="true"><Icon :name="ROLES[r].icon" /></span>
        <span class="rc-t">Invitar {{ r === 'advisor' ? 'a tu gestor' : r === 'admin' ? 'a un administrador' : 'a tu equipo' }}</span>
        <span class="rc-s">{{ ROLES[r].hint }}</span>
      </button>
    </div>

    <UiModal v-model="inviteOpen" size="sm" title="Invitar a la empresa">
      <form v-if="!link" id="invite-form" class="stack gap-4" novalidate @submit.prevent="sendInvite">
        <UiInput v-model="invite.email" label="Email" type="email" placeholder="gestor@asesoria.es" icon="ph:envelope-simple" autocomplete="off" required />
        <div class="field">
          <span class="label">Rol</span>
          <div class="role-pick">
            <label v-for="r in (['advisor', 'member', 'admin'] as const)" :key="r" class="rp" :class="{ on: invite.role === r }">
              <input v-model="invite.role" type="radio" :value="r" class="sr-only">
              <Icon :name="ROLES[r].icon" aria-hidden="true" />
              <span class="grow">
                <span class="rp-t">{{ ROLES[r].label }}</span>
                <span class="rp-s">{{ ROLES[r].hint }}</span>
              </span>
            </label>
          </div>
        </div>
        <UiSwitch v-model="invite.send" :disabled="!data.mail" label="Enviarle la invitación por correo" :hint="data.mail ? 'Si no, te damos el enlace para compartirlo tú' : 'El correo no está configurado: te daremos el enlace'" />
        <p v-if="inviteError" class="err" role="alert">{{ inviteError }}</p>
      </form>
      <div v-else class="done">
        <span class="d-ic" aria-hidden="true"><Icon name="ph:check-circle-fill" /></span>
        <p class="d-t">Invitación lista</p>
        <p class="muted small">Caduca en 14 días. {{ invite.send ? 'Le hemos enviado un correo; también puedes compartir el enlace:' : 'Compártele este enlace:' }}</p>
        <div class="linkbox">
          <code class="truncate">{{ link }}</code>
          <UiButton size="sm" variant="secondary" icon="ph:copy" @click="copyLink">Copiar</UiButton>
        </div>
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="inviteOpen = false">{{ link ? 'Cerrar' : 'Cancelar' }}</UiButton>
        <UiButton v-if="!link" type="submit" form="invite-form" variant="primary" icon="ph:paper-plane-tilt" :loading="inviting" :disabled="!invite.email.includes('@')">{{ invite.send ? 'Enviar invitación' : 'Crear enlace' }}</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.t-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-4);
  width: 100%;
}

.small {
  font-size: var(--text-sm);
}

.min0 {
  min-width: 0;
}

.members {
  list-style: none;
  padding: 0;
}

.member {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 12px var(--s-5);
}

.member + .member {
  border-top: 1px solid var(--border-subtle);
}

.m-name {
  font-weight: 600;
}

.you {
  font-weight: 450;
  color: var(--text-3);
}

.m-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.role-sel {
  width: 170px;
}

.pending {
  padding-top: var(--s-3);
  border-top: 1px solid var(--border);
}

.pending .eyebrow {
  padding: 0 var(--s-5);
}

.inv-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  color: var(--text-3);
  background: var(--surface-sunken);
  border-radius: var(--r-full);
}

.roles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-3);
}

.role-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: var(--s-4);
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), transform var(--t-fast) var(--ease-out), box-shadow var(--t-fast);
}

.role-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.rc-ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-bottom: 6px;
  font-size: 17px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-md);
}

.rc-ic.advisor {
  color: #fff;
  background: var(--ai-grad);
}

.rc-t {
  font-weight: 600;
}

.rc-s {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.role-pick {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rp {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 10px 12px;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.rp.on {
  border-color: var(--brand);
  background: color-mix(in srgb, var(--brand) 6%, var(--surface));
}

.rp:has(:focus-visible) {
  box-shadow: var(--focus-ring);
}

.rp-t {
  display: block;
  font-weight: 600;
  font-size: var(--text-sm);
}

.rp-s {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.err {
  font-size: var(--text-sm);
  color: var(--danger);
}

.done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.d-ic {
  font-size: 40px;
  color: var(--success);
}

.d-t {
  font-size: var(--text-lg);
  font-weight: 650;
}

.linkbox {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  width: 100%;
  margin-top: var(--s-3);
  padding: 6px 6px 6px 12px;
  text-align: left;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}

.linkbox code {
  flex: 1;
  font-size: var(--text-xs);
}

@media (max-width: 720px) {
  .roles {
    grid-template-columns: minmax(0, 1fr);
  }

  .member {
    flex-wrap: wrap;
    padding: 12px var(--s-4);
  }

  .role-sel {
    width: 100%;
    order: 3;
  }
}
</style>
