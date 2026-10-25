<script setup lang="ts">
/**
 * Firma por defecto en las facturas y los presupuestos que genera NUMIQ: si van firmados, con qué firma y
 * con qué texto encima. Cada documento puede cambiarlo en su ficha o en el editor. Se guarda al momento.
 */
const props = defineProps<{ canEdit: boolean }>()
const emit = defineEmits<{ create: [] }>()

const toast = useToast()
const { me } = useMe()
const { list, settings, loadSettings, saveSettings } = useSignatures()
onMounted(() => loadSettings(true).catch(() => {}))

const signatures = computed(() => list.value ?? [])
const s = computed<SigningSettings>(() => settings.value ?? { invoices: false, quotes: false, signatureId: null, label: 'Firma' })
// La elegida o, si no hay (o se borró), la principal
const chosen = computed(() => signatures.value.find(x => x.id === s.value.signatureId) ?? signatures.value[0] ?? null)
const active = computed(() => s.value.invoices || s.value.quotes)

const saved = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | undefined
async function update(patch: Partial<SigningSettings>) {
  if (!props.canEdit) return
  try {
    await saveSettings({ ...s.value, ...patch })
    saved.value = true
    clearTimeout(savedTimer)
    savedTimer = setTimeout(() => (saved.value = false), 1800)
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
}

// El texto se guarda al dejar de escribir
const label = ref('')
watch(() => settings.value?.label, v => (label.value = v ?? 'Firma'), { immediate: true })
let labelTimer: ReturnType<typeof setTimeout> | undefined
watch(label, (v) => {
  if (v === s.value.label) return
  clearTimeout(labelTimer)
  labelTimer = setTimeout(() => update({ label: v.trim().slice(0, 40) }), 600)
})
const LABELS = ['Firma', 'Firma y sello', 'Conforme', 'Fdo.']

const signer = computed(() => me.value?.company?.legalName ?? me.value?.user.name ?? '')
</script>

<template>
  <UiCard title="Firma en facturas y presupuestos" icon="ph:seal-check" subtitle="Tus documentos salen firmados en el PDF, en la vista del cliente y al enviarlos por email. En cada factura o presupuesto puedes quitarla o cambiarla.">
    <template #actions>
      <Transition name="sd-saved">
        <span v-if="saved" class="saved"><Icon name="ph:check-circle-fill" aria-hidden="true" /> Guardado</span>
      </Transition>
    </template>

    <div class="layout">
      <div class="opts">
        <div class="switches">
          <UiSwitch :model-value="s.invoices" :disabled="!canEdit" label="Firmar las facturas" hint="También las rectificativas y las ya emitidas, salvo las que cambies a mano" @update:model-value="v => update({ invoices: v })" />
          <UiSwitch :model-value="s.quotes" :disabled="!canEdit" label="Firmar los presupuestos" hint="Y las proformas" @update:model-value="v => update({ quotes: v })" />
        </div>

        <Transition name="sd-fold">
          <div v-if="active" class="more">
            <div class="field">
              <span class="field-label">Firma a usar</span>
              <div v-if="signatures.length" class="picks" role="radiogroup" aria-label="Firma a usar">
                <button
                  v-for="x in signatures"
                  :key="x.id"
                  type="button"
                  role="radio"
                  class="pick"
                  :class="{ sel: chosen?.id === x.id }"
                  :aria-checked="chosen?.id === x.id"
                  :disabled="!canEdit"
                  :title="x.name"
                  @click="update({ signatureId: x.isDefault ? null : x.id })"
                >
                  <span class="pick-paper"><img :src="x.url" alt="" draggable="false"></span>
                  <span class="pick-name">{{ x.name }}<small v-if="x.isDefault"> · principal</small></span>
                  <Icon v-if="chosen?.id === x.id" name="ph:check-circle-fill" class="pick-ok" aria-hidden="true" />
                </button>
              </div>
              <div v-else class="none">
                <p>Primero crea una firma: dibujada, escrita o desde una foto.</p>
                <UiButton size="sm" variant="primary" icon="ph:pen-nib" @click="emit('create')">Crear mi firma</UiButton>
              </div>
            </div>

            <div class="field">
              <UiInput v-model="label" label="Texto encima de la firma" maxlength="40" placeholder="Sin texto" :disabled="!canEdit" />
              <div class="chips" role="group" aria-label="Textos habituales">
                <button v-for="l in LABELS" :key="l" type="button" class="chip" :class="{ on: label === l }" :disabled="!canEdit" @click="label = l">{{ l }}</button>
                <button type="button" class="chip" :class="{ on: !label }" :disabled="!canEdit" @click="label = ''">Sin texto</button>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- Así queda al pie del documento -->
      <figure class="preview" :class="{ off: !active || !chosen }" aria-label="Vista previa del pie del documento">
        <div class="pv-paper">
          <span class="pv-k">Observaciones</span>
          <span class="pv-line w80" />
          <span class="pv-line w60" />
          <div class="pv-sign">
            <span v-if="label" class="pv-k">{{ label }}</span>
            <div class="pv-img">
              <img v-if="chosen && active" :src="chosen.url" alt="">
              <span v-else class="pv-empty">{{ active ? 'Sin firma elegida' : 'Sin firma' }}</span>
            </div>
            <span class="pv-name">{{ signer }}</span>
          </div>
          <div class="pv-total"><span>Total</span><strong>1.210,00 €</strong></div>
        </div>
        <figcaption>{{ active ? 'Así se ve al pie del documento' : 'Activa la firma para verla aquí' }}</figcaption>
      </figure>
    </div>
    <p v-if="!canEdit" class="ro"><Icon name="ph:lock-simple" aria-hidden="true" /> Solo los administradores cambian estos ajustes.</p>
  </UiCard>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: var(--s-6);
  align-items: start;
}

.opts {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
  min-width: 0;
}

.switches {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.more {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
}

.picks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}

.pick {
  position: relative;
  display: flex;
  flex-direction: column;
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

.pick.sel {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.pick:disabled {
  cursor: default;
}

.pick-paper {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  padding: 6px 10px;
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
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pick-name small {
  font-weight: 500;
  color: var(--text-3);
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

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  height: 28px;
  padding: 0 11px;
  font-size: 12.5px;
  font-weight: 560;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
}

.chip:hover:not(:disabled) {
  background: var(--surface-hover);
}

.chip.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: color-mix(in srgb, var(--brand) 40%, transparent);
}

/* Vista previa: un trozo de hoja, siempre en blanco como el documento */
.preview {
  margin: 0;
}

.pv-paper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 18px 16px;
  color: #11141b;
  background: #fff;
  border-radius: var(--r-lg);
  box-shadow: 0 0 0 1px rgba(15, 18, 30, 0.08), 0 14px 34px -14px rgba(15, 18, 30, 0.28);
  transition: opacity var(--t-base, 200ms);
}

.preview.off .pv-paper {
  opacity: 0.6;
}

.pv-k {
  font-size: 8px;
  font-weight: 650;
  letter-spacing: 0.08em;
  color: #6b7280;
  text-transform: uppercase;
}

.pv-line {
  height: 5px;
  background: #eceef2;
  border-radius: 3px;
}

.w80 { width: 80%; }
.w60 { width: 60%; }

.pv-sign {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 12px;
}

.pv-img {
  display: flex;
  align-items: center;
  height: 52px;
}

.pv-img img {
  max-width: 170px;
  height: 100%;
  object-fit: contain;
  object-position: left center;
}

.pv-empty {
  font-size: 11px;
  color: #a3a9b5;
}

.pv-name {
  padding-top: 4px;
  font-size: 9.5px;
  color: #6b7280;
  border-top: 1px solid #d6d9e0;
}

.pv-total {
  display: flex;
  justify-content: space-between;
  margin-top: 14px;
  padding: 7px 10px;
  font-size: 11px;
  background: color-mix(in srgb, var(--brand) 9%, #fff);
  border-radius: 6px;
}

figcaption {
  margin-top: 8px;
  font-size: var(--text-xs);
  color: var(--text-3);
  text-align: center;
}

.saved {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--success);
}

.ro {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-4);
  font-size: var(--text-xs);
  color: var(--text-3);
}

.sd-fold-enter-active,
.sd-fold-leave-active {
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
}

.sd-fold-enter-from,
.sd-fold-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.sd-saved-enter-active,
.sd-saved-leave-active {
  transition: opacity 200ms;
}

.sd-saved-enter-from,
.sd-saved-leave-to {
  opacity: 0;
}

@container settings (max-width: 700px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .preview {
    max-width: 320px;
  }
}
</style>
