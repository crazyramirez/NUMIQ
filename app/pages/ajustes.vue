<script setup lang="ts">
useHead({ title: 'Ajustes · NUMIQ' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const { refresh: refreshMe } = useMe()

const SECTIONS = [
  { id: 'empresa', label: 'Empresa', icon: 'ph:buildings' },
  { id: 'numeracion', label: 'Numeración', icon: 'ph:list-numbers' },
  { id: 'ia', label: 'Inteligencia artificial', icon: 'ph:sparkle' },
  { id: 'diseno', label: 'Diseño de factura', icon: 'ph:paint-brush' },
  { id: 'firmas', label: 'Firmas', icon: 'ph:signature' },
  { id: 'cobros', label: 'Cobros', icon: 'ph:bell-ringing' },
  { id: 'gestoria', label: 'Gestoría', icon: 'ph:briefcase' },
  { id: 'equipo', label: 'Equipo', icon: 'ph:users-three' },
  { id: 'cuenta', label: 'Tu cuenta', icon: 'ph:user-circle' },
  { id: 'copia', label: 'Copia de seguridad', icon: 'ph:cloud-arrow-down' },
  { id: 'novedades', label: 'Novedades', icon: 'ph:rocket-launch' },
] as const
type SectionId = typeof SECTIONS[number]['id']

const news = useNews()
const section = computed<SectionId>({
  get: () => (SECTIONS.some(s => s.id === route.query.s) ? route.query.s as SectionId : 'empresa'),
  set: s => router.replace({ query: { ...route.query, s } }),
})

// En pestañas (móvil, tableta) la sección activa siempre a la vista, también al entrar por enlace (?s=diseno)
const snavEl = ref<HTMLElement | null>(null)
function revealSection(smooth: boolean) {
  const nav = snavEl.value
  const el = nav?.querySelector<HTMLElement>('.snav-item.on')
  if (!nav || !el || nav.scrollWidth <= nav.clientWidth) return
  const left = el.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft
  nav.scrollTo({ left: left - (nav.clientWidth - el.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' })
}
watch(section, () => nextTick(() => revealSection(true)))
onMounted(() => revealSection(false))

const { data: company, status, error, refresh } = await useFetch('/api/companies/current', { lazy: true })
const { data: series, refresh: refreshSeries } = await useFetch<any[]>('/api/series', { lazy: true })
const { data: ai, refresh: refreshAi } = await useFetch('/api/ai/status', { lazy: true })

// ─── Edición de Series de Numeración ───
const seriesModalOpen = ref(false)
const seriesModalMode = ref<'create' | 'edit'>('edit')
const savingSeries = ref(false)
const seriesFormError = ref<string | null>(null)

interface SeriesFormData {
  id: number | null
  kind: 'quote' | 'proforma' | 'invoice' | 'rectifying'
  name: string
  prefix: string
  padding: number
  yearlyReset: boolean
  nextSequence: number
  isDefault: boolean
  isOriginalDefault: boolean
  issuedCount: number
  maxIssuedSequence: number
}

const seriesForm = reactive<SeriesFormData>({
  id: null,
  kind: 'invoice',
  name: '',
  prefix: '',
  padding: 4,
  yearlyReset: true,
  nextSequence: 1,
  isDefault: false,
  isOriginalDefault: false,
  issuedCount: 0,
  maxIssuedSequence: 0,
})

const seriesKindOptions = [
  { value: 'invoice', label: 'Factura' },
  { value: 'rectifying', label: 'Factura rectificativa' },
  { value: 'quote', label: 'Presupuesto' },
  { value: 'proforma', label: 'Factura proforma' },
]

const paddingOptions = [
  { value: 3, label: '3 dígitos (ej. 001)' },
  { value: 4, label: '4 dígitos (ej. 0001) · Estándar' },
  { value: 5, label: '5 dígitos (ej. 00001)' },
  { value: 6, label: '6 dígitos (ej. 000001)' },
]

const previewSeriesNumber = computed(() => {
  const p = seriesForm.prefix || ''
  const year = new Date().getFullYear()
  const seq = String(Math.max(1, seriesForm.nextSequence || 1)).padStart(seriesForm.padding || 4, '0')
  return seriesForm.yearlyReset ? `${p}${year}-${seq}` : `${p}${seq}`
})

function openEditSeries(s: any) {
  seriesModalMode.value = 'edit'
  seriesFormError.value = null
  seriesForm.id = s.id
  seriesForm.kind = s.kind
  seriesForm.name = s.name
  seriesForm.prefix = s.prefix ?? ''
  seriesForm.padding = s.padding ?? 4
  seriesForm.yearlyReset = s.yearlyReset ?? true
  seriesForm.nextSequence = s.nextSequence ?? 1
  seriesForm.isDefault = s.isDefault ?? false
  seriesForm.isOriginalDefault = s.isDefault ?? false
  seriesForm.issuedCount = s.issuedCount ?? 0
  seriesForm.maxIssuedSequence = s.maxIssuedSequence ?? 0
  seriesModalOpen.value = true
}

function openNewSeries() {
  seriesModalMode.value = 'create'
  seriesFormError.value = null
  seriesForm.id = null
  seriesForm.kind = 'invoice'
  seriesForm.name = 'Serie B'
  seriesForm.prefix = 'B'
  seriesForm.padding = 4
  seriesForm.yearlyReset = true
  seriesForm.nextSequence = 1
  seriesForm.isDefault = false
  seriesForm.isOriginalDefault = false
  seriesForm.issuedCount = 0
  seriesForm.maxIssuedSequence = 0
  seriesModalOpen.value = true
}

async function saveSeries() {
  seriesFormError.value = null
  if (seriesForm.issuedCount > 0 && seriesForm.nextSequence <= seriesForm.maxIssuedSequence) {
    seriesFormError.value = `El número debe ser mayor que ${seriesForm.maxIssuedSequence} (último documento ya emitido)`
    return
  }

  savingSeries.value = true
  try {
    if (seriesModalMode.value === 'create') {
      await $fetch('/api/series', {
        method: 'POST',
        body: {
          kind: seriesForm.kind,
          name: seriesForm.name.trim(),
          prefix: seriesForm.prefix.trim(),
          padding: Number(seriesForm.padding),
          yearlyReset: seriesForm.yearlyReset,
          nextSequence: Number(seriesForm.nextSequence),
          isDefault: seriesForm.isDefault,
        },
      })
      toast.success('Serie creada', `Siguiente número: ${previewSeriesNumber.value}`)
    }
    else {
      await $fetch(`/api/series/${seriesForm.id}`, {
        method: 'PATCH',
        body: {
          name: seriesForm.name.trim(),
          prefix: seriesForm.prefix.trim(),
          padding: Number(seriesForm.padding),
          yearlyReset: seriesForm.yearlyReset,
          nextSequence: Number(seriesForm.nextSequence),
          isDefault: seriesForm.isDefault,
        },
      })
      toast.success('Serie actualizada', `Siguiente número: ${previewSeriesNumber.value}`)
    }
    seriesModalOpen.value = false
    await refreshSeries()
  }
  catch (err) {
    seriesFormError.value = errorMessage(err, 'No se pudo guardar la serie')
    toast.error('Error al guardar la serie', errorMessage(err))
  }
  finally {
    savingSeries.value = false
  }
}

interface CompanyForm {
  kind: 'autonomo' | 'sociedad'
  legalName: string
  tradeName: string | null
  nif: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  province: string | null
  iban: string | null
  activityCode: string | null
  activityDescription: string | null
  taxRegime: 'directa_simplificada' | 'directa_normal' | 'modulos' | 'sociedades'
  vatRegime: 'general' | 'recargo_equivalencia' | 'criterio_caja' | 'exento'
  defaultIrpfRate: number | null
  defaultVatRate: number | null
  paymentTermsDays: number | null
  activityStartDate: string | null
  verifactuEnabled: boolean
  brandColor: string | null
  invoiceFooter: string | null
}

const FIELDS: Array<keyof CompanyForm> = [
  'kind', 'legalName', 'tradeName', 'nif', 'email', 'phone', 'website', 'address', 'postalCode', 'city', 'province', 'iban',
  'activityCode', 'activityDescription', 'taxRegime', 'vatRegime', 'defaultIrpfRate', 'defaultVatRate', 'paymentTermsDays',
  'activityStartDate', 'verifactuEnabled', 'brandColor', 'invoiceFooter',
]

const form = ref<CompanyForm | null>(null)
const original = ref('')
const errors = ref<Record<string, string>>({})
const saving = ref(false)

function load() {
  if (!company.value) return
  const c = company.value as unknown as Record<string, unknown>
  form.value = Object.fromEntries(FIELDS.map(k => [k, c[k] ?? null])) as unknown as CompanyForm
  if (!form.value.brandColor) form.value.brandColor = null
  original.value = JSON.stringify(form.value)
  errors.value = {}
}
watch(company, load, { immediate: true })

const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== original.value)
const canEdit = computed(() => company.value?.role === 'owner' || company.value?.role === 'admin')

const nifCheck = computed(() => {
  const v = form.value?.nif?.trim()
  if (!v) return null
  return validateNif(v)
})
const nifError = computed(() => errors.value.nif || (nifCheck.value && !nifCheck.value.valid ? 'NIF no válido: revisa la letra o el dígito de control' : null))
const nifHint = computed(() => {
  const k = nifCheck.value?.valid ? nifCheck.value.kind : null
  return k === 'dni' ? 'DNI válido' : k === 'nie' ? 'NIE válido' : k === 'cif' ? 'NIF de sociedad válido' : 'DNI, NIE o NIF de la sociedad'
})

const kindOptions = [
  { value: 'autonomo', label: 'Autónomo (persona física)' },
  { value: 'sociedad', label: 'Sociedad (SL, SA…)' },
]
const taxOptions = computed(() => Object.entries(TAX_REGIMES)
  .filter(([k]) => (form.value?.kind === 'sociedad' ? k === 'sociedades' : k !== 'sociedades'))
  .map(([value, r]) => ({ value, label: r.label })))
const vatOptions = Object.entries(VAT_REGIMES).map(([value, r]) => ({ value, label: r.label }))
const vatRateOptions = VAT_RATES.map(v => ({ value: v, label: `${v} %` }))

// Al cambiar de autónomo a sociedad (o al revés), un régimen fiscal coherente
watch(() => form.value?.kind, (k, prev) => {
  if (!form.value || !prev || k === prev) return
  if (k === 'sociedad') form.value.taxRegime = 'sociedades'
  else if (form.value.taxRegime === 'sociedades') form.value.taxRegime = 'directa_simplificada'
})

const nullIfEmpty = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

const autoSaving = ref(false)
const lastSaved = ref<Date | null>(null)

async function save(silent: boolean | Event = false) {
  const isSilent = typeof silent === 'boolean' ? silent : false
  if (!form.value || !dirty.value) return
  if (nifError.value) {
    if (!isSilent) section.value = 'empresa'
    return
  }
  saving.value = true
  if (isSilent) autoSaving.value = true
  errors.value = {}
  const f = form.value
  const body = {
    ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, nullIfEmpty(v)])),
    legalName: f.legalName,
    nif: f.nif,
    defaultIrpfRate: f.defaultIrpfRate ?? 0,
    defaultVatRate: f.defaultVatRate ?? 21,
    paymentTermsDays: f.paymentTermsDays ?? 30,
    brandColor: f.brandColor && /^#[0-9a-f]{6}$/i.test(f.brandColor) ? f.brandColor : null,
  }
  try {
    await $fetch('/api/companies/current', { method: 'PATCH', body })
    original.value = JSON.stringify(form.value)
    lastSaved.value = new Date()
    if (!isSilent) toast.success('Cambios guardados')
    await Promise.all([refresh(), refreshMe()])
  }
  catch (err) {
    const field = errorField(err)
    if (field) {
      errors.value = { [field]: errorMessage(err) }
      if (!isSilent) section.value = 'empresa'
    }
    if (!isSilent) toast.error('No se han guardado los cambios', errorMessage(err))
  }
  finally {
    saving.value = false
    autoSaving.value = false
  }
}

const debouncedAutoSave = useDebounceFn(() => {
  if (dirty.value && canEdit.value && !nifError.value && form.value?.legalName?.trim()) {
    save(true)
  }
}, 800)

watch(form, () => {
  if (dirty.value && canEdit.value) {
    debouncedAutoSave()
  }
}, { deep: true })

function discard() {
  if (original.value) form.value = JSON.parse(original.value)
  errors.value = {}
}

onBeforeRouteLeave(async (to, from) => {
  if (dirty.value && canEdit.value && !nifError.value && form.value?.legalName?.trim()) {
    await save(true)
    return true
  }
  if (!dirty.value || to.path === from.path) return true
  return confirm({ title: '¿Salir sin guardar?', body: 'Tienes cambios en los ajustes de la empresa que se perderán.', confirmLabel: 'Salir sin guardar', danger: true })
})

/** El diseño guarda su color como color de marca: el formulario de empresa lo adopta sin quedar "con cambios" */
function onDesignSaved(accent: string) {
  if (!form.value) return
  form.value.brandColor = accent
  const o = JSON.parse(original.value || '{}')
  o.brandColor = accent
  original.value = JSON.stringify(o)
}
</script>

<template>
  <div class="page settings">
    <header class="page-head rise">
      <div>
        <h1>Ajustes</h1>
        <p class="sub">Datos fiscales, numeración e integraciones de tu empresa.</p>
      </div>
      <div v-if="section === 'empresa'" class="auto-save-status">
        <span v-if="autoSaving" class="status-indicator saving"><span class="spin" /> Guardando automáticamente…</span>
        <span v-else-if="lastSaved && !dirty" class="status-indicator saved"><Icon name="ph:check-circle-fill" /> Guardado</span>
      </div>
    </header>

    <div class="layout">
      <nav ref="snavEl" class="snav rise" style="--i: 1" aria-label="Secciones de ajustes">
        <button
          v-for="s in SECTIONS"
          :key="s.id"
          type="button"
          class="snav-item"
          :class="{ on: section === s.id }"
          :aria-current="section === s.id ? 'page' : undefined"
          @click="section = s.id"
        >
          <Icon :name="section === s.id ? `${s.icon}-fill` : s.icon" class="snav-ic" aria-hidden="true" />
          <span class="truncate">{{ s.label }}</span>
          <span v-if="s.id === 'novedades' && news.unseen.value" class="snav-new num" :aria-label="`${news.unseen.value} sin ver`">{{ news.unseen.value }}</span>
        </button>
      </nav>

      <div class="panel">
        <UiCard v-if="error && !company">
          <UiEmpty icon="ph:cloud-warning" title="No hemos podido cargar los ajustes" :text="errorMessage(error)">
            <UiButton icon="ph:arrow-clockwise" @click="refresh()">Reintentar</UiButton>
          </UiEmpty>
        </UiCard>

        <div v-else-if="!form" class="card loading-card" :aria-busy="status === 'pending'">
          <div v-for="i in 6" :key="i" class="sk-row">
            <div class="skeleton" style="width: 30%; height: 12px" />
            <div class="skeleton" style="width: 100%; height: 38px; margin-top: 8px" />
          </div>
        </div>

        <template v-else>
          <p v-if="!canEdit" class="readonly-note">
            <Icon name="ph:lock-simple" aria-hidden="true" /> Solo los administradores de la empresa pueden cambiar estos datos.
          </p>

          <!-- ─── Empresa ─── -->
          <form v-show="section === 'empresa'" class="card form-card rise" style="--i: 2" novalidate @submit.prevent="save">
            <fieldset :disabled="!canEdit">
              <section class="form-section">
                <div class="form-section-head">
                  <h3>Identidad</h3>
                  <p>Así aparecerás en tus facturas y ante Hacienda.</p>
                </div>
                <div class="form-grid">
                  <UiSelect v-model="form.kind" class="c-6" label="Forma jurídica" :options="kindOptions" required />
                  <UiInput
                    v-model="form.nif"
                    class="c-6"
                    label="NIF"
                    required
                    autocomplete="off"
                    :error="nifError"
                    :hint="nifHint"
                    @update:model-value="errors.nif = ''"
                  >
                    <template #end>
                      <Icon v-if="nifCheck?.valid" name="ph:check-circle-fill" class="ok-ic" aria-label="NIF válido" />
                    </template>
                  </UiInput>
                  <UiInput v-model="form.legalName" class="c-6" :label="form.kind === 'autonomo' ? 'Nombre y apellidos' : 'Razón social'" required :error="errors.legalName" />
                  <UiInput v-model="form.tradeName" class="c-6" label="Nombre comercial" hint="Opcional: el nombre con el que te conocen tus clientes" />
                  <UiInput v-model="form.activityCode" class="c-4" label="Epígrafe IAE / CNAE" placeholder="Ej. 844" />
                  <UiInput v-model="form.activityDescription" class="c-8" label="Actividad" placeholder="Ej. Servicios de diseño y desarrollo web" />
                </div>
              </section>

              <section class="form-section">
                <div class="form-section-head">
                  <h3>Contacto y dirección</h3>
                  <p>Datos que se imprimen en la cabecera de tus documentos.</p>
                </div>
                <div class="form-grid">
                  <UiInput v-model="form.email" class="c-6" type="email" label="Email" icon="ph:envelope-simple" autocomplete="email" :error="errors.email" />
                  <UiInput v-model="form.phone" class="c-6" type="tel" label="Teléfono" icon="ph:phone" autocomplete="tel" />
                  <UiInput v-model="form!.website" class="c-12" label="Web" icon="ph:globe-simple" placeholder="https://" />
                  <UiInput v-model="form!.address" class="c-12" label="Dirección" autocomplete="street-address" />
                  <UiInput v-model="form!.postalCode" class="c-3" label="Código postal" inputmode="numeric" autocomplete="postal-code" />
                  <UiInput v-model="form!.city" class="c-4" label="Población" autocomplete="address-level2" />
                  <UiInput v-model="form!.province" class="c-5" label="Provincia" autocomplete="address-level1" />
                  <UiInput v-model="form!.iban" class="c-12" label="IBAN para cobros" icon="ph:bank" placeholder="ES00 0000 0000 0000 0000 0000" hint="Aparece en tus facturas para que te paguen por transferencia" :error="errors.iban" />
                </div>
              </section>

              <section class="form-section">
                <div class="form-section-head">
                  <h3>Fiscalidad</h3>
                  <p>Determina qué modelos presentas y cómo se calculan tus impuestos.</p>
                </div>
                <div class="form-grid">
                  <UiSelect v-model="form!.taxRegime" class="c-6" label="Régimen de IRPF / IS" :options="taxOptions" :hint="TAX_REGIMES[form!.taxRegime]?.hint" />
                  <UiSelect v-model="form!.vatRegime" class="c-6" label="Régimen de IVA" :options="vatOptions" :hint="VAT_REGIMES[form!.vatRegime]?.hint" />
                  <UiInput
                    v-model="form!.activityStartDate"
                    class="c-6"
                    type="date"
                    label="Fecha de alta en la actividad"
                    hint="Los tres primeros años puedes facturar con un 7 % de IRPF"
                  />
                </div>
              </section>

              <section class="form-section">
                <div class="form-section-head">
                  <h3>Facturación por defecto</h3>
                  <p>Valores que se rellenan solos en cada factura nueva. Siempre puedes cambiarlos en cada documento.</p>
                </div>
                <div class="form-grid">
                  <UiSelect v-model="form!.defaultVatRate" class="c-4" label="IVA habitual" :options="vatRateOptions" />
                  <IrpfField v-model="form!.defaultIrpfRate" class="c-4" :presets="[0, 1, 7, 15]" hint="Se aplica a clientes empresa o profesionales" />
                  <UiInput v-model="form!.paymentTermsDays" class="c-4" numeric label="Vencimiento" suffix="días" />
                  <div class="c-12 email-banner">
                    <div class="email-banner-info">
                      <span class="email-banner-icon"><Icon name="ph:envelope-simple-fill" /></span>
                      <div>
                        <strong class="email-banner-title">Pie de factura, mensaje de envío y etiqueta de pedido</strong>
                        <p class="email-banner-text">Se configuran en Diseño de factura, con la vista previa al lado.</p>
                      </div>
                    </div>
                    <UiButton type="button" size="sm" variant="secondary" icon="ph:paint-brush" @click="section = 'diseno'">Configurar en Diseño</UiButton>
                  </div>
                </div>
              </section>
            </fieldset>
          </form>

          <!-- ─── Numeración ─── -->
          <UiCard v-show="section === 'numeracion'" class="rise" style="--i: 2" padding="none" title="Series de numeración" subtitle="Cada serie numera sus documentos de forma correlativa y sin saltos, como exige el reglamento de facturación.">
            <template #actions>
              <UiButton v-if="canEdit" size="sm" variant="secondary" icon="ph:plus" @click="openNewSeries">Nueva serie</UiButton>
            </template>
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">Serie</th>
                    <th scope="col">Documento</th>
                    <th scope="col">Prefijo</th>
                    <th scope="col">Próximo número</th>
                    <th scope="col">Reinicio anual</th>
                    <th v-if="canEdit" scope="col" class="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in series ?? []" :key="s.id">
                    <td class="strong">
                      {{ s.name }}
                      <UiBadge v-if="s.isDefault" tone="brand" size="sm">Predeterminada</UiBadge>
                    </td>
                    <td>{{ KIND_LABEL[s.kind] }}</td>
                    <td><span class="mono">{{ s.prefix || '—' }}</span></td>
                    <td><span class="mono next">{{ s.nextNumber }}</span></td>
                    <td>{{ s.yearlyReset ? 'Sí, cada 1 de enero' : 'No (corrida)' }}</td>
                    <td v-if="canEdit" class="text-right">
                      <UiButton variant="ghost" size="sm" icon="ph:pencil-simple" @click="openEditSeries(s)">Editar formato</UiButton>
                    </td>
                  </tr>
                  <tr v-if="!series">
                    <td :colspan="canEdit ? 6 : 5"><div class="skeleton" style="height: 18px" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <template #footer>
              <p class="foot-note"><Icon name="ph:info" aria-hidden="true" /> Puedes personalizar el prefijo, los dígitos de relleno y el próximo número correlativo de cada serie. El número se asigna al emitir: los borradores no consumen numeración.</p>
            </template>
          </UiCard>

          <!-- ─── VeriFactu (desactivado por ahora) ───
          <div v-show="(section as any) === 'verifactu'" class="stack gap-4">
            ...
          </div>
          ─── -->

          <!-- ─── IA ─── -->
          <div v-show="section === 'ia'" class="stack gap-4">
            <UiCard ai class="rise" style="--i: 2">
              <div class="ai-head">
                <span class="ai-ic" aria-hidden="true"><Icon name="ph:sparkle-fill" /></span>
                <div class="grow">
                  <h2 class="section-title"><span class="ai-text">Inteligencia artificial</span></h2>
                  <p class="muted vf-sub">Lectura de facturas, tickets y fotos, importación de años anteriores y asesor financiero. Con la tecnología de OpenAI.</p>
                </div>
                <UiBadge v-if="ai" :tone="ai.configured ? 'success' : 'warning'" dot>{{ ai.configured ? 'Conectada' : 'Sin configurar' }}</UiBadge>
              </div>
              <SettingsAiKeyPanel v-if="ai" :status="ai" @changed="refreshAi" />
            </UiCard>
            <SettingsAiCostPanel v-if="section === 'ia' && canEdit" class="rise" style="--i: 3" />
            <div class="features rise" style="--i: 4">
              <div class="feature card">
                <Icon name="ph:scan" class="f-ic" aria-hidden="true" />
                <h3>Escaneo instantáneo</h3>
                <p>Haz una foto a un ticket o sube un PDF: NIF, fecha, bases, tipos de IVA y retenciones se rellenan solos.</p>
                <UiButton size="sm" variant="soft" icon="ph:scan" to="?escanear=1">Escanear ahora</UiButton>
              </div>
              <div class="feature card">
                <Icon name="ph:files" class="f-ic" aria-hidden="true" />
                <h3>Importación por lotes</h3>
                <p>PDF, Word, Excel, CSV o un ZIP con carpetas: importa años de facturas emitidas y recibidas, creando clientes y productos.</p>
                <UiButton size="sm" variant="soft" icon="ph:upload-simple" to="/documentos">Importar</UiButton>
              </div>
              <div class="feature card">
                <Icon name="ph:chat-circle-dots" class="f-ic" aria-hidden="true" />
                <h3>Asesor conversacional</h3>
                <p>Pregunta por tus márgenes, impuestos o clientes y recibe respuestas con tus cifras reales.</p>
                <UiButton size="sm" variant="soft" icon="ph:sparkle-fill" to="/asistente">Abrir asistente</UiButton>
              </div>
            </div>
          </div>

          <!-- ─── Diseño ─── -->
          <SettingsNewsPanel v-if="section === 'novedades'" class="rise" style="--i: 2" />
          <SettingsSignaturesPanel v-if="section === 'firmas'" class="rise" style="--i: 2" :can-edit="canEdit" />
          <SettingsInvoiceDesigner v-if="section === 'diseno'" class="rise" style="--i: 2" :can-edit="canEdit" @saved="onDesignSaved" />

          <!-- ─── Copia de seguridad ─── -->
          <SettingsBackupPanel v-if="section === 'copia' && canEdit" class="rise" style="--i: 2" />
          <UiCard v-else-if="section === 'copia'" class="rise" style="--i: 2" title="Copia de seguridad" icon="ph:cloud-arrow-down">
            <p class="muted">Solo el propietario o un administrador de la empresa puede descargar la copia completa.</p>
          </UiCard>

          <!-- ─── Recordatorios de cobro ─── -->
          <div v-if="section === 'cobros'" class="stack gap-4">
            <SettingsOnlinePaymentsPanel class="rise" style="--i: 2" :can-edit="canEdit" />
            <SettingsRemindersPanel class="rise" style="--i: 3" :can-edit="canEdit" />
          </div>

          <!-- ─── Gestoría ─── -->
          <UiCard v-if="section === 'gestoria'" class="rise" style="--i: 2" title="Tu gestor o asesoría" icon="ph:briefcase" subtitle="NUMIQ prepara la documentación de cada mes, trimestre o año y se la envía con un clic: facturas, gastos con su original, extractos y un resumen en Excel y PDF.">
            <SettingsAdvisorForm :can-edit="canEdit">
              <template #actions>
                <UiButton variant="ghost" icon="ph:paper-plane-tilt" to="/documentos/gestor">Preparar un envío</UiButton>
              </template>
            </SettingsAdvisorForm>
          </UiCard>

          <!-- ─── Equipo y cuenta ─── -->
          <SettingsTeamPanel v-if="section === 'equipo'" class="rise" style="--i: 2" />
          <SettingsAccountPanel v-if="section === 'cuenta'" class="rise" style="--i: 2" />

          <!-- ─── Certificado digital (desactivado por ahora: solo lo usaría VeriFactu) ───
          <div v-show="section === 'certificado'" class="stack gap-4">
            <UiCard class="rise" style="--i: 2">
              ... cabecera «Certificado digital y Cl@ve» ...
              <SettingsCertificatePanel v-if="section === 'certificado'" :can-edit="canEdit" />
            </UiCard>
          </div>
          ─── -->
        </template>
      </div>
    </div>

    <!-- Barra de guardado -->
    <Transition name="bar">
      <div v-if="dirty && canEdit" class="save-bar" role="region" aria-label="Cambios sin guardar">
        <span class="save-dot" aria-hidden="true" />
        <span class="grow save-t">Tienes cambios sin guardar</span>
        <UiButton variant="ghost" :disabled="saving" @click="discard">Descartar</UiButton>
        <UiButton variant="primary" icon="ph:check-bold" :loading="saving" @click="save">Guardar cambios</UiButton>
      </div>
    </Transition>

    <!-- Modal para editar / crear serie de numeración -->
    <UiModal v-model="seriesModalOpen" :title="seriesModalMode === 'create' ? 'Nueva serie de numeración' : 'Editar formato de numeración'" size="md">
      <form id="series-form" class="stack gap-4" @submit.prevent="saveSeries">
        <div class="series-preview-box">
          <span class="sp-label">Formato resultante del próximo documento</span>
          <span class="sp-code mono">{{ previewSeriesNumber }}</span>
        </div>

        <div class="form-grid">
          <UiSelect
            v-if="seriesModalMode === 'create'"
            v-model="seriesForm.kind"
            class="c-12"
            label="Tipo de documento"
            :options="seriesKindOptions"
            required
          />
          <div v-else class="c-12 row gap-2 ai-center" style="padding: 4px 0;">
            <span class="text-sm muted">Documento:</span>
            <strong>{{ KIND_LABEL[seriesForm.kind] }}</strong>
          </div>

          <UiInput
            v-model="seriesForm.name"
            class="c-8"
            label="Nombre de la serie"
            placeholder="Ej. General, Serie B, Rectificativas"
            required
          />

          <UiInput
            v-model="seriesForm.prefix"
            class="c-4"
            label="Prefijo"
            placeholder="Ej. F, FAC-, R-"
            hint="Código inicial"
          />

          <UiSelect
            v-model="seriesForm.padding"
            class="c-6"
            label="Dígitos de número (relleno)"
            :options="paddingOptions"
          />

          <UiInput
            v-model.number="seriesForm.nextSequence"
            class="c-6"
            type="number"
            min="1"
            label="Próximo número correlativo"
            hint="Contador que se asignará al siguiente"
            :error="seriesFormError"
          />

          <div class="c-12 stack gap-3 mt-1">
            <UiSwitch
              v-model="seriesForm.yearlyReset"
              label="Reinicio anual con año en el número"
              hint="Incluye el año actual (ej. F2026-0001) y reinicia el 1 de enero. Si se desactiva, es numeración continua (ej. F0001)."
            />

            <UiSwitch
              v-if="!seriesForm.isOriginalDefault"
              v-model="seriesForm.isDefault"
              label="Marcar como serie predeterminada"
              hint="Se seleccionará automáticamente al crear documentos de este tipo."
            />
          </div>
        </div>

        <p v-if="seriesForm.issuedCount > 0" class="note-box info">
          <Icon name="ph:info" aria-hidden="true" />
          <span>Esta serie ya tiene <strong>{{ seriesForm.issuedCount }}</strong> documento(s) emitido(s). El próximo número debe ser mayor que {{ seriesForm.maxIssuedSequence }}.</span>
        </p>
      </form>

      <template #footer>
        <UiButton variant="ghost" :disabled="savingSeries" @click="seriesModalOpen = false">Cancelar</UiButton>
        <UiButton variant="primary" type="submit" form="series-form" :loading="savingSeries">Guardar serie</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
/* Menú de secciones a la izquierda solo si el formulario conserva ~750 px; si no, pestañas arriba
   (con la barra lateral abierta, una tableta en horizontal deja ~870 px de contenido) */
.settings {
  container: settings / inline-size;
}

.layout {
  display: grid;
  grid-template-columns: 228px minmax(0, 1fr);
  gap: var(--s-6);
  align-items: start;
}

/* ─── Navegación de secciones ─── */

.snav {
  position: sticky;
  top: calc(var(--topbar-h) + var(--s-4));
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.snav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 12px;
  font-weight: 520;
  color: var(--text-2);
  text-align: left;
  border-radius: var(--r-md);
  transition: background var(--t-fast), color var(--t-fast);
}

.snav-new {
  min-width: 20px;
  margin-left: auto;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 19px;
  color: #fff;
  text-align: center;
  background: linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 70%, #ec4899));
  border-radius: 999px;
  box-shadow: 0 4px 10px -4px color-mix(in srgb, var(--brand) 70%, transparent);
}

.snav-item:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.snav-item.on {
  color: var(--text);
  font-weight: 600;
  background: var(--nav-active);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border-subtle);
}

.snav-ic {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--text-3);
}

.on .snav-ic {
  color: var(--brand);
}

.panel {
  min-width: 0;
  padding-bottom: 88px;
}

.readonly-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--s-4);
  padding: 10px 14px;
  font-size: var(--text-sm);
  color: var(--text-2);
  background: var(--surface-sunken);
  border-radius: var(--r-md);
}

.loading-card {
  padding: var(--s-6);
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.form-card {
  padding: var(--s-7);
}

fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}

@media (min-width: 640px) {
  .form-grid .c-5 { grid-column: span 5; }
  .form-grid .c-12 { grid-column: span 12; }
}

.ok-ic {
  width: 17px;
  height: 17px;
  color: var(--success);
  flex-shrink: 0;
}

/* ─── Numeración ─── */

.next {
  color: var(--brand-text);
  font-weight: 600;
}

.foot-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--text-3);
}

.foot-note :deep(svg) {
  width: 15px;
  height: 15px;
  margin-top: 2px;
  flex-shrink: 0;
}

.text-right {
  text-align: right;
}

.series-preview-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--s-3) var(--s-4);
  background: color-mix(in srgb, var(--brand-soft) 55%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--brand) 25%, var(--border));
  border-radius: var(--r-lg);
}

.sp-label {
  font-size: var(--text-xs);
  color: var(--text-3);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sp-code {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--brand-text);
  letter-spacing: 0.02em;
}

.note-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  font-size: var(--text-sm);
  border-radius: var(--r-md);
}

.note-box.info {
  color: var(--info);
  background: var(--info-soft);
}

/* ─── VeriFactu / IA / Certificado ─── */

.vf-head,
.ai-head {
  display: flex;
  align-items: flex-start;
  gap: var(--s-4);
}

.vf-badge,
.ai-ic {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  font-size: 22px;
  border-radius: var(--r-lg);
  color: var(--success);
  background: var(--success-soft);
}

.vf-badge.cert {
  color: var(--brand-text);
  background: var(--brand-soft);
}

.ai-ic {
  color: #fff;
  background: var(--ai-grad);
  box-shadow: 0 6px 18px -6px rgb(99 70 229 / 0.6);
}

.section-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.vf-sub {
  margin-top: 4px;
  font-size: var(--text-sm);
  max-width: 620px;
}

.vf-switch {
  margin-top: var(--s-5);
  padding: var(--s-4);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

.features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--s-4);
}

.feature {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: var(--s-5);
}

.f-ic {
  width: 22px;
  height: 22px;
  color: var(--brand-text);
}

.feature h3 {
  font-size: var(--text-md);
  font-weight: 620;
}

.feature p {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-3);
  line-height: 1.55;
}

/* ─── Diseño ─── */


.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-5);
  padding: var(--s-7) var(--s-4);
  text-align: center;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-xl);
  background: var(--surface-2);
  opacity: 0.75;
}

.dropzone :deep(svg) {
  width: 28px;
  height: 28px;
  color: var(--text-3);
}

.dz-t {
  font-weight: 600;
}

.dz-s {
  font-size: var(--text-sm);
  color: var(--text-3);
}

/* ─── Indicador de autoguardado ─── */
.auto-save-status {
  display: flex;
  align-items: center;
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 550;
  padding: 4px 10px;
  border-radius: var(--r-full);
}

.status-indicator.saving {
  color: var(--brand);
  background: var(--brand-soft);
}

.status-indicator.saved {
  color: var(--success);
  background: var(--success-soft);
}

.status-indicator :deep(svg) {
  font-size: 14px;
}

.spin {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ─── Barra de guardado ─── */

.save-bar {
  position: fixed;
  left: 50%;
  bottom: calc(var(--s-5) + var(--bnav) + var(--safe-b));
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  gap: var(--s-2);
  width: min(560px, calc(100vw - 2 * var(--s-4)));
  padding: 8px 8px 8px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-xl);
  transform: translateX(-50%);
}

.save-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning-solid);
  box-shadow: 0 0 0 4px var(--warning-soft);
}

.save-t {
  font-weight: 560;
}

.bar-enter-active {
  transition: transform var(--t-slow) var(--ease-spring), opacity var(--t-base);
}

.bar-leave-active {
  transition: transform 160ms var(--ease-in), opacity 160ms var(--ease-in);
}

.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translate(-50%, 16px);
}

/* ─── Responsive ─── */

@media (max-width: 1279px) {
  .features {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container settings (max-width: 999px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-4);
  }

  /* Pestañas desplazables: el borde se funde para que se note que hay más */
  .snav {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    padding: 2px 32px 4px 2px;
    scrollbar-width: none;
    mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
  }

  .snav::-webkit-scrollbar {
    display: none;
  }

  .snav-item {
    flex-shrink: 0;
  }
}

@media (max-width: 767px) {
  .form-card {
    padding: var(--s-5) var(--s-4);
  }

  .features {
    grid-template-columns: minmax(0, 1fr);
  }

  .save-t {
    font-size: var(--text-sm);
  }
}

.email-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
  background: var(--surface-sunken);
  border: 1px dashed var(--border-subtle);
  border-radius: var(--r-lg);
  margin-top: var(--s-2);
}

.email-banner-info {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-width: 0;
}

.email-banner-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-md);
  background: var(--brand-soft);
  color: var(--brand-text);
  font-size: 16px;
  flex-shrink: 0;
}

.email-banner-title {
  display: block;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text);
}

.email-banner-text {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-3);
}

@media (max-width: 640px) {
  .email-banner {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
