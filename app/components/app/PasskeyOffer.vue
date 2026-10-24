<script setup lang="ts">
/**
 * Tras entrar con contraseña en un móvil u ordenador con huella o Face ID: ofrece usarlos la
 * próxima vez. Va por dispositivo, no por cuenta: tener la llave en el ordenador no la pone en el
 * iPhone. Si dices «Ahora no», no vuelve a salir, salvo que luego pruebes a entrar con la huella.
 */
const DECLINED = 'numiq-passkey-declined'

const toast = useToast()
const { register, isSupported, platformAvailable, ready } = usePasskeyRegistration()
const show = ref(false)
const busy = ref(false)

const read = (k: string, store: Storage) => {
  try {
    return store.getItem(k)
  }
  catch {
    return null
  }
}

onMounted(async () => {
  const offer = read(PASSKEY_OFFER, sessionStorage)
  if (!offer || (offer !== 'force' && read(DECLINED, localStorage) === '1')) return
  try {
    sessionStorage.removeItem(PASSKEY_OFFER)
  }
  catch { /* sin almacenamiento: no pasa nada */ }
  await nextTick()
  if (!isSupported.value || passkeyOnDevice() || !(await platformAvailable().catch(() => false))) return
  // Las opciones ya están pedidas cuando aparece: el toque en «Activar» abre Face ID al instante
  await ready()
  setTimeout(() => (show.value = true), 600)
})

async function enable() {
  busy.value = true
  try {
    await register()
    show.value = false
    toast.success('Listo: la próxima vez, sin contraseña', 'Entra con tu huella, tu cara o el PIN de este dispositivo.')
  }
  catch (err) {
    if (passkeyAlreadyHere(err)) {
      show.value = false
      toast.success('Este dispositivo ya estaba listo', 'Entra con tu huella, tu cara o el PIN la próxima vez.')
    }
    else if (passkeyCancelled(err)) {
      toast.info('No se ha activado', 'Si no te salió la huella o Face ID, vuelve a tocar «Activar».')
    }
    else {
      toast.error('No se pudo activar', errorMessage(err))
    }
  }
  finally {
    busy.value = false
  }
}

function later() {
  show.value = false
  try {
    localStorage.setItem(DECLINED, '1')
  }
  catch { /* sin almacenamiento: no pasa nada */ }
}
</script>

<template>
  <Transition name="po">
    <div v-if="show" class="po" role="dialog" aria-label="Entrar con huella o Face ID">
      <span class="po-ic" aria-hidden="true"><Icon name="ph:fingerprint" /></span>
      <div class="grow min0">
        <p class="po-t">Entra más rápido la próxima vez</p>
        <p class="po-s">Con tu huella, tu cara o el PIN de este dispositivo, sin escribir la contraseña.</p>
        <div class="po-acts">
          <UiButton size="sm" variant="ghost" @click="later">Ahora no</UiButton>
          <UiButton size="sm" variant="primary" icon="ph:fingerprint" :loading="busy" @click="enable">Activar</UiButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.po {
  position: fixed;
  right: var(--s-5);
  bottom: calc(var(--s-5) + var(--bnav) + env(safe-area-inset-bottom));
  z-index: var(--z-toast);
  display: flex;
  gap: 14px;
  width: min(380px, calc(100vw - 2 * var(--s-4)));
  padding: var(--s-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xl);
}

.po-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  font-size: 24px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: 14px;
}

.po-t {
  font-weight: 650;
}

.po-s {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.po-acts {
  display: flex;
  justify-content: flex-end;
  gap: var(--s-2);
  margin-top: var(--s-3);
}

.min0 {
  min-width: 0;
}

.po-enter-active,
.po-leave-active {
  transition: opacity var(--t-base) var(--ease-out), transform var(--t-base) var(--ease-out);
}

.po-enter-from,
.po-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (max-width: 767px) {
  .po {
    right: var(--s-3);
    left: var(--s-3);
    width: auto;
  }
}
</style>
