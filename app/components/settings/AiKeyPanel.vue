<script setup lang="ts">
/** Clave de OpenAI del usuario: se pega aquí, se comprueba con OpenAI y se guarda cifrada. Nunca vuelve al navegador */
interface AiKeyStatus {
  configured: boolean
  source: 'own' | 'owner' | null
  ownerName: string | null
  own: { hint: string, savedAt: string | null } | null
  owner: boolean
}

const props = defineProps<{ status: AiKeyStatus | null | undefined }>()
const emit = defineEmits<{ changed: [] }>()

const toast = useToast()
const { confirm } = useConfirm()

const key = ref('')
const show = ref(false)
const error = ref<string | null>(null)
const saving = ref(false)
const replacing = ref(false)

const own = computed(() => props.status?.own ?? null)
const showForm = computed(() => !own.value || replacing.value)

async function save() {
  error.value = null
  const value = key.value.trim()
  if (!/^sk-/.test(value)) {
    error.value = 'La clave de OpenAI empieza por «sk-»'
    return
  }
  saving.value = true
  try {
    await $fetch('/api/ai/key', { method: 'PUT', body: { key: value } })
    key.value = ''
    show.value = false
    replacing.value = false
    emit('changed')
    toast.success('Clave guardada y cifrada', 'La IA ya usa tu cuenta de OpenAI')
  }
  catch (err) {
    if (errorField(err) === 'key' || (err as { statusCode?: number }).statusCode === 400) error.value = errorMessage(err)
    else toast.error('No se pudo guardar la clave', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

async function remove() {
  const body = props.status?.owner
    ? 'La IA dejará de funcionar para ti y para los miembros de tu equipo que no tengan su propia clave.'
    : 'La IA dejará de usar tu cuenta de OpenAI.'
  if (!(await confirm({ title: '¿Quitar tu clave de OpenAI?', body, confirmLabel: 'Quitar', danger: true }))) return
  try {
    await $fetch('/api/ai/key', { method: 'DELETE' })
    replacing.value = false
    emit('changed')
    toast.success('Clave quitada')
  }
  catch (err) {
    toast.error('No se pudo quitar la clave', errorMessage(err))
  }
}

function cancel() {
  replacing.value = false
  key.value = ''
  error.value = null
}

const fdate = (d: string | null) => (d ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
</script>

<template>
  <div class="key-panel">
    <div v-if="own && !replacing" class="key">
      <span class="k-ic" aria-hidden="true"><Icon name="ph:key-fill" /></span>
      <div class="grow min0">
        <p class="k-t">Tu clave de OpenAI</p>
        <p class="k-hint mono">{{ own.hint }}</p>
        <p v-if="own.savedAt" class="k-at">Guardada el {{ fdate(own.savedAt) }}</p>
        <p v-if="status?.owner" class="k-note"><Icon name="ph:users-three" class="n-ic" aria-hidden="true" /><span>Los miembros de tu equipo que no tengan su propia clave usan esta.</span></p>
      </div>
      <div class="k-act">
        <UiButton size="sm" variant="secondary" icon="ph:arrows-clockwise" @click="replacing = true">Cambiar</UiButton>
        <UiButton size="sm" variant="ghost" icon="ph:trash" @click="remove">Quitar</UiButton>
      </div>
    </div>

    <template v-if="showForm">
      <p v-if="status?.source === 'owner' && !replacing" class="borrowed">
        <Icon name="ph:info-fill" class="n-ic" aria-hidden="true" />
        <span>Ahora usas la clave de <strong>{{ status.ownerName }}</strong>, titular de la empresa. Añade la tuya para que la IA use tu propia cuenta de OpenAI.</span>
      </p>
      <ol v-else-if="!replacing" class="steps">
        <li>Crea una clave en <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" class="link">platform.openai.com/api-keys</a> («Create new secret key»).</li>
        <li>Pégala aquí y guárdala. Cada usuario usa la suya: ya no hace falta ponerla en el servidor.</li>
      </ol>

      <form class="pw" novalidate @submit.prevent="save">
        <UiInput v-model="key" :type="show ? 'text' : 'password'" label="Clave de OpenAI" placeholder="sk-proj-…" autocomplete="off" spellcheck="false" :error="error">
          <template #end>
            <button type="button" class="eye" :aria-label="show ? 'Ocultar clave' : 'Mostrar clave'" @click="show = !show"><Icon :name="show ? 'ph:eye-slash' : 'ph:eye'" /></button>
          </template>
        </UiInput>
        <div class="row gap-2 pw-act">
          <UiButton v-if="replacing" variant="ghost" @click="cancel">Cancelar</UiButton>
          <UiButton type="submit" variant="primary" icon="ph:lock-key" :loading="saving" :disabled="!key.trim()">Guardar cifrada</UiButton>
        </div>
      </form>
    </template>

    <p class="sec">
      <Icon name="ph:shield-check-fill" class="n-ic" aria-hidden="true" />
      <span>Se comprueba con OpenAI y se guarda <strong class="nowrap">cifrada (AES-256)</strong> en la base de datos. Nunca vuelve al navegador: nadie puede verla, ni tú, ni tu equipo, ni el asistente.</span>
    </p>
  </div>
</template>

<style scoped>
.key-panel {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  margin-top: var(--s-5);
  container-type: inline-size;
}

.min0 {
  min-width: 0;
}

.key {
  display: flex;
  align-items: flex-start;
  gap: var(--s-4);
  padding: var(--s-4);
  background: var(--success-soft);
  border: 1px solid color-mix(in srgb, var(--success-solid) 30%, var(--border));
  border-radius: var(--r-lg);
}

.k-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 42px;
  height: 42px;
  font-size: 22px;
  color: var(--success);
  background: var(--surface);
  border-radius: var(--r-lg);
}

.k-t {
  font-weight: 650;
}

.k-hint {
  margin-top: 2px;
  font-size: var(--text-sm);
  word-break: break-all;
}

.k-at {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.k-note,
.borrowed {
  display: flex;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.k-note {
  margin-top: var(--s-2);
}

.n-ic {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 2px;
}

.borrowed .n-ic {
  color: var(--brand);
}

.k-act {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.steps {
  display: grid;
  gap: 4px;
  padding-left: 1.2em;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.pw {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--s-3);
  align-items: end;
}

.pw-act {
  padding-bottom: 1px;
}

.eye {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--text-3);
}

.sec {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.sec .n-ic {
  width: 15px;
  height: 15px;
  margin-top: 0;
  color: var(--success);
}

.sec strong {
  font-weight: 600;
  color: var(--text-2);
}

.nowrap {
  white-space: nowrap;
}

@container (max-width: 520px) {
  .key {
    flex-wrap: wrap;
  }

  .k-act {
    flex-direction: row;
    width: 100%;
  }

  .pw {
    grid-template-columns: minmax(0, 1fr);
  }

  .pw-act {
    justify-content: flex-end;
  }
}
</style>
