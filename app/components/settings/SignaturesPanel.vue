<script setup lang="ts">
import type { CtxSpec } from '~/composables/useContextMenu'
import type { CreatedSignature } from '~/components/signature/Creator.vue'

/** Firmas de la empresa: se crean dibujando, escribiendo o subiendo una imagen y se estampan desde el visor */
defineProps<{ canEdit: boolean }>()
const toast = useToast()
const { confirm } = useConfirm()
const { list, load, create, rename, makeDefault, remove } = useSignatures()

const failed = ref(false)
onMounted(() => load(true).catch(() => (failed.value = true)))
const items = computed(() => list.value ?? [])

const KIND: Record<string, { label: string, icon: string }> = {
  drawn: { label: 'Dibujada', icon: 'ph:pen-nib' },
  typed: { label: 'Escrita', icon: 'ph:text-aa' },
  image: { label: 'Imagen', icon: 'ph:image' },
}

// ─── Nueva firma ───
const creatorOpen = ref(false)
const creatorTab = ref<'draw' | 'type' | 'upload'>('draw')
const creator = ref<{ submit: () => Promise<CreatedSignature | null>, ready: boolean } | null>(null)
const saving = ref(false)
const fresh = ref<number | null>(null)

function openCreator(tab: 'draw' | 'type' | 'upload' = 'draw') {
  creatorTab.value = tab
  creatorOpen.value = true
}

async function saveNew() {
  if (!creator.value?.ready) return
  saving.value = true
  try {
    const sig = await creator.value.submit()
    if (!sig) return
    const created = await create(sig)
    creatorOpen.value = false
    fresh.value = created.id
    setTimeout(() => (fresh.value = null), 1600)
    toast.success('Firma guardada', 'Ábrela desde el visor de cualquier documento con «Firmar».')
  }
  catch (err) {
    toast.error('No se pudo guardar la firma', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}

// ─── Renombrar en el sitio ───
const editing = ref<number | null>(null)
const draft = ref('')
function startRename(s: Signature) {
  editing.value = s.id
  draft.value = s.name
  nextTick(() => document.querySelector<HTMLInputElement>(`#sig-name-${s.id}`)?.select())
}
async function commitRename(s: Signature) {
  const name = draft.value.trim()
  editing.value = null
  if (!name || name === s.name) return
  try {
    await rename(s.id, name.slice(0, 60))
  }
  catch (err) {
    toast.error('No se pudo renombrar', errorMessage(err))
  }
}

async function setDefault(s: Signature) {
  try {
    await makeDefault(s.id)
    toast.success(`«${s.name}» es tu firma principal`, 'Es la primera que aparece al firmar un documento.')
  }
  catch (err) {
    toast.error('No se pudo cambiar', errorMessage(err))
  }
}

async function del(s: Signature) {
  const ok = await confirm({ title: `¿Eliminar la firma «${s.name}»?`, body: 'Los documentos que ya firmaste con ella no cambian.', confirmLabel: 'Eliminar firma', danger: true })
  if (!ok) return
  try {
    await remove(s.id)
    toast.success('Firma eliminada')
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
}

function download(s: Signature) {
  const a = document.createElement('a')
  a.href = s.url
  a.download = `${s.name}.png`
  a.click()
}

function menu(s: Signature): CtxSpec {
  return {
    title: s.name,
    subtitle: `${KIND[s.kind]?.label ?? 'Firma'}${s.isDefault ? ' · principal' : ''}`,
    icon: 'ph:signature',
    items: [
      { label: 'Usar como principal', icon: 'ph:star', disabled: s.isDefault, onClick: () => setDefault(s) },
      { label: 'Cambiar nombre', icon: 'ph:pencil-simple', onClick: () => startRename(s) },
      { label: 'Descargar PNG', icon: 'ph:download-simple', onClick: () => download(s) },
      { label: 'Copiar nombre', icon: 'ph:copy', onClick: () => copyText(s.name, 'Nombre') },
      { divider: true },
      { label: 'Nueva firma…', icon: 'ph:plus', onClick: () => openCreator() },
      { divider: true },
      { label: 'Eliminar firma…', icon: 'ph:trash', danger: true, onClick: () => del(s) },
    ],
  }
}
</script>

<template>
  <div class="stack gap-4">
    <UiCard title="Firmas" icon="ph:signature" subtitle="Guarda tu firma una vez y estámpala en contratos, presupuestos aceptados o facturas recibidas desde el visor de documentos: ábrelo y pulsa «Firmar».">
      <template v-if="items.length" #actions>
        <UiButton size="sm" variant="primary" icon="ph:plus-bold" @click="openCreator()">Nueva firma</UiButton>
      </template>

      <div v-if="list === null && !failed" class="grid" aria-busy="true">
        <div v-for="i in 2" :key="i" class="skeleton sk-card" />
      </div>

      <p v-else-if="failed" class="none">No se pudieron cargar las firmas.</p>

      <div v-else-if="!items.length" class="empty">
        <div class="empty-art" aria-hidden="true">
          <svg viewBox="0 0 220 70" class="empty-sig"><path d="M8 52c14-6 22-34 30-36 7-2-3 38 4 38 8 0 14-30 22-30s-2 24 6 24c9 0 12-18 20-18 6 0 3 12 10 12 9 0 16-20 26-20 8 0 2 16 12 16 12 0 22-14 36-14 10 0 16 6 34 4" /></svg>
          <span class="empty-line" />
        </div>
        <p class="empty-t">Aún no tienes ninguna firma</p>
        <p class="empty-s">Elige cómo crearla. Tardas menos de un minuto y queda guardada para siempre.</p>
        <div class="ways">
          <button type="button" class="way" @click="openCreator('draw')">
            <span class="way-ic"><Icon name="ph:pen-nib-duotone" /></span>
            <span class="way-t">Dibujarla</span>
            <span class="way-s">Con el ratón, el dedo o un lápiz</span>
          </button>
          <button type="button" class="way" @click="openCreator('type')">
            <span class="way-ic"><Icon name="ph:text-aa-duotone" /></span>
            <span class="way-t">Escribirla</span>
            <span class="way-s">Tu nombre con letra manuscrita</span>
          </button>
          <button type="button" class="way" @click="openCreator('upload')">
            <span class="way-ic"><Icon name="ph:camera-duotone" /></span>
            <span class="way-t">Subir una foto</span>
            <span class="way-s">Firma en papel: quitamos el fondo</span>
          </button>
        </div>
      </div>

      <TransitionGroup v-else tag="ul" name="sig" class="grid">
        <li v-for="s in items" :key="s.id" v-ctx="() => menu(s)" class="sig" :class="{ fresh: fresh === s.id, main: s.isDefault }">
          <div class="sig-paper">
            <img :src="s.url" :alt="`Firma: ${s.name}`" class="sig-img" loading="lazy" draggable="false">
            <span v-if="s.isDefault" class="main-badge"><Icon name="ph:star-fill" aria-hidden="true" /> Principal</span>
          </div>
          <div class="meta">
            <div class="grow min0">
              <input
                v-if="editing === s.id"
                :id="`sig-name-${s.id}`"
                v-model="draft"
                class="rename"
                maxlength="60"
                aria-label="Nombre de la firma"
                @keydown.enter.prevent="commitRename(s)"
                @keydown.esc.stop.prevent="editing = null"
                @blur="commitRename(s)"
              >
              <button v-else type="button" class="name truncate" title="Cambiar nombre" @click="startRename(s)">{{ s.name }}</button>
              <p class="kind"><Icon :name="KIND[s.kind]?.icon ?? 'ph:signature'" aria-hidden="true" /> {{ KIND[s.kind]?.label }} · {{ relTime(s.createdAt) }}</p>
            </div>
            <UiButton v-if="!s.isDefault" size="sm" variant="ghost" square icon="ph:star" :aria-label="`Usar «${s.name}» como principal`" title="Usar como principal" @click="setDefault(s)" />
            <UiButton size="sm" variant="ghost" square icon="ph:trash" :aria-label="`Eliminar «${s.name}»`" title="Eliminar" @click="del(s)" />
          </div>
        </li>
        <li key="add" class="sig add-card">
          <button type="button" class="add" @click="openCreator()">
            <span class="add-ic"><Icon name="ph:plus-bold" /></span>
            <span>Nueva firma</span>
            <span class="add-s">Firma completa, rúbrica o iniciales</span>
          </button>
        </li>
      </TransitionGroup>

      <UiModal v-model="creatorOpen" title="Nueva firma" subtitle="Dibújala, escríbela o sube una foto" size="lg" persistent no-touch-keyboard>
        <SignatureCreator v-if="creatorOpen" ref="creator" :initial-tab="creatorTab" />
        <template #footer>
          <UiButton @click="creatorOpen = false">Cancelar</UiButton>
          <UiButton variant="primary" icon="ph:check-bold" :loading="saving" :disabled="!creator?.ready" @click="saveNew">Guardar firma</UiButton>
        </template>
      </UiModal>
    </UiCard>

    <SettingsSigningDefaults :can-edit="canEdit" @create="openCreator()" />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--s-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.sk-card {
  height: 176px;
  border-radius: var(--r-lg);
}

.sig {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
}

.sig:hover {
  border-color: color-mix(in srgb, var(--brand) 30%, var(--border));
  box-shadow: var(--shadow-sm);
}

.sig.main {
  border-color: color-mix(in srgb, var(--brand) 40%, var(--border));
}

.sig.fresh {
  animation: sig-pop 1.2s var(--ease-out);
}

@keyframes sig-pop {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand) 55%, transparent); }
  100% { box-shadow: 0 0 0 14px transparent; }
}

.sig-paper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 118px;
  padding: 16px 22px;
  background: radial-gradient(120% 100% at 50% 0%, #fff, #f8f8f5);
  border-bottom: 1px solid var(--border-subtle);
}

.sig-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}

.main-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 650;
  color: #8a5a00;
  background: #fff4d6;
  border-radius: 999px;
}

.meta {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 6px 8px 12px;
}

.min0 {
  min-width: 0;
}

.name {
  display: block;
  max-width: 100%;
  padding: 0;
  font-size: var(--text-sm);
  font-weight: 620;
  color: var(--text);
  text-align: left;
  background: none;
  border: 0;
  cursor: text;
}

.name:hover {
  text-decoration: underline dotted var(--text-3);
  text-underline-offset: 3px;
}

.rename {
  width: 100%;
  height: 26px;
  padding: 0 6px;
  margin-left: -7px;
  font-size: var(--text-sm);
  font-weight: 620;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--brand);
  border-radius: var(--r-sm);
  outline: none;
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.kind {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 1px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.add-card {
  border-style: dashed;
  background: transparent;
}

.add {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 170px;
  padding: var(--s-4);
  font-size: var(--text-sm);
  font-weight: 620;
  color: var(--text-2);
  background: none;
  border: 0;
  cursor: pointer;
  transition: color var(--t-fast), background var(--t-fast);
}

.add:hover {
  color: var(--brand-text);
  background: var(--brand-soft);
}

.add-ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  margin-bottom: 4px;
  font-size: 17px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 50%;
}

.add-s {
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-3);
}

.none {
  color: var(--text-3);
  font-size: var(--text-sm);
}

/* Vacío */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--s-4) 0 var(--s-2);
  text-align: center;
}

.empty-art {
  position: relative;
  width: 220px;
  margin-bottom: var(--s-4);
}

.empty-sig {
  width: 100%;
  fill: none;
  stroke: var(--brand);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 520;
  stroke-dashoffset: 520;
  animation: sig-draw 2.4s var(--ease-out) 0.3s forwards;
}

@keyframes sig-draw {
  to { stroke-dashoffset: 0; }
}

.empty-line {
  display: block;
  height: 0;
  margin: 2px 6px 0;
  border-bottom: 1.5px dashed var(--border-strong, var(--border));
}

.empty-t {
  font-size: var(--text-md, 16px);
  font-weight: 650;
}

.empty-s {
  max-width: 420px;
  margin-top: 4px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.ways {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-3);
  width: 100%;
  margin-top: var(--s-5);
}

.way {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--s-4) var(--s-3);
  text-align: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  cursor: pointer;
  transition: border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
}

.way:hover {
  border-color: color-mix(in srgb, var(--brand) 45%, var(--border));
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.way-ic {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: 6px;
  font-size: 24px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 13px;
}

.way-t {
  font-size: var(--text-sm);
  font-weight: 650;
  color: var(--text);
}

.way-s {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.sig-enter-active {
  transition: opacity 260ms var(--ease-out), transform 260ms var(--ease-out);
}

.sig-leave-active {
  transition: opacity 160ms var(--ease-in), transform 160ms var(--ease-in);
}

.sig-enter-from,
.sig-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.sig-move {
  transition: transform 260ms var(--ease-out);
}

@container settings (max-width: 600px) {
  .ways {
    grid-template-columns: 1fr;
  }

  .way {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 12px;
    row-gap: 0;
    text-align: left;
  }

  .way-ic {
    grid-row: span 2;
    margin-bottom: 0;
  }
}
</style>
