<script setup lang="ts">
import type { LinkCandidate, LinkCandidatesResult } from '#shared/types/sales-links'

/**
 * Vincular un presupuesto con su factura (o una factura con su presupuesto). Primero aparecen las
 * coincidencias por indicios y enseguida la IA las revisa y reordena; el buscador encuentra cualquier otra.
 */
const props = defineProps<{ docId: number, isQuote: boolean, number: string | null }>()
const emit = defineEmits<{ changed: [] }>()
const open = defineModel<boolean>({ default: false })
const toast = useToast()
const { confirm } = useConfirm()

const list = ref<LinkCandidate[]>([])
const loading = ref(false)
const reviewing = ref(false)
const reviewed = ref(false)
const aiError = ref<string | null>(null)
const q = ref('')
const qDebounced = refDebounced(q, 300)
const busyId = ref<number | null>(null)
let seq = 0

const other = computed(() => (props.isQuote ? { one: 'factura', the: 'la factura', base: '/facturas' } : { one: 'presupuesto', the: 'el presupuesto', base: '/presupuestos' }))
const searching = computed(() => !!qDebounced.value.trim())
const current = computed(() => list.value.filter(c => c.linked))
const suggestions = computed(() => list.value.filter(c => !c.linked))

const fetchList = (query: Record<string, string>) => $fetch<LinkCandidatesResult>(`/api/sales/${props.docId}/link-candidates?${new URLSearchParams(query)}` as string)

async function load() {
  const my = ++seq
  const search = qDebounced.value.trim()
  loading.value = true
  reviewing.value = false
  aiError.value = null
  try {
    const r = await fetchList(search ? { q: search } : {})
    if (my !== seq) return
    list.value = r.candidates
    reviewed.value = false
    loading.value = false
    // La IA repasa las coincidencias por indicios: mientras, ya se ven
    if (!search && r.candidates.some(c => !c.linked)) {
      reviewing.value = true
      const ai = await fetchList({ ai: '1' })
      if (my !== seq) return
      list.value = ai.candidates
      reviewed.value = ai.reviewed
      aiError.value = ai.aiError
    }
  }
  catch (err) {
    if (my === seq) toast.error('No se pudieron buscar coincidencias', errorMessage(err))
  }
  finally {
    if (my === seq) {
      loading.value = false
      reviewing.value = false
    }
  }
}

watch(open, (v) => {
  if (!v) return
  q.value = ''
  list.value = []
  load()
}, { immediate: true })
watch(qDebounced, () => open.value && load())

function level(c: LinkCandidate) {
  if (c.linked) return { label: 'Vinculado', tone: 'success' as const }
  if (c.score >= 85) return { label: 'Muy probable', tone: 'success' as const }
  if (c.score >= 60) return { label: 'Probable', tone: 'brand' as const }
  if (c.score >= 35) return { label: 'Posible', tone: 'neutral' as const }
  return { label: 'Poco probable', tone: 'neutral' as const }
}

async function link(c: LinkCandidate) {
  // Una factura sale de un solo presupuesto: cambiarlo se confirma
  const replacing = c.linkedTo ?? (!props.isQuote ? current.value[0] ?? null : null)
  if (replacing) {
    const ok = await confirm({
      title: props.isQuote ? `¿Cambiar el presupuesto de ${c.number}?` : `¿Cambiar el presupuesto de esta factura?`,
      body: props.isQuote
        ? `Ahora está vinculada a ${replacing.number ?? 'otro presupuesto'}. Pasará a estarlo a ${props.number ?? 'este presupuesto'}.`
        : `Ahora está vinculada a ${replacing.number ?? 'otro presupuesto'}. Pasará a estarlo a ${c.number ?? 'este'}.`,
      confirmLabel: 'Cambiar vínculo',
    })
    if (!ok) return
  }
  busyId.value = c.id
  try {
    await $fetch(`/api/sales/${props.docId}/link` as string, { method: 'POST', body: { targetId: c.id, replace: !!replacing } })
    toast.success(props.isQuote ? 'Presupuesto facturado' : 'Presupuesto vinculado', props.isQuote ? `Vinculado a la factura ${c.number ?? ''}` : `La factura sale de ${c.number ?? 'ese presupuesto'}`)
    open.value = false
    emit('changed')
  }
  catch (err) {
    toast.error('No se pudo vincular', errorMessage(err))
  }
  finally {
    busyId.value = null
  }
}

async function unlink(c: LinkCandidate) {
  const ok = await confirm({
    title: `¿Desvincular ${c.number ?? other.value.the}?`,
    body: 'Los dos documentos se quedan como están: solo dejan de estar relacionados.',
    confirmLabel: 'Desvincular',
  })
  if (!ok) return
  busyId.value = c.id
  try {
    await $fetch(`/api/sales/${props.docId}/unlink` as string, { method: 'POST', body: { targetId: c.id } })
    toast.success('Vínculo eliminado')
    emit('changed')
    await load()
  }
  catch (err) {
    toast.error('No se pudo desvincular', errorMessage(err))
  }
  finally {
    busyId.value = null
  }
}
</script>

<template>
  <UiModal
    v-model="open"
    :title="isQuote ? 'Vincular a una factura' : 'Vincular a un presupuesto'"
    :subtitle="isQuote ? 'Facturas emitidas que pueden corresponder a este presupuesto' : 'Presupuestos de los que puede salir esta factura'"
    size="lg"
  >
    <div class="lk">
      <UiInput v-model="q" icon="ph:magnifying-glass" :placeholder="isQuote ? 'Número, cliente o concepto' : 'Número, cliente o concepto del presupuesto'" :aria-label="`Buscar ${other.one}`" autofocus />

      <div v-if="!searching" class="lk-status" :class="{ on: reviewing }" aria-live="polite">
        <Icon :name="reviewing ? 'ph:sparkle-fill' : aiError ? 'ph:warning-circle' : reviewed ? 'ph:sparkle-fill' : 'ph:lightbulb-filament'" aria-hidden="true" />
        <span v-if="loading">Buscando por cliente, importe, fechas y conceptos…</span>
        <span v-else-if="reviewing">La IA está revisando las coincidencias…</span>
        <span v-else-if="aiError">{{ aiError }}. Se muestran las coincidencias por indicios.</span>
        <span v-else-if="reviewed">Revisado con IA: cliente, importe, fechas y conceptos.</span>
        <span v-else-if="suggestions.length">Coincidencias por cliente, importe, fechas y conceptos.</span>
        <span v-else>No hay {{ isQuote ? 'facturas' : 'presupuestos' }} que encajen. Búscal{{ isQuote ? 'a' : 'o' }} por número, cliente o concepto.</span>
      </div>

      <ul v-if="loading && !list.length" class="lk-list" aria-hidden="true">
        <li v-for="i in 3" :key="i" class="cand sk"><div class="skeleton" style="height: 14px; width: 40%" /><div class="skeleton" style="height: 12px; width: 70%; margin-top: 10px" /></li>
      </ul>

      <template v-else>
        <template v-for="group in [{ key: 'current', title: isQuote ? 'Vinculadas' : 'Vinculado', items: current }, { key: 'sug', title: searching ? 'Resultados' : current.length ? 'Otras posibles' : '', items: suggestions }]" :key="group.key">
          <p v-if="group.items.length && group.title" class="lk-group">{{ group.title }}</p>
          <ul v-if="group.items.length" class="lk-list" :class="{ dim: reviewing }">
            <li v-for="c in group.items" :key="c.id" class="cand" :class="{ linked: c.linked }">
              <div class="c-main">
                <div class="c-top">
                  <NuxtLink :to="`${other.base}/${c.id}`" target="_blank" class="c-num num" :title="`Abrir ${c.number ?? other.one} en otra pestaña`">{{ c.number ?? 'Sin número' }}</NuxtLink>
                  <span class="muted small">{{ fdate(c.issueDate) }}</span>
                  <UiBadge v-if="!searching || c.linked" size="sm" :tone="level(c).tone" :icon="c.ai ? 'ph:sparkle-fill' : undefined">{{ level(c).label }}{{ c.linked ? '' : ` · ${c.score} %` }}</UiBadge>
                </div>
                <p class="c-who">{{ c.contactName ?? 'Sin cliente' }}</p>
                <p v-if="c.concept" class="c-concept">{{ c.concept }}</p>
                <p v-if="c.ai && !c.linked" class="c-ai"><Icon name="ph:sparkle-fill" class="c-ai-ic" aria-hidden="true" /><span>{{ c.ai.reason }}</span></p>
                <ul v-if="c.reasons.length && !c.linked" class="c-reasons">
                  <li v-for="r in c.reasons" :key="r.text" :class="r.tone"><Icon :name="r.tone === 'ok' ? 'ph:check-bold' : 'ph:warning-bold'" aria-hidden="true" />{{ r.text }}</li>
                </ul>
              </div>
              <div class="c-side">
                <p class="num strong">{{ eur(c.total) }}</p>
                <p class="muted small num">Base imponible {{ eur(c.taxBase) }}</p>
                <UiButton v-if="c.linked" size="sm" variant="ghost" icon="ph:link-break" :loading="busyId === c.id" :disabled="busyId != null" @click="unlink(c)">Desvincular</UiButton>
                <UiButton v-else size="sm" :variant="c.score >= 60 && !searching ? 'primary' : 'secondary'" icon="ph:link" :loading="busyId === c.id" :disabled="busyId != null" @click="link(c)">Vincular</UiButton>
              </div>
            </li>
          </ul>
        </template>
        <p v-if="searching && !loading && !list.length" class="lk-empty muted">Nada coincide con «{{ qDebounced }}».</p>
      </template>
    </div>
    <template #footer>
      <UiButton @click="open = false">Cerrar</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.lk {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  container-type: inline-size;
}

.lk-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.lk-status.on :deep(svg) {
  color: var(--ai-text);
  animation: lk-pulse 1.2s ease-in-out infinite;
}

@keyframes lk-pulse {
  50% { opacity: 0.35; }
}

.lk-group {
  margin-top: var(--s-2);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-3);
}

.lk-list,
.c-reasons {
  margin: 0;
  padding: 0;
  list-style: none;
}

.lk-list {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  transition: opacity 0.2s;
}

.lk-list.dim {
  opacity: 0.7;
}

.cand {
  display: flex;
  gap: var(--s-4);
  padding: var(--s-4);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
}

.cand.linked {
  border-color: color-mix(in srgb, var(--success) 45%, var(--border));
  background: color-mix(in srgb, var(--success) 5%, var(--surface));
}

.cand.sk {
  display: block;
}

.c-main {
  flex: 1;
  min-width: 0;
}

.c-top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.c-num {
  font-weight: 650;
  color: var(--text);
  white-space: nowrap;
}

.c-num:hover {
  color: var(--brand);
  text-decoration: underline;
}

.c-who {
  margin-top: 4px;
  font-weight: 550;
}

.c-concept {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.c-ai {
  display: flex;
  gap: 6px;
  margin-top: var(--s-2);
  font-size: var(--text-sm);
  color: var(--text);
}

.c-ai-ic {
  flex: none;
  font-size: 15px;
  margin-top: 3px;
  color: var(--ai-text);
}

.c-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  margin-top: var(--s-2);
}

.c-reasons li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--r-full);
  font-size: var(--text-xs);
  background: var(--surface-sunken);
  color: var(--text-3);
}

.c-reasons li.ok :deep(svg) {
  color: var(--success);
}

.c-reasons li.warn {
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--text);
}

.c-reasons li.warn :deep(svg) {
  color: var(--warning);
}

.c-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  text-align: right;
  white-space: nowrap;
}

.c-side :deep(.btn),
.c-side > :last-child {
  margin-top: var(--s-2);
}

.lk-empty {
  padding: var(--s-6) 0;
  text-align: center;
}

@container (max-width: 480px) {
  .cand {
    flex-direction: column;
    gap: var(--s-3);
  }

  .c-side {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 10px;
    text-align: left;
  }

  .c-side > :last-child {
    margin-top: 0;
    margin-left: auto;
  }
}
</style>
