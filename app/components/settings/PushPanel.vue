<script setup lang="ts">
/** Avisos en este dispositivo: solo lo que pasa sin que tú hagas nada */
const toast = useToast()
const push = usePush()
const busy = ref<'toggle' | 'test' | null>(null)

const WHAT = [
  { icon: 'ph:eye', text: 'Un cliente abre tu factura o tu presupuesto' },
  { icon: 'ph:thumbs-up', text: 'Acepta o rechaza un presupuesto' },
  { icon: 'ph:arrows-clockwise', text: 'Se emite sola una factura recurrente' },
  { icon: 'ph:sparkle', text: 'La IA termina de leer tus documentos' },
  { icon: 'ph:bank', text: 'Quedan pocos días para presentar impuestos' },
]

async function toggle(on: boolean) {
  busy.value = 'toggle'
  try {
    if (on) {
      await push.enable()
      toast.success('Avisos activados en este dispositivo')
    }
    else {
      await push.disable()
      toast.info('Avisos desactivados en este dispositivo')
    }
  }
  catch (err) {
    toast.error('No se pudieron activar los avisos', errorMessage(err))
    await push.refresh()
  }
  finally {
    busy.value = null
  }
}

async function test() {
  busy.value = 'test'
  try {
    await $fetch('/api/push/test', { method: 'POST' })
    toast.success('Aviso de prueba enviado', 'Debería llegarte en unos segundos.')
  }
  catch (err) {
    toast.error('No se pudo enviar la prueba', errorMessage(err))
  }
  finally {
    busy.value = null
  }
}
</script>

<template>
  <UiCard title="Avisos en este dispositivo" icon="ph:bell-ringing" subtitle="Solo lo importante que pasa sin que tú hagas nada. Nada de spam.">
    <ul class="what">
      <li v-for="w in WHAT" :key="w.text"><Icon :name="w.icon" aria-hidden="true" />{{ w.text }}</li>
    </ul>

    <p v-if="push.needsInstall.value" class="note">
      <Icon name="ph:device-mobile" aria-hidden="true" />
      En iPhone y iPad, primero instala NUMIQ: botón Compartir → «Añadir a pantalla de inicio». Luego ábrela desde el icono y activa aquí los avisos.
    </p>
    <p v-else-if="!push.supported.value" class="note"><Icon name="ph:info" aria-hidden="true" /> Este navegador no admite avisos.</p>
    <p v-else-if="push.permission.value === 'denied'" class="note warn">
      <Icon name="ph:bell-slash" aria-hidden="true" /> Los avisos están bloqueados para NUMIQ en este navegador: actívalos en los ajustes del sitio y vuelve aquí.
    </p>

    <div v-if="push.supported.value && !push.needsInstall.value" class="row">
      <UiSwitch :model-value="push.enabled.value" :disabled="busy === 'toggle' || push.permission.value === 'denied'" label="Recibir avisos aquí" @update:model-value="toggle" />
      <UiButton v-if="push.enabled.value" size="sm" variant="ghost" icon="ph:paper-plane-tilt" :loading="busy === 'test'" @click="test">Enviar prueba</UiButton>
    </div>
  </UiCard>
</template>

<style scoped>
.what {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px var(--s-4);
  margin: 0 0 var(--s-4);
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.what li {
  display: flex;
  align-items: center;
  gap: 8px;
}

.what :deep(svg) {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--brand);
}

.note {
  display: flex;
  gap: 8px;
  margin-bottom: var(--s-3);
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

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
}

@media (max-width: 640px) {
  .what {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
