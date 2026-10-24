<script setup lang="ts">
/** Llaves de acceso: entrar con huella, cara o el PIN del dispositivo en lugar de la contraseña */
interface Passkey { id: string, name: string | null, backedUp: boolean, createdAt: string, lastUsedAt: string | null }

const toast = useToast()
const { confirm } = useConfirm()
const { register, isSupported } = usePasskeyRegistration()
const { data, refresh } = useFetch<Passkey[]>('/api/passkeys', { key: 'passkeys', lazy: true, server: false })
const keys = computed(() => data.value ?? [])
/** Este navegador ya tiene su llave (creada o usada aquí) y sigue en la cuenta */
const deviceKey = ref<string | null>(null)
onMounted(() => (deviceKey.value = passkeyOnDevice()))
const here = computed(() => !!deviceKey.value && !!data.value && (deviceKey.value === '1' ? data.value.length > 0 : data.value.some(k => k.id === deviceKey.value)))
// Si la llave de este dispositivo se quitó, se olvida para poder crearla de nuevo
watch([data, deviceKey], () => {
  if (deviceKey.value && data.value && !here.value) {
    markPasskeyOnDevice('')
    deviceKey.value = null
  }
})
const busy = ref<string | null>(null)

async function add() {
  busy.value = 'add'
  try {
    await register()
    // Primero la lista nueva: si no, la llave recién creada parecería quitada
    await refresh()
    deviceKey.value = passkeyOnDevice()
    toast.success('Llave de acceso creada', 'La próxima vez entra con tu huella, tu cara o el PIN de este dispositivo.')
  }
  catch (err) {
    if (passkeyAlreadyHere(err)) {
      deviceKey.value = passkeyOnDevice()
      toast.success('Este dispositivo ya tiene tu llave', 'Ya puedes entrar con tu huella, tu cara o el PIN.')
    }
    // Cancelar el diálogo del sistema no es un error: solo se recuerda cómo seguir
    else if (passkeyCancelled(err)) toast.info('No se ha creado la llave', 'Si no te salió la huella o Face ID, vuelve a intentarlo.')
    else toast.error('No se pudo crear la llave', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

async function remove(k: Passkey) {
  const ok = await confirm({ title: `¿Quitar la llave de ${k.name ?? 'este dispositivo'}?`, body: 'Desde ese dispositivo tendrás que volver a entrar con tu contraseña.', confirmLabel: 'Quitar', danger: true })
  if (!ok) return
  busy.value = k.id
  try {
    await $fetch(`/api/passkeys/${encodeURIComponent(k.id)}` as string, { method: 'DELETE' })
    await refresh()
    toast.success('Llave quitada')
  }
  catch (err) {
    toast.error('No se pudo quitar', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}

const ICONS: Record<string, string> = { iPhone: 'ph:device-mobile', iPad: 'ph:device-tablet', Android: 'ph:android-logo', Mac: 'ph:laptop', Windows: 'ph:windows-logo' }
</script>

<template>
  <UiCard title="Entrar con huella o Face ID" icon="ph:fingerprint" subtitle="Sin contraseña: tu huella, tu cara o el PIN del dispositivo. Más rápido y a prueba de robos de contraseña.">
    <ul v-if="keys.length" class="keys">
      <li v-for="k in keys" :key="k.id" class="key">
        <span class="k-ic" aria-hidden="true"><Icon :name="ICONS[k.name ?? ''] ?? 'ph:key'" /></span>
        <div class="grow min0">
          <p class="k-name">{{ k.name ?? 'Dispositivo' }}<span v-if="k.backedUp" class="k-sync">· sincronizada</span></p>
          <p class="k-sub">Creada {{ relTime(k.createdAt) }}<template v-if="k.lastUsedAt"> · usada {{ relTime(k.lastUsedAt) }}</template></p>
        </div>
        <UiButton size="sm" variant="ghost" square icon="ph:trash" :aria-label="`Quitar la llave de ${k.name ?? 'este dispositivo'}`" :loading="busy === k.id" @click="remove(k)" />
      </li>
    </ul>
    <p v-else class="none">Aún no tienes llaves de acceso.</p>

    <div class="foot">
      <p v-if="isSupported && here" class="here"><Icon name="ph:check-circle-fill" class="here-ic" aria-hidden="true" /> Activado en este dispositivo</p>
      <UiButton v-else-if="isSupported" variant="primary" icon="ph:fingerprint" :loading="busy === 'add'" @click="add">
        {{ keys.length ? 'Añadir este dispositivo' : 'Activar en este dispositivo' }}
      </UiButton>
      <p v-else class="none">Este navegador no admite llaves de acceso.</p>
    </div>
  </UiCard>
</template>

<style scoped>
.keys {
  margin: 0 0 var(--s-4);
  padding: 0;
  list-style: none;
}

.key {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.key + .key {
  border-top: 1px solid var(--border-subtle);
}

.k-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  font-size: 19px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 11px;
}

.k-name {
  font-weight: 600;
}

.k-sync {
  margin-left: 6px;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-3);
}

.k-sub {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.here {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--text-2);
}

.here-ic {
  color: var(--success);
}

.none {
  margin-bottom: var(--s-3);
  font-size: var(--text-sm);
  color: var(--text-3);
}

.foot .none {
  margin: 0;
}
</style>
