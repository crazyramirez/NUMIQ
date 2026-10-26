<script setup lang="ts">
import type { DroppedFile } from '~/components/docs/Dropzone.vue'

/** Importar un extracto: Norma 43, Excel o CSV de cualquier banco */
const props = defineProps<{ accounts: Array<{ id: number, name: string }> }>()
const emit = defineEmits<{ imported: [result: ImportResult] }>()
const open = defineModel<boolean>({ default: false })

export interface ImportResult {
  accountId: number
  accountName: string
  imported: number
  duplicates: number
  from: string
  to: string
  suggested: number
  /** Copia del extracto en Documentos → Archivo → Banco (already: ese archivo ya estaba guardado) */
  archived: { id: number | null, year: number, quarter: number, already: boolean } | null
}

const file = ref<File | null>(null)
const accountId = ref<number | 'auto' | 'new'>('auto')
const accountName = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

watch(open, (v) => {
  if (!v) return
  file.value = null
  error.value = null
  accountName.value = ''
  accountId.value = 'auto'
})

const accountOptions = computed(() => [
  { value: 'auto', label: 'Detectar la cuenta por el IBAN' },
  ...props.accounts.map(a => ({ value: a.id, label: a.name })),
  { value: 'new', label: 'Nueva cuenta…' },
])

function onFiles(files: DroppedFile[]) {
  error.value = null
  file.value = files[0]?.file ?? null
}

async function submit() {
  if (!file.value) {
    error.value = 'Elige el archivo del extracto'
    return
  }
  busy.value = true
  error.value = null
  try {
    const fd = new FormData()
    fd.append('file', file.value)
    if (typeof accountId.value === 'number') fd.append('accountId', String(accountId.value))
    if (accountId.value === 'new' && accountName.value.trim()) fd.append('accountName', accountName.value.trim())
    const r = await $fetch<ImportResult>('/api/bank/import', { method: 'POST', body: fd })
    open.value = false
    emit('imported', r)
  }
  catch (err) {
    error.value = errorMessage(err)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" title="Importar extracto del banco" subtitle="NUMIQ lee los movimientos y busca a qué factura o gasto corresponde cada uno." size="md" :persistent="busy">
    <div class="imp">
      <DocsDropzone
        v-if="!file"
        title="Arrastra aquí el extracto"
        hint="Norma 43 (AEB 43), Excel o CSV · de cualquier banco"
        accept=".n43,.aeb,.q43,.csb,.txt,.dat,.csv,.tsv,.xls,.xlsx,.ods"
        :multiple="false"
        @files="onFiles"
      />
      <div v-else class="picked">
        <span class="p-ic" aria-hidden="true"><Icon :name="/\.(xlsx?|ods|csv)$/i.test(file.name) ? 'ph:file-xls' : 'ph:bank'" /></span>
        <div class="grow min0">
          <p class="p-name truncate">{{ file.name }}</p>
          <p class="p-size">{{ fileSize(file.size) }}</p>
        </div>
        <UiButton variant="ghost" size="sm" :disabled="busy" @click="file = null">Cambiar</UiButton>
      </div>

      <UiSelect v-model="accountId" :options="accountOptions" label="Cuenta" />
      <UiInput v-if="accountId === 'new'" v-model="accountName" label="Nombre de la cuenta" placeholder="Ej. BBVA empresa" />

      <details class="how">
        <summary><Icon name="ph:question" aria-hidden="true" /> ¿Cómo descargo el extracto?</summary>
        <p>En la banca online, entra en la cuenta → <strong>Movimientos</strong> → elige las fechas → <strong>Descargar</strong> o <strong>Exportar</strong>. Si te deja elegir, usa <strong>Norma 43</strong> (también llamado AEB 43 o cuaderno 43): es el más completo. Excel o CSV también valen.</p>
        <p>Puedes importar extractos que se solapan: los movimientos repetidos se descartan solos.</p>
      </details>

      <p v-if="error" class="err" role="alert"><Icon name="ph:warning-circle-fill" aria-hidden="true" /> {{ error }}</p>
    </div>
    <template #footer>
      <UiButton variant="ghost" :disabled="busy" @click="open = false">Cancelar</UiButton>
      <UiButton variant="primary" icon="ph:upload-simple" :loading="busy" :disabled="!file" @click="submit">{{ busy ? 'Leyendo movimientos…' : 'Importar' }}</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.imp {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.picked {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 12px 14px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.p-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  font-size: 20px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: var(--r-md);
}

.p-name {
  font-weight: 600;
}

.p-size {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.how {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.how summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 550;
  color: var(--text-2);
  cursor: pointer;
  list-style: none;
}

.how summary::-webkit-details-marker {
  display: none;
}

.how p {
  margin-top: var(--s-2);
  line-height: 1.55;
  color: var(--text-3);
}

.err {
  display: flex;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--danger);
}

.err :deep(svg) {
  flex: none;
  margin-top: 2px;
}

.min0 {
  min-width: 0;
}
</style>
