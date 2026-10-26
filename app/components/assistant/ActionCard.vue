<script setup lang="ts">
import type { AiActionStatus, AiActionView } from '#shared/types/assistant'
import type { Tone } from '~/utils/labels'

/**
 * Tarjeta de una operación del asistente: qué registros cambia y cómo, con Confirmar y Cancelar.
 * Una vez hecha, muestra el resultado y permite deshacerla.
 */
const props = defineProps<{ action: AiActionView }>()
const emit = defineEmits<{ update: [action: AiActionView] }>()
const toast = useToast()
// El gestor solo consulta: no confirma ni deshace cambios en la empresa
const { readOnly } = useMe()

const VISIBLE = 5
const busy = ref<'confirm' | 'cancel' | 'undo' | null>(null)
const expanded = ref(false)
const showSkipped = ref(false)

const a = computed(() => props.action)
const rows = computed(() => (expanded.value ? a.value.preview.rows : a.value.preview.rows.slice(0, VISIBLE)))
const extra = computed(() => a.value.preview.count - a.value.preview.rows.length)

const STATUS: Record<AiActionStatus, { label: string, tone: Tone, icon: string }> = {
  pending: { label: 'Por confirmar', tone: 'warning', icon: 'ph:hand-pointing' },
  running: { label: 'Aplicando', tone: 'info', icon: 'ph:circle-notch' },
  done: { label: 'Hecho', tone: 'success', icon: 'ph:check-circle-fill' },
  failed: { label: 'No se pudo', tone: 'danger', icon: 'ph:warning-circle-fill' },
  cancelled: { label: 'Cancelada', tone: 'neutral', icon: 'ph:x-circle' },
  expired: { label: 'Caducada', tone: 'neutral', icon: 'ph:clock-countdown' },
  undoing: { label: 'Deshaciendo', tone: 'info', icon: 'ph:circle-notch' },
  undone: { label: 'Deshecha', tone: 'neutral', icon: 'ph:arrow-counter-clockwise' },
}
const status = computed(() => STATUS[a.value.status])

const isEmail = computed(() => a.value.kind === 'ventas.enviar')
const showMessage = ref(false)

const icon = computed(() => {
  const k = a.value.kind
  if (isEmail.value) return 'ph:envelope-simple'
  if (k.endsWith('.eliminar')) return 'ph:trash'
  if (k.endsWith('.crear')) return 'ph:plus'
  if (k.startsWith('banco.')) return 'ph:bank'
  if (k.startsWith('gastos.')) return 'ph:receipt'
  if (k.startsWith('contactos.')) return 'ph:address-book'
  if (k.startsWith('productos.')) return 'ph:package'
  return 'ph:files'
})

const skipped = computed(() => (a.value.status === 'undone' ? a.value.result?.reverted?.skipped : a.value.result?.skipped) ?? [])
const outcome = computed(() => {
  const r = a.value.result
  if (a.value.status === 'done' && r) {
    if (!r.done) return isEmail.value ? 'No se ha enviado nada.' : 'No se ha cambiado nada.'
    const of = a.value.preview.count > 1 ? `${r.done} de ${a.value.preview.count}` : ''
    if (isEmail.value) return of ? `Enviados ${of}.` : 'Enviado.'
    return of ? `Aplicado a ${of}.` : 'Aplicado.'
  }
  if (a.value.status === 'undone') return 'Deshecha: todo ha vuelto a como estaba.'
  if (a.value.status === 'cancelled') return a.value.error ? `${a.value.error}: no se ha cambiado nada.` : 'Cancelada: no se ha cambiado nada.'
  if (a.value.status === 'expired') return 'Caducó sin confirmar: pídemelo de nuevo si lo necesitas.'
  if (a.value.status === 'failed') return a.value.error ?? 'No se pudo completar.'
  return null
})
const note = computed(() => (a.value.status === 'undone' ? a.value.result?.reverted?.message : a.value.result?.message) ?? null)

async function call(op: 'confirm' | 'cancel' | 'undo') {
  if (busy.value) return
  busy.value = op
  const url: string = `/api/assistant/actions/${a.value.id}/${op}`
  try {
    const res = await $fetch<{ action: AiActionView }>(url, { method: 'POST' })
    emit('update', res.action)
    if (op === 'undo' && res.action.status === 'undone') toast.success('Operación deshecha')
  }
  catch (err) {
    const msg = errorMessage(err)
    toast.error(op === 'undo' ? 'No se pudo deshacer' : 'No se pudo aplicar', msg)
    if (/caducad/i.test(msg)) emit('update', { ...a.value, status: 'expired' })
  }
  finally {
    busy.value = null
  }
}
</script>

<template>
  <section class="ac" :class="[`is-${a.status}`, { danger: a.risk === 'high' }]" :aria-label="a.title">
    <header class="ac-head">
      <span class="ac-ic" aria-hidden="true"><Icon :name="icon" /></span>
      <div class="ac-tt">
        <p class="ac-title">{{ a.title }}</p>
        <p v-if="a.preview.change" class="ac-change">{{ a.preview.change }}</p>
        <p v-if="a.preview.scope" class="ac-scope">{{ a.preview.scope }}</p>
      </div>
      <UiBadge class="ac-badge" :tone="status.tone" size="sm" :icon="status.icon">{{ status.label }}</UiBadge>
    </header>

    <ul v-if="rows.length" class="ac-list" :class="{ open: expanded }">
      <li v-for="r in rows" :key="r.id" class="ac-r">
        <div class="ac-main">
          <NuxtLink v-if="r.url" :to="r.url" class="ac-label">{{ r.label }}</NuxtLink>
          <span v-else class="ac-label">{{ r.label }}</span>
          <span v-if="r.sub" class="ac-sub">{{ r.sub }}</span>
        </div>
        <div v-if="r.before || r.after || r.amount != null" class="ac-meta">
          <span v-if="r.before || r.after" class="ac-diff">
            <span v-if="r.before" class="ac-before">{{ r.before }}</span>
            <Icon v-if="r.before && r.after" name="ph:arrow-right" class="ac-arrow" aria-label="pasa a" />
            <span v-if="r.after" class="ac-after">{{ r.after }}</span>
          </span>
          <span v-if="r.amount != null" class="ac-amount num">{{ eur(r.amount) }}</span>
        </div>
      </li>
    </ul>
    <button v-if="a.preview.rows.length > VISIBLE" type="button" class="ac-more" @click="expanded = !expanded">
      <Icon :name="expanded ? 'ph:caret-up' : 'ph:caret-down'" aria-hidden="true" />
      {{ expanded ? 'Ver menos' : `Ver los ${a.preview.count}` }}
    </button>
    <p v-if="expanded && extra > 0" class="ac-hint">Y {{ extra }} más que no caben aquí: también se incluyen.</p>

    <div v-if="a.preview.email" class="ac-mail">
      <p class="ac-mail-subject"><span>Asunto</span>{{ a.preview.email.subject }}</p>
      <p class="ac-mail-body" :class="{ open: showMessage }">{{ showMessage ? a.preview.email.message : a.preview.email.message.replace(/\s*\n\s*/g, ' ') }}</p>
      <div class="ac-mail-foot">
        <span v-for="f in a.preview.email.attachments" :key="f" class="ac-mail-file">
          <Icon :name="f.endsWith('.pdf') ? 'ph:file-pdf' : 'ph:paperclip'" aria-hidden="true" />{{ f }}
        </span>
        <button type="button" class="ac-more ac-mail-toggle" @click="showMessage = !showMessage">
          <Icon :name="showMessage ? 'ph:caret-up' : 'ph:caret-down'" aria-hidden="true" />
          {{ showMessage ? 'Ver menos' : 'Ver el mensaje' }}
        </button>
      </div>
    </div>

    <ul v-if="a.status === 'pending' && a.preview.warnings.length" class="ac-warn">
      <li v-for="w in a.preview.warnings" :key="w"><Icon name="ph:warning-fill" aria-hidden="true" /><span>{{ w }}</span></li>
    </ul>

    <footer class="ac-foot">
      <template v-if="a.status === 'pending'">
        <p class="ac-sum">
          <span v-if="a.preview.total != null" class="num">Total {{ eur(a.preview.total) }}</span>
          <span :class="a.preview.undoable ? 'ac-ok' : 'ac-final'">
            <Icon :name="a.preview.undoable ? 'ph:arrow-counter-clockwise' : 'ph:lock-simple'" aria-hidden="true" />
            {{ a.preview.undoable ? 'Se puede deshacer' : 'No se puede deshacer' }}
          </span>
        </p>
        <div class="ac-btns">
          <UiButton variant="ghost" size="sm" :disabled="!!busy" :loading="busy === 'cancel'" @click="call('cancel')">Cancelar</UiButton>
          <UiButton
            v-if="!readOnly"
            :variant="a.risk === 'high' ? 'danger' : 'primary'"
            size="sm"
            :icon="a.risk === 'high' ? 'ph:trash' : isEmail ? 'ph:paper-plane-tilt' : 'ph:check-bold'"
            :disabled="!!busy"
            :loading="busy === 'confirm'"
            @click="call('confirm')"
          >
            {{ a.risk === 'high' ? 'Sí, eliminar' : isEmail ? 'Enviar' : 'Confirmar' }}
          </UiButton>
        </div>
      </template>
      <template v-else>
        <p class="ac-out" :class="{ bad: a.status === 'failed' }">
          <span v-if="a.status === 'running' || a.status === 'undoing'" class="spin" aria-hidden="true" />
          {{ a.status === 'running' ? 'Aplicando los cambios…' : a.status === 'undoing' ? 'Deshaciendo…' : outcome }}
          <span v-if="note" class="ac-msg">{{ note }}</span>
          <span v-if="a.status === 'done' && a.error" class="ac-msg bad">{{ a.error }}</span>
        </p>
        <div class="ac-btns">
          <UiButton v-if="a.result?.url && a.status === 'done'" variant="ghost" size="sm" :to="a.result.url" icon-right="ph:arrow-right">Ver</UiButton>
          <UiButton v-if="a.canUndo && !readOnly" variant="secondary" size="sm" icon="ph:arrow-counter-clockwise" :loading="busy === 'undo'" :disabled="!!busy" @click="call('undo')">Deshacer</UiButton>
        </div>
      </template>
    </footer>

    <div v-if="skipped.length" class="ac-skip">
      <button type="button" class="ac-more" @click="showSkipped = !showSkipped">
        <Icon :name="showSkipped ? 'ph:caret-up' : 'ph:caret-down'" aria-hidden="true" />
        {{ skipped.length === 1 ? `1 no se pudo ${isEmail ? 'enviar' : 'cambiar'}` : `${skipped.length} no se pudieron ${isEmail ? 'enviar' : 'cambiar'}` }}
      </button>
      <ul v-if="showSkipped" class="ac-skip-list">
        <li v-for="s in skipped" :key="s.id"><strong>{{ s.label }}</strong> · {{ s.reason }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.ac {
  --accent: var(--ai-2);
  margin: 4px 0 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}

.ac.is-pending {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 9%, transparent), var(--shadow-xs);
}

.ac.danger {
  --accent: var(--danger);
}

.ac.is-cancelled,
.ac.is-expired,
.ac.is-undone {
  opacity: 0.78;
}

.ac-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px 12px;
}

.ac-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  font-size: 17px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 11%, transparent);
  border-radius: var(--r-md);
}

.ac-tt {
  flex: 1;
  min-width: 0;
}

.ac-title {
  font-weight: 640;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.ac-change {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-2);
  overflow-wrap: anywhere;
}

.ac-scope {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ac-badge {
  flex: none;
}

/* Registros afectados */

.ac-list {
  margin: 0;
  padding: 0 6px;
  list-style: none;
  border-top: 1px solid var(--border-subtle);
}

.ac-list.open {
  max-height: 360px;
  overflow-y: auto;
}

.ac-r {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.ac-r:last-child {
  border-bottom: 0;
}

.ac-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.ac-label {
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text);
  overflow-wrap: anywhere;
}

a.ac-label:hover {
  color: var(--brand-text);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.ac-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
  overflow-wrap: anywhere;
}

.ac-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: none;
  max-width: 55%;
}

.ac-diff {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 6px;
  font-size: var(--text-xs);
  text-align: right;
}

.ac-before {
  color: var(--text-3);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-3) 55%, transparent);
}

.ac-arrow {
  flex: none;
  color: var(--text-4);
}

.ac-after {
  padding: 1px 7px;
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-radius: var(--r-full);
}

.ac-amount {
  min-width: 84px;
  font-size: var(--text-sm);
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
}

.ac-more {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 6px 16px 2px;
  padding: 3px 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--brand-text);
}

.ac-more:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.ac-hint {
  margin: 0 16px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* Correo que se va a enviar */

.ac-mail {
  margin: 10px 16px 0;
  padding: 10px 12px;
  font-size: var(--text-xs);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.ac-mail-subject {
  font-weight: 600;
  color: var(--text);
  overflow-wrap: anywhere;
}

.ac-mail-subject span {
  margin-right: 6px;
  font-weight: 500;
  color: var(--text-3);
}

.ac-mail-body {
  display: -webkit-box;
  margin-top: 6px;
  line-height: 1.5;
  color: var(--text-2);
  white-space: pre-line;
  overflow-wrap: anywhere;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.ac-mail-body.open {
  display: block;
}

.ac-mail-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ac-mail-file {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 8px;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-full);
  overflow-wrap: anywhere;
}

.ac-mail-toggle {
  margin: 0 0 0 auto;
}

/* Avisos */

.ac-warn {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 10px 16px 0;
  padding: 10px 12px;
  list-style: none;
  font-size: var(--text-xs);
  line-height: 1.45;
  color: var(--text-2);
  background: var(--warning-soft);
  border-radius: var(--r-md);
}

.ac-warn li {
  display: flex;
  gap: 7px;
}

.ac-warn :deep(svg) {
  flex: none;
  margin-top: 2px;
  color: var(--warning);
}

/* Pie: confirmar o resultado */

.ac-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 12px;
  padding: 10px 16px;
  background: var(--surface-2);
  border-top: 1px solid var(--border-subtle);
}

.ac-sum {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ac-sum .num {
  font-size: var(--text-sm);
  font-weight: 640;
  color: var(--text);
}

.ac-ok,
.ac-final {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ac-final {
  font-weight: 600;
  color: var(--danger);
}

.ac-btns {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.ac-out {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.ac-out.bad,
.ac-msg.bad {
  color: var(--danger);
}

.ac-msg {
  flex-basis: 100%;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.spin {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: ac-spin 0.8s linear infinite;
}

@keyframes ac-spin {
  to { transform: rotate(360deg); }
}

.ac-skip {
  padding: 0 0 10px;
  background: var(--surface-2);
}

.ac-skip .ac-more {
  margin-top: 0;
}

.ac-skip-list {
  margin: 4px 16px 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-xs);
  color: var(--text-2);
}

.ac-skip-list li {
  padding: 3px 0;
  overflow-wrap: anywhere;
}

/* Móvil: el nombre se lee entero y, debajo, el cambio y el importe */
@media (max-width: 640px) {
  .ac-head {
    flex-wrap: wrap;
    padding: 12px 12px 10px;
  }

  .ac-tt {
    flex-basis: calc(100% - 46px);
  }

  .ac-badge {
    margin: -2px 0 0 46px;
  }

  .ac-r {
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }

  .ac-meta {
    max-width: none;
    justify-content: space-between;
  }

  .ac-diff {
    justify-content: flex-start;
    text-align: left;
  }

  .ac-amount {
    margin-left: auto;
  }

  .ac-foot {
    padding: 10px 12px;
  }

  .ac-btns {
    width: 100%;
  }

  .ac-btns :deep(.btn) {
    flex: 1;
  }
}
</style>
