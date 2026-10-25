<script setup lang="ts">
import type { CreatedSignature } from '~/components/signature/Creator.vue'

/**
 * Firma de una factura o presupuesto: activarla o quitarla y elegir cuál. Sin tocar nada sigue lo que diga
 * Ajustes → Firmas para su tipo; lo cambiado aquí vale solo para este documento.
 */
export interface DocSigning {
  /** null = lo de Ajustes */
  sign: boolean | null
  /** null = la firma de Ajustes (o la principal) */
  signatureId: number | null
}

const props = defineProps<{ isQuote: boolean, saving?: boolean, settingsLink?: boolean }>()
const model = defineModel<DocSigning>({ required: true })
const emit = defineEmits<{ resolved: [signature: Signature | null] }>()

const toast = useToast()
const { list, load, create, settings, loadSettings } = useSignatures()
onMounted(() => {
  load().catch(() => {})
  loadSettings().catch(() => {})
})

const signatures = computed(() => list.value ?? [])
const byDefault = computed(() => (props.isQuote ? settings.value?.quotes : settings.value?.invoices) ?? false)
const on = computed(() => model.value.sign ?? byDefault.value)
// La de Ajustes, o la principal (la lista viene con la principal primero)
const defaultSig = computed(() => signatures.value.find(s => s.id === settings.value?.signatureId) ?? signatures.value[0] ?? null)
const chosen = computed(() => signatures.value.find(s => s.id === model.value.signatureId) ?? defaultSig.value)
const resolved = computed(() => (on.value ? chosen.value : null))
watch(resolved, v => emit('resolved', v), { immediate: true })

const custom = computed(() => model.value.sign !== null || model.value.signatureId !== null)
const label = computed(() => (props.isQuote ? 'este presupuesto' : 'esta factura'))

function toggle(v: boolean) {
  model.value = { sign: v === byDefault.value ? null : v, signatureId: model.value.signatureId }
}
function pick(id: number) {
  model.value = { sign: on.value === byDefault.value ? null : true, signatureId: id === defaultSig.value?.id ? null : id }
}
function reset() {
  model.value = { sign: null, signatureId: null }
}

// Crear una firma sin salir del documento
const creatorOpen = ref(false)
const creator = ref<{ submit: () => Promise<CreatedSignature | null>, ready: boolean } | null>(null)
const creating = ref(false)
async function saveNew() {
  if (!creator.value?.ready) return
  creating.value = true
  try {
    const sig = await creator.value.submit()
    if (!sig) return
    const created = await create(sig)
    creatorOpen.value = false
    model.value = { sign: byDefault.value ? null : true, signatureId: created.id === defaultSig.value?.id ? null : created.id }
    toast.success('Firma guardada', `«${created.name}» ya firma ${label.value}.`)
  }
  catch (err) {
    toast.error('No se pudo guardar la firma', errorMessage(err))
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <UiCard class="sign-card">
    <template #head>
      <div class="head">
        <span class="ic" :class="{ on }" aria-hidden="true"><Icon :name="on ? 'ph:signature-bold' : 'ph:signature'" /></span>
        <div class="min0">
          <h2 class="section-title">Firma</h2>
          <p class="sub">{{ on ? (resolved ? `Firmado con «${resolved.name}»` : 'Falta elegir una firma') : `Sin firma en ${label}` }}</p>
        </div>
      </div>
    </template>
    <template #actions>
      <UiSwitch :model-value="on" :disabled="saving" :aria-label="`Firmar ${label}`" @update:model-value="toggle" />
    </template>

    <Transition name="sc-fold">
      <div v-if="on" class="body">
        <div v-if="signatures.length" class="picks" role="radiogroup" :aria-label="`Firma para ${label}`">
          <button
            v-for="s in signatures"
            :key="s.id"
            type="button"
            role="radio"
            class="pick"
            :class="{ sel: chosen?.id === s.id }"
            :aria-checked="chosen?.id === s.id"
            :title="s.name"
            :disabled="saving"
            @click="pick(s.id)"
          >
            <span class="pick-paper"><img :src="s.url" alt="" draggable="false"></span>
            <span class="pick-name">{{ s.name }}</span>
            <Icon v-if="chosen?.id === s.id" name="ph:check-circle-fill" class="pick-ok" aria-hidden="true" />
          </button>
          <button type="button" class="pick add" :disabled="saving" @click="creatorOpen = true">
            <Icon name="ph:plus-bold" />
            <span class="pick-name">Nueva</span>
          </button>
        </div>
        <div v-else class="none">
          <p>Aún no tienes ninguna firma. Créala en un momento: dibujada, escrita o desde una foto.</p>
          <UiButton size="sm" variant="primary" icon="ph:pen-nib" @click="creatorOpen = true">Crear mi firma</UiButton>
        </div>
      </div>
    </Transition>

    <p class="foot">
      <template v-if="custom">
        <Icon name="ph:pencil-simple-line" aria-hidden="true" /> Elegido solo para {{ label }}.
        <button type="button" class="link" :disabled="saving" @click="reset">Volver a lo de Ajustes</button>
      </template>
      <template v-else>
        <Icon name="ph:gear-six" aria-hidden="true" />
        {{ byDefault ? `Ajustes firma ${isQuote ? 'los presupuestos' : 'las facturas'} por defecto.` : `Por defecto, ${isQuote ? 'los presupuestos' : 'las facturas'} van sin firma.` }}
        <NuxtLink v-if="settingsLink" to="/ajustes?s=firmas" class="link">Cambiar</NuxtLink>
      </template>
    </p>

    <UiModal v-model="creatorOpen" title="Nueva firma" subtitle="Dibújala, escríbela o sube una foto" size="lg" persistent no-touch-keyboard>
      <SignatureCreator v-if="creatorOpen" ref="creator" />
      <template #footer>
        <UiButton @click="creatorOpen = false">Cancelar</UiButton>
        <UiButton variant="primary" icon="ph:check-bold" :loading="creating" :disabled="!creator?.ready" @click="saveNew">Guardar y usar</UiButton>
      </template>
    </UiModal>
  </UiCard>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.min0 {
  min-width: 0;
}

.ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 36px;
  height: 36px;
  font-size: 19px;
  color: var(--text-3);
  background: var(--surface-sunken);
  border-radius: 10px;
  transition: color var(--t-fast), background var(--t-fast);
}

.ic.on {
  color: var(--brand-text);
  background: var(--brand-soft);
}

.sub {
  margin-top: 1px;
  overflow: hidden;
  font-size: var(--text-xs);
  color: var(--text-3);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.body {
  margin-top: 2px;
}

.picks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
}

.pick {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  min-width: 0;
  padding: 5px 5px 6px;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
}

.pick:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--brand) 40%, var(--border));
}

.pick:active:not(:disabled) {
  transform: scale(0.98);
}

.pick.sel {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.pick-paper {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 46px;
  padding: 5px 8px;
  background: linear-gradient(180deg, #fff, #f7f7f4);
  border-radius: 7px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.05);
}

.pick-paper img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.pick-name {
  overflow: hidden;
  padding: 0 3px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pick-ok {
  position: absolute;
  top: -6px;
  right: -6px;
  font-size: 18px;
  color: var(--brand);
  background: var(--surface);
  border-radius: 50%;
}

.pick.add {
  align-items: center;
  justify-content: center;
  min-height: 76px;
  color: var(--text-3);
  font-size: 15px;
  border-style: dashed;
}

.pick.add:hover {
  color: var(--brand-text);
  background: var(--brand-soft);
}

.none {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--surface-2, var(--surface-sunken));
  border-radius: var(--r-md);
}

.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  margin-top: 12px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.foot .link {
  font-size: inherit;
  font-weight: 600;
}

.sc-fold-enter-active,
.sc-fold-leave-active {
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
}

.sc-fold-enter-from,
.sc-fold-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
