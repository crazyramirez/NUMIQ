<script setup lang="ts">
import type { DroppedFile } from '~/components/docs/Dropzone.vue'

/**
 * Presentación guiada de un modelo: casillas calculadas para copiar, formulario oficial de la Sede
 * (el contribuyente se identifica con Cl@ve, DNIe o certificado y firma allí) y registro del
 * justificante leído con IA.
 */
const props = defineProps<{ model: string | null, year: number, quarter: number | null }>()
const emit = defineEmits<{ filed: [] }>()
const open = defineModel<boolean>({ default: false })

interface Draft {
  model: string
  title: string
  period: string
  quarter: number | null
  year: number
  boxes: Array<{ box: string, label: string, value: number | string, strong?: boolean }>
  result: number
  outcome: 'ingresar' | 'devolver' | 'compensar' | 'cero'
  dueDate: string | null
  presentUrl: string
  infoUrl: string
  notes: string[]
  table?: { columns: string[], rows: Array<Array<string | number>>, numeric: number[] }
}

interface Receipt {
  fileId: number
  model: string | null
  year: number | null
  period: string | null
  csv: string | null
  nrc: string | null
  amount: number | null
  outcome: string | null
  presentedAt: string | null
  nifMatches: boolean | null
}

const toast = useToast()
// El gestor consulta las casillas y puede ir a la Sede, pero no registra la presentación en la empresa
const { readOnly } = useMe()
const draft = ref<Draft | null>(null)
const loading = ref(false)
const receipt = ref<Receipt | null>(null)
const reading = ref(false)
const saving = ref(false)
const form = ref({ csv: '', filedAt: todayISO(), result: 0 })
const copiedBox = ref<string | null>(null)

watch(open, async (v) => {
  if (!v || !props.model) return
  draft.value = null
  receipt.value = null
  loading.value = true
  try {
    draft.value = await $fetch<Draft>('/api/taxes/draft', { query: { model: props.model, year: props.year, ...(props.quarter ? { quarter: props.quarter } : {}) } })
    form.value = { csv: '', filedAt: todayISO(), result: draft.value.result }
  }
  catch (err) {
    toast.error('No se pudo preparar el modelo', errorMessage(err))
    open.value = false
  }
  finally {
    loading.value = false
  }
})

/** Formato de las casillas de la AEAT: coma decimal y sin separador de miles */
const boxValue = (b: Draft['boxes'][number]) => {
  if (typeof b.value !== 'number') return b.value
  // Tipos, porcentajes y nº de perceptores van tal cual; los importes («Base al 21 %» incluida), con dos decimales
  return /^(tipo\b.*%|porcentaje|% atribuible)|nº|declarados/i.test(b.label) ? String(b.value).replace('.', ',') : b.value.toFixed(2).replace('.', ',')
}

async function copy(text: string, key: string) {
  const ok = await copyToClipboard(text)
  if (ok) {
    copiedBox.value = key
    setTimeout(() => (copiedBox.value = null), 1400)
  }
}

const allText = computed(() => draft.value?.boxes.map(b => `[${b.box}] ${b.label}: ${boxValue(b)}`).join('\n') ?? '')

const informative = computed(() => !!draft.value?.table)
const tableTsv = computed(() => draft.value?.table ? [draft.value.table.columns, ...draft.value.table.rows].map(r => r.map(c => (typeof c === 'number' ? c.toFixed(2).replace('.', ',') : c)).join('\t')).join('\n') : '')

function downloadCsv() {
  if (!draft.value?.table) return
  const t = draft.value.table
  const csv = [t.columns, ...t.rows].map(r => r.map(c => (typeof c === 'number' ? c.toFixed(2).replace('.', ',') : `"${String(c).replace(/"/g, '""')}"`)).join(';')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  a.download = `modelo-${draft.value.model}-${draft.value.year}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const OUTCOME: Record<Draft['outcome'], { label: string, cls: string }> = {
  ingresar: { label: 'A ingresar', cls: 'pay' },
  devolver: { label: 'A devolver', cls: 'back' },
  compensar: { label: 'A compensar', cls: 'back' },
  cero: { label: 'Sin cuota', cls: 'zero' },
}

async function readReceipt(files: DroppedFile[]) {
  const f = files[0]
  if (!f) return
  reading.value = true
  try {
    const body = new FormData()
    body.append('file', f.file, f.file.name)
    const r = await $fetch<Receipt>('/api/taxes/receipt', { method: 'POST', body })
    receipt.value = r
    form.value = {
      csv: r.csv ?? '',
      filedAt: r.presentedAt && /^\d{4}-\d{2}-\d{2}$/.test(r.presentedAt) ? r.presentedAt : todayISO(),
      result: r.amount != null ? (r.outcome === 'devolver' || r.outcome === 'compensar' ? -Math.abs(r.amount) : r.amount) : draft.value?.result ?? 0,
    }
  }
  catch (err) {
    toast.error('No se pudo leer el justificante', errorMessage(err))
  }
  finally {
    reading.value = false
  }
}

const mismatch = computed(() => {
  const r = receipt.value
  const d = draft.value
  if (!r || !d) return []
  const out: string[] = []
  if (r.model && r.model !== d.model) out.push(`El justificante es del modelo ${r.model}, no del ${d.model}`)
  if (r.period && r.period !== d.period) out.push(`El justificante es del periodo ${r.period}`)
  if (r.year && r.year !== d.year) out.push(`El justificante es del ejercicio ${r.year}`)
  if (r.nifMatches === false) out.push('El NIF del justificante no es el de tu empresa')
  if (r.amount != null && Math.abs(Math.abs(r.amount) - Math.abs(d.result)) > 0.5) out.push(`Presentaste ${eur(Math.abs(r.amount))}; NUMIQ calculaba ${eur(Math.abs(d.result))}`)
  return out
})

async function markFiled() {
  if (!draft.value) return
  saving.value = true
  try {
    await $fetch('/api/taxes/filings', {
      method: 'POST',
      body: {
        model: draft.value.model,
        year: draft.value.year,
        period: draft.value.period,
        result: Number(form.value.result) || 0,
        csv: form.value.csv || null,
        filedAt: form.value.filedAt,
        receiptFileId: receipt.value?.fileId ?? null,
        boxes: Object.fromEntries(draft.value.boxes.filter(b => typeof b.value === 'number').map(b => [b.box, b.value as number])),
      },
    })
    toast.success(`Modelo ${draft.value.model} marcado como presentado`, receipt.value ? 'Justificante guardado en el archivo (Impuestos)' : undefined)
    emit('filed')
    open.value = false
  }
  catch (err) {
    toast.error('No se pudo guardar', errorMessage(err))
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal v-model="open" size="lg" :title="draft ? `Modelo ${draft.model} · ${draft.quarter ? `${draft.period} ` : ''}${draft.year}` : (readOnly ? 'Modelo' : 'Presentar modelo')" :subtitle="draft?.title">
    <div v-if="loading || !draft" class="stack gap-3">
      <div class="skeleton" style="height: 64px" />
      <div v-for="i in 6" :key="i" class="skeleton" style="height: 30px" />
    </div>

    <div v-else class="steps">
      <div class="result" :class="informative ? 'info' : OUTCOME[draft.outcome].cls">
        <div v-if="informative">
          <p class="r-l">Declaración informativa</p>
          <p class="r-v num">{{ draft.table!.rows.length }} <span class="r-u">{{ draft.table!.rows.length === 1 ? 'declarado' : 'declarados' }}</span></p>
        </div>
        <div v-else>
          <p class="r-l">{{ OUTCOME[draft.outcome].label }}</p>
          <p class="r-v num">{{ eur(Math.abs(draft.result)) }}</p>
        </div>
        <p v-if="draft.dueDate" class="r-due"><Icon name="ph:calendar-blank" aria-hidden="true" /> Plazo hasta el {{ fdate(draft.dueDate) }}<br><span class="muted">{{ relDays(draft.dueDate) }}</span></p>
      </div>

      <!-- 1 -->
      <section class="step">
        <div class="s-head">
          <span class="s-n">1</span>
          <h3 class="s-t">{{ draft.boxes.some(b => b.box) ? 'Revisa las casillas' : 'Revisa los importes' }}</h3>
          <UiButton size="sm" variant="ghost" :icon="copiedBox === 'all' ? 'ph:check' : 'ph:copy'" @click="copy(allText, 'all')">{{ copiedBox === 'all' ? 'Copiadas' : 'Copiar todas' }}</UiButton>
        </div>
        <div class="boxes">
          <div v-for="(b, i) in draft.boxes" :key="`${b.box}-${i}`" class="box" :class="{ strong: b.strong, nobox: !b.box }">
            <span v-if="b.box" class="b-n num">{{ b.box }}</span>
            <span class="b-l">{{ b.label }}</span>
            <button type="button" class="b-v num" :title="`Copiar casilla ${b.box}`" @click="copy(boxValue(b), b.box)">
              {{ boxValue(b) }}
              <Icon :name="copiedBox === b.box ? 'ph:check' : 'ph:copy'" class="b-c" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div v-if="draft.table?.rows.length" class="decl">
          <div class="d-act">
            <UiButton size="sm" variant="ghost" :icon="copiedBox === 'table' ? 'ph:check' : 'ph:copy'" @click="copy(tableTsv, 'table')">{{ copiedBox === 'table' ? 'Copiada' : 'Copiar tabla' }}</UiButton>
            <UiButton size="sm" variant="ghost" icon="ph:file-csv" @click="downloadCsv">CSV</UiButton>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th v-for="(c, i) in draft.table.columns" :key="c" :class="{ r: draft.table.numeric.includes(i) }">{{ c }}</th></tr></thead>
              <tbody>
                <tr v-for="(row, ri) in draft.table.rows" :key="ri">
                  <td v-for="(c, i) in row" :key="i" :class="{ r: draft.table.numeric.includes(i), num: draft.table.numeric.includes(i) }">{{ typeof c === 'number' ? eur(c) : c }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <ul v-if="draft.notes.length" class="notes">
          <li v-for="n in draft.notes" :key="n"><Icon name="ph:lightbulb-filament" aria-hidden="true" /> {{ n }}</li>
        </ul>
      </section>

      <!-- 2 -->
      <section class="step">
        <div class="s-head">
          <span class="s-n">2</span>
          <h3 class="s-t">Preséntalo en la Sede de la AEAT</h3>
        </div>
        <p class="s-p">Entra con <b>Cl@ve</b>, <b>DNI electrónico</b> o tu <b>certificado digital</b>, rellena las casillas con estos valores, firma y presenta. Si sale a ingresar, puedes domiciliarlo o pagarlo con NRC.</p>
        <div class="row gap-2 wrap">
          <a :href="draft.presentUrl" target="_blank" rel="noopener" class="btn-link primary"><Icon name="ph:arrow-square-out" aria-hidden="true" /> Abrir el formulario oficial</a>
          <a :href="draft.infoUrl" target="_blank" rel="noopener" class="btn-link"><Icon name="ph:info" aria-hidden="true" /> Información del modelo</a>
        </div>
      </section>

      <!-- 3 -->
      <section v-if="!readOnly" class="step">
        <div class="s-head">
          <span class="s-n">3</span>
          <h3 class="s-t">Guarda el justificante</h3>
        </div>
        <DocsDropzone v-if="!receipt" compact :multiple="false" accept=".pdf,image/*" :title="reading ? 'Leyendo el justificante…' : 'Arrastra el justificante (PDF o foto)'" hint="La IA lee el CSV, la fecha y el importe, y lo guarda en el archivo del trimestre" :disabled="reading" @files="readReceipt" />
        <div v-else class="rcpt">
          <p class="rc-ok"><Icon name="ph:check-circle-fill" aria-hidden="true" /> Justificante leído y guardado en Documentos → Archivo → Impuestos</p>
          <ul v-if="mismatch.length" class="mism">
            <li v-for="m in mismatch" :key="m"><Icon name="ph:warning-fill" aria-hidden="true" /> {{ m }}</li>
          </ul>
        </div>
        <div class="form-grid filed">
          <UiInput v-model="form.csv" class="c-5 upper" label="CSV del justificante" placeholder="Código seguro de verificación" />
          <UiInput v-model="form.filedAt" class="c-4" label="Fecha de presentación" type="date" />
          <UiInput v-model="form.result" class="c-3" label="Resultado" numeric suffix="€" />
        </div>
      </section>
    </div>

    <template v-if="draft" #footer>
      <UiButton variant="ghost" @click="open = false">Cerrar</UiButton>
      <UiButton v-if="!readOnly" variant="primary" icon="ph:seal-check" :loading="saving" @click="markFiled">Marcar como presentado</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.steps {
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  padding: var(--s-4) var(--s-5);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.result.pay {
  background: color-mix(in srgb, var(--warning-solid) 8%, var(--surface));
  border-color: color-mix(in srgb, var(--warning-solid) 30%, var(--border));
}

.result.info {
  background: var(--info-soft);
  border-color: color-mix(in srgb, var(--info-solid) 30%, var(--border));
}

.r-u {
  font-size: var(--text-md);
  font-weight: 560;
  color: var(--text-2);
}

.box.nobox {
  grid-template-columns: minmax(0, 1fr) auto;
}

.decl {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}

.d-act {
  display: flex;
  justify-content: flex-end;
  gap: var(--s-2);
  padding: 6px;
  border-bottom: 1px solid var(--border-subtle);
}

.decl .table-wrap {
  max-height: 300px;
  overflow: auto;
}

.decl :deep(td),
.decl :deep(th) {
  white-space: nowrap;
}

.result.back {
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success-solid) 30%, var(--border));
}

.r-l {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
}

.r-v {
  font-size: var(--text-3xl);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.r-due {
  display: flex;
  gap: 6px;
  font-size: var(--text-sm);
  text-align: right;
}

.step {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.s-head {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.s-n {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-full);
}

.s-t {
  flex: 1;
  font-size: var(--text-md);
  font-weight: 640;
}

.s-p {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.boxes {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}

.box {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--s-3);
  padding: 6px 6px 6px 12px;
  font-size: var(--text-sm);
}

.box + .box {
  border-top: 1px solid var(--border-subtle);
}

.box.strong {
  background: var(--surface-2);
  font-weight: 600;
}

.b-n {
  display: inline-grid;
  place-items: center;
  height: 22px;
  font-size: var(--text-xs);
  font-weight: 650;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-sm);
}

.b-l {
  color: var(--text-2);
}

.b-v {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
  justify-content: flex-end;
  padding: 5px 9px;
  font-weight: 600;
  border-radius: var(--r-md);
  transition: background var(--t-fast);
}

.b-v:hover {
  background: var(--surface-hover);
}

.b-c {
  color: var(--text-4);
}

.notes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.notes li {
  display: flex;
  gap: 6px;
}

.btn-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 14px;
  font-weight: 560;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  transition: background var(--t-fast);
}

.btn-link:hover {
  background: var(--surface-hover);
}

.btn-link.primary {
  color: var(--on-brand);
  background: var(--brand);
  border-color: var(--brand);
}

.btn-link.primary:hover {
  background: var(--brand-hover);
}

.rcpt {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rc-ok {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 560;
  color: var(--success);
}

.mism {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 12px;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: var(--r-md);
}

.filed {
  margin-top: var(--s-2);
}

@media (max-width: 560px) {
  .result {
    flex-direction: column;
    align-items: flex-start;
  }

  .r-due {
    text-align: left;
  }

  .box {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .b-v {
    grid-column: 2;
    justify-self: start;
    min-width: 0;
    padding-left: 0;
  }
}
</style>
