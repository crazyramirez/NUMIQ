<script setup lang="ts">
import type { ImportUndoSummary } from '#shared/types/import'

/** Confirma y elimina una importación con todo lo que creó, mostrando antes qué se va a borrar */
const props = defineProps<{ batchId: number | null, name?: string | null }>()
const emit = defineEmits<{ done: [summary: ImportUndoSummary] }>()
const open = defineModel<boolean>({ default: false })

const toast = useToast()
const plan = ref<ImportUndoSummary | null>(null)
const loading = ref(false)
const failed = ref<string | null>(null)
const deleting = ref(false)

// Sin template literal: $fetch con rutas tipadas se queda sin pila al inferir el tipo
const url = (id: number): string => `/api/imports/${id}/undo`

watch(open, async (v) => {
  if (!v || !props.batchId) return
  plan.value = null
  failed.value = null
  loading.value = true
  try {
    plan.value = await $fetch<ImportUndoSummary>(url(props.batchId))
  }
  catch (err) {
    failed.value = errorMessage(err)
  }
  finally {
    loading.value = false
  }
})

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const rows = computed(() => {
  const p = plan.value
  if (!p) return []
  return [
    { n: p.invoices, icon: 'ph:receipt', label: n(p.invoices, 'factura emitida', 'facturas emitidas'), hint: 'con sus cobros' },
    { n: p.expenses, icon: 'ph:wallet', label: n(p.expenses, 'gasto', 'gastos'), hint: 'con sus pagos' },
    { n: p.contacts, icon: 'ph:address-book', label: n(p.contacts, 'contacto nuevo', 'contactos nuevos'), hint: null },
    { n: p.items, icon: 'ph:package', label: n(p.items, 'producto nuevo', 'productos nuevos'), hint: null },
    { n: p.files, icon: 'ph:files', label: n(p.files, 'archivo', 'archivos'), hint: p.bytes ? fileSize(p.bytes) : null },
  ].filter(r => r.n)
})

const createdNothing = computed(() => !!plan.value && !plan.value.invoices && !plan.value.expenses && !plan.value.contacts && !plan.value.items)

const kept = computed(() => {
  const k = plan.value?.kept
  if (!k) return []
  const conserva = (count: number) => (count === 1 ? 'Se conserva' : 'Se conservan')
  const used = [k.contacts && n(k.contacts, 'contacto', 'contactos'), k.items && n(k.items, 'producto', 'productos')].filter(Boolean)
  return [
    k.invoices ? `${conserva(k.invoices)} ${n(k.invoices, 'factura emitida: tiene', 'facturas emitidas: tienen')} rectificativa.` : null,
    used.length ? `${conserva(k.contacts + k.items)} ${used.join(' y ')} que usas en otros documentos.` : null,
  ].filter((x): x is string => !!x)
})

async function run() {
  if (!props.batchId) return
  deleting.value = true
  try {
    const r = await $fetch<ImportUndoSummary>(url(props.batchId), { method: 'POST' })
    const parts = [
      r.invoices && n(r.invoices, 'emitida', 'emitidas'),
      r.expenses && n(r.expenses, 'gasto', 'gastos'),
      r.contacts && n(r.contacts, 'contacto', 'contactos'),
      r.items && n(r.items, 'producto', 'productos'),
      r.files && n(r.files, 'archivo', 'archivos'),
    ].filter(Boolean)
    toast.success('Importación eliminada', parts.length ? `Se borraron ${parts.join(' · ')}` : undefined)
    open.value = false
    emit('done', r)
  }
  catch (err) {
    toast.error('No se pudo eliminar', errorMessage(err))
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" size="sm" :persistent="deleting">
    <div class="undo">
      <div class="ic" aria-hidden="true"><Icon name="ph:trash-fill" /></div>
      <h2>¿Eliminar esta importación?</h2>
      <p v-if="name" class="name truncate">{{ name }}</p>

      <div v-if="loading" class="what" aria-busy="true" aria-label="Calculando qué se borra">
        <div v-for="i in 3" :key="i" class="w-row"><span class="skeleton sk-ic" /><span class="skeleton sk-t" /></div>
      </div>

      <p v-else-if="failed" class="note bad"><Icon name="ph:warning-circle-fill" aria-hidden="true" /> {{ failed }}</p>

      <template v-else-if="plan">
        <p class="lead">
          {{ createdNothing ? 'No se creó nada en tus facturas ni gastos: se borran los archivos subidos y lo leído.' : 'Se borra todo lo que creó. No se puede deshacer.' }}
        </p>
        <ul v-if="rows.length" class="what">
          <li v-for="r in rows" :key="r.icon" class="w-row">
            <span class="w-ic" aria-hidden="true"><Icon :name="r.icon" /></span>
            <span class="w-l">{{ r.label }}</span>
            <span v-if="r.hint" class="w-h">{{ r.hint }}</span>
          </li>
        </ul>
        <div v-if="plan.filed.length || plan.bank" class="note warn">
          <p v-if="plan.filed.length">
            <Icon name="ph:warning-fill" class="n-ic" aria-hidden="true" />
            <span>Afecta a modelos ya presentados ({{ plan.filed.slice(0, 3).join(', ') }}{{ plan.filed.length > 3 ? '…' : '' }}): puede que tengas que presentar una complementaria.</span>
          </p>
          <p v-if="plan.bank">
            <Icon name="ph:bank" class="n-ic" aria-hidden="true" />
            <span>{{ n(plan.bank, 'movimiento del banco conciliado vuelve', 'movimientos del banco conciliados vuelven') }} a pendiente.</span>
          </p>
        </div>
        <div v-if="kept.length" class="note info">
          <p v-for="k in kept" :key="k"><Icon name="ph:shield-check" class="n-ic" aria-hidden="true" /><span>{{ k }}</span></p>
        </div>
      </template>
    </div>
    <template #footer>
      <UiButton autofocus :disabled="deleting" @click="open = false">Cancelar</UiButton>
      <UiButton variant="danger" icon="ph:trash" :loading="deleting" :disabled="!plan" @click="run">Eliminar todo</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.undo {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding-top: var(--s-2);
}

.ic {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin: 0 auto var(--s-1);
  font-size: 24px;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: 50%;
}

h2 {
  font-size: var(--text-lg);
  text-align: center;
}

.name {
  margin-top: calc(var(--s-2) * -1);
  font-size: var(--text-sm);
  color: var(--text-3);
  text-align: center;
}

.lead {
  font-size: var(--text-sm);
  color: var(--text-2);
  text-align: center;
}

.what {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  list-style: none;
  background: var(--surface-sunken);
  border-radius: var(--r-lg);
}

.w-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-height: 40px;
  padding: 6px 12px;
}

.w-row + .w-row {
  border-top: 1px solid var(--border-subtle);
}

.w-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  font-size: 16px;
  color: var(--text-2);
  background: var(--surface);
  border-radius: var(--r-md);
}

.w-l {
  flex: 1;
  min-width: 0;
  font-weight: 560;
  font-variant-numeric: tabular-nums;
}

.w-h {
  font-size: var(--text-xs);
  color: var(--text-3);
  white-space: nowrap;
}

.sk-ic {
  width: 28px;
  height: 28px;
  border-radius: var(--r-md);
}

.sk-t {
  width: 55%;
  height: 12px;
}

.note {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  font-size: var(--text-sm);
  border-radius: var(--r-lg);
}

.note p {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.n-ic {
  flex: none;
  transform: translateY(2px);
}

.note.warn {
  color: var(--warning);
  background: var(--warning-soft);
}

.note.info {
  color: var(--info);
  background: var(--info-soft);
}

.note.bad {
  flex-direction: row;
  align-items: center;
  color: var(--danger);
  background: var(--danger-soft);
}
</style>
