<script setup lang="ts">
definePageMeta({ layout: 'blank' })
useHead({ title: 'Configura tu empresa · NUMIQ' })

const route = useRoute()
const { me, refresh } = useMe()
const toast = useToast()
const adding = computed(() => route.query.nueva === '1' && !!me.value?.company)

const STEPS = ['Actividad', 'Datos fiscales', 'Impuestos', 'Listo'] as const
const step = ref(0)
const loading = ref(false)
const errors = reactive<Record<string, string | null>>({})

const form = reactive({
  kind: 'autonomo' as 'autonomo' | 'sociedad',
  legalName: me.value?.user.name ?? '',
  tradeName: '',
  nif: '',
  email: me.value?.user.email ?? '',
  phone: '',
  address: '',
  postalCode: '',
  city: '',
  province: '',
  activityDescription: '',
  taxRegime: 'directa_simplificada' as keyof typeof TAX_REGIMES,
  vatRegime: 'general' as keyof typeof VAT_REGIMES,
  defaultVatRate: 21,
  defaultIrpfRate: 15,
  activityStartDate: '',
  paymentTermsDays: 30,
  verifactuEnabled: false,
  demo: false,
})

watch(() => form.kind, (k) => {
  form.taxRegime = k === 'sociedad' ? 'sociedades' : 'directa_simplificada'
  if (k === 'sociedad') {
    form.defaultIrpfRate = 0
    if (form.legalName === me.value?.user.name) form.legalName = ''
  }
  else {
    form.defaultIrpfRate = 15
  }
})

watch(() => form.postalCode, (cp) => {
  const p = provinceFromPostalCode(cp)
  if (p) form.province = p
})

const nifState = computed(() => {
  if (!form.nif.trim()) return null
  const r = validateNif(form.nif)
  if (!r.valid) return { ok: false, text: 'Revisa el NIF: la letra o el dígito de control no cuadran' }
  const kindOk = form.kind === 'sociedad' ? r.kind === 'cif' : r.kind !== 'cif'
  return { ok: true, text: kindOk ? `${r.kind === 'cif' ? 'NIF de sociedad' : r.kind === 'nie' ? 'NIE' : 'DNI'} válido` : 'Válido, aunque no parece del tipo de actividad elegida' }
})

/**
 * La retención se decide con una pregunta sencilla: las actividades profesionales (diseño,
 * consultoría, abogacía…) retienen a empresas y autónomos; las empresariales (comercio, oficios…) no.
 */
const activity = computed({
  get: () => (form.defaultIrpfRate > 0 ? 'professional' : 'business'),
  set: (v: 'professional' | 'business') => (form.defaultIrpfRate = v === 'business' ? 0 : newFreelancer.value ? 7 : 15),
})

/** Nuevo autónomo: 7 % de retención el año de alta y los dos siguientes */
const newFreelancer = computed(() => {
  if (form.kind !== 'autonomo' || !form.activityStartDate) return false
  return new Date().getFullYear() - Number(form.activityStartDate.slice(0, 4)) <= 2
})

function validateStep() {
  Object.keys(errors).forEach(k => (errors[k] = null))
  if (step.value === 1) {
    if (form.legalName.trim().length < 2) errors.legalName = form.kind === 'autonomo' ? 'Escribe tu nombre y apellidos' : 'Escribe la razón social'
    if (!validateNif(form.nif).valid) errors.nif = 'NIF no válido'
  }
  return !Object.values(errors).some(Boolean)
}

function next() {
  if (!validateStep()) return
  if (step.value < STEPS.length - 1) step.value++
}

async function finish() {
  loading.value = true
  try {
    await $fetch('/api/companies', {
      method: 'POST',
      body: { ...form, activityStartDate: form.activityStartDate || null },
    })
    await refresh()
    toast.success(form.demo ? 'Empresa creada con datos de ejemplo' : 'Todo listo', form.demo ? 'Explora NUMIQ con un año de actividad simulada.' : 'Ya puedes emitir tu primera factura.')
    await navigateTo('/')
  }
  catch (err) {
    const field = errorField(err)
    if (field) {
      errors[field] = errorMessage(err)
      step.value = ['legalName', 'nif', 'email', 'postalCode', 'address', 'city', 'province', 'phone', 'tradeName'].includes(field) ? 1 : 2
    }
    toast.error('No se pudo crear la empresa', errorMessage(err))
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="onb">
    <header class="top">
      <AppLogo :size="28" />
      <NuxtLink v-if="adding" to="/" class="back-app"><Icon name="ph:arrow-left" /> Volver a la app</NuxtLink>
    </header>

    <main class="center">
      <ol class="steps" aria-label="Progreso">
        <li v-for="(s, i) in STEPS" :key="s" :class="{ done: i < step, on: i === step }">
          <span class="dot"><Icon v-if="i < step" name="ph:check-bold" /><template v-else>{{ i + 1 }}</template></span>
          <span class="s-label">{{ s }}</span>
        </li>
      </ol>

      <form class="card panel" novalidate @submit.prevent="step === STEPS.length - 1 ? finish() : next()">
        <Transition name="step" mode="out-in">
          <!-- 1 · Tipo de actividad -->
          <section v-if="step === 0" key="0">
            <h1>{{ adding ? 'Añade otra empresa' : `Hola${me?.user.name ? `, ${me.user.name.split(' ')[0]}` : ''}. ¿Cómo trabajas?` }}</h1>
            <p class="lead">Adaptamos impuestos, retenciones y modelos a tu forma jurídica.</p>
            <div class="choices">
              <button type="button" class="choice" :class="{ on: form.kind === 'autonomo' }" :aria-pressed="form.kind === 'autonomo'" @click="form.kind = 'autonomo'">
                <span class="c-ic"><Icon name="ph:user-circle-duotone" /></span>
                <span class="c-t">Autónomo</span>
                <span class="c-d">Trabajas por cuenta propia con tu DNI o NIE. IRPF, IVA y modelos 303 y 130.</span>
                <Icon name="ph:check-circle-fill" class="c-check" />
              </button>
              <button type="button" class="choice" :class="{ on: form.kind === 'sociedad' }" :aria-pressed="form.kind === 'sociedad'" @click="form.kind = 'sociedad'">
                <span class="c-ic"><Icon name="ph:buildings-duotone" /></span>
                <span class="c-t">Sociedad</span>
                <span class="c-d">SL, SA o cooperativa con NIF propio. IVA, Impuesto sobre Sociedades y modelo 202.</span>
                <Icon name="ph:check-circle-fill" class="c-check" />
              </button>
            </div>
          </section>

          <!-- 2 · Datos fiscales -->
          <section v-else-if="step === 1" key="1">
            <h1>Datos fiscales</h1>
            <p class="lead">Aparecerán en tus facturas. Puedes cambiarlos cuando quieras.</p>
            <div class="form-grid">
              <UiInput v-model="form.legalName" class="c-8" :label="form.kind === 'autonomo' ? 'Nombre y apellidos' : 'Razón social'" :placeholder="form.kind === 'autonomo' ? 'Lucía García Pérez' : 'Mi Empresa SL'" :error="errors.legalName" required autofocus />
              <div class="c-4 field">
                <UiInput v-model="form.nif" :label="form.kind === 'autonomo' ? 'NIF / NIE' : 'NIF'" :placeholder="form.kind === 'autonomo' ? '12345678Z' : 'B12345678'" :error="errors.nif" required class="upper" />
                <p v-if="nifState && !errors.nif" class="nif-state" :class="{ ok: nifState.ok }">
                  <Icon :name="nifState.ok ? 'ph:check-circle-fill' : 'ph:warning-circle-fill'" /> {{ nifState.text }}
                </p>
              </div>
              <UiInput v-model="form.tradeName" class="c-6" label="Nombre comercial" placeholder="Opcional" hint="Si tu marca es distinta de tu nombre fiscal" />
              <UiInput v-model="form.activityDescription" class="c-6" label="Actividad" placeholder="Diseño gráfico, fontanería, consultoría…" />
              <UiInput v-model="form.address" class="c-12" label="Dirección" placeholder="Calle, número, piso" autocomplete="street-address" />
              <UiInput v-model="form.postalCode" class="c-3" label="Código postal" inputmode="numeric" maxlength="5" autocomplete="postal-code" />
              <UiInput v-model="form.city" class="c-5" label="Población" autocomplete="address-level2" />
              <UiInput v-model="form.province" class="c-4" label="Provincia" autocomplete="address-level1" />
              <UiInput v-model="form.email" class="c-6" label="Email de facturación" type="email" :error="errors.email" />
              <UiInput v-model="form.phone" class="c-6" label="Teléfono" type="tel" autocomplete="tel" />
            </div>
          </section>

          <!-- 3 · Impuestos -->
          <section v-else-if="step === 2" key="2">
            <h1>Impuestos</h1>
            <p class="lead">Lo dejamos configurado para que cada factura salga con los cálculos correctos. Si no estás seguro, deja lo que viene marcado: es lo más común.</p>
            <div class="form-grid">
              <UiSelect
                v-model="form.taxRegime"
                class="c-6"
                label="Tributación directa"
                :options="Object.entries(TAX_REGIMES).filter(([k]) => form.kind === 'sociedad' ? k === 'sociedades' : k !== 'sociedades').map(([value, r]) => ({ value, label: r.label }))"
                :hint="TAX_REGIMES[form.taxRegime]?.hint"
              />
              <UiSelect
                v-model="form.vatRegime"
                class="c-6"
                label="Régimen de IVA"
                :options="Object.entries(VAT_REGIMES).map(([value, r]) => ({ value, label: r.label }))"
                :hint="VAT_REGIMES[form.vatRegime]?.hint"
              />

              <div class="c-12 field">
                <span class="label">IVA habitual de tus servicios o productos</span>
                <div class="pills" role="radiogroup" aria-label="IVA habitual">
                  <button v-for="r in VAT_RATES" :key="r" type="button" role="radio" :aria-checked="form.defaultVatRate === r" class="pill" :class="{ on: form.defaultVatRate === r }" @click="form.defaultVatRate = r">
                    <strong class="num">{{ r }} %</strong>
                    <span>{{ { 21: 'General', 10: 'Reducido', 4: 'Superreducido', 0: 'Exento' }[r] }}</span>
                  </button>
                </div>
              </div>

              <template v-if="form.kind === 'autonomo'">
                <UiInput v-model="form.activityStartDate" class="c-6" label="Fecha de alta como autónomo" type="date" hint="Para aplicar la retención reducida si te corresponde" />
                <div class="c-12 field">
                  <span class="label">¿Qué tipo de actividad tienes?</span>
                  <div class="pills two" role="radiogroup" aria-label="Tipo de actividad">
                    <button type="button" role="radio" :aria-checked="activity === 'professional'" class="pill" :class="{ on: activity === 'professional' }" @click="activity = 'professional'">
                      <strong>Profesional</strong>
                      <span>Diseño, consultoría, abogacía, formación…</span>
                    </button>
                    <button type="button" role="radio" :aria-checked="activity === 'business'" class="pill" :class="{ on: activity === 'business' }" @click="activity = 'business'">
                      <strong>Empresarial</strong>
                      <span>Comercio, hostelería, reformas, oficios…</span>
                    </button>
                  </div>
                  <p class="hint">
                    {{ activity === 'professional'
                      ? `Tus facturas a empresas y autónomos llevarán un ${form.defaultIrpfRate} % de retención de IRPF; a particulares, ninguna. Lo ajustamos solo en cada factura.`
                      : 'Tus facturas no llevarán retención de IRPF.' }}
                  </p>
                </div>
                <Transition name="fade">
                  <div v-if="newFreelancer && activity === 'professional' && form.defaultIrpfRate !== 7" class="c-12 tip">
                    <Icon name="ph:sparkle-fill" class="tip-ic" />
                    <div class="grow">
                      <strong>Puedes facturar con un 7 % de retención</strong>
                      <p>Como te diste de alta hace menos de tres años, la ley te permite aplicar el 7 % en lugar del 15 %. Cobras más cada mes.</p>
                    </div>
                    <UiButton size="sm" variant="soft" @click="form.defaultIrpfRate = 7">Aplicar 7 %</UiButton>
                  </div>
                </Transition>
              </template>
            </div>
          </section>

          <!-- 4 · Listo -->
          <section v-else key="3">
            <div class="done-ic"><Icon name="ph:rocket-launch-duotone" /></div>
            <h1 class="center-t">Todo listo para empezar</h1>
            <p class="lead center-t">Revisa el resumen y entra en tu panel.</p>
            <dl class="summary">
              <div><dt>Actividad</dt><dd>{{ form.kind === 'autonomo' ? 'Autónomo' : 'Sociedad' }}</dd></div>
              <div><dt>{{ form.kind === 'autonomo' ? 'Titular' : 'Razón social' }}</dt><dd>{{ form.legalName }}</dd></div>
              <div><dt>NIF</dt><dd class="mono">{{ normalizeNif(form.nif) }}</dd></div>
              <div><dt>IVA / IRPF</dt><dd class="num">{{ form.defaultVatRate }} % · {{ form.defaultIrpfRate }} %</dd></div>
              <div><dt>Régimen</dt><dd>{{ TAX_REGIMES[form.taxRegime]?.label }}</dd></div>
            </dl>
            <div class="demo">
              <UiSwitch v-model="form.demo" label="Rellenar con datos de ejemplo" hint="Un año de facturas, gastos y clientes ficticios para explorar el panel, los impuestos y la IA. Puedes crear otra empresa limpia después." />
            </div>
          </section>
        </Transition>

        <footer class="nav">
          <UiButton v-if="step > 0" variant="ghost" icon="ph:arrow-left" @click="step--">Atrás</UiButton>
          <span v-else />
          <UiButton v-if="step < STEPS.length - 1" type="submit" variant="primary" icon-right="ph:arrow-right">Continuar</UiButton>
          <UiButton v-else type="submit" variant="primary" size="lg" :loading="loading" icon-right="ph:arrow-right">Entrar en NUMIQ</UiButton>
        </footer>
      </form>
    </main>
  </div>
</template>

<style scoped>
.onb {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(900px 500px at 85% -5%, var(--brand-soft), transparent 70%),
    radial-gradient(700px 400px at -5% 105%, color-mix(in srgb, var(--info-soft) 80%, transparent), transparent 70%),
    var(--bg);
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-5) var(--s-7);
}

.back-app {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-3);
  font-weight: 550;
}

.back-app:hover {
  color: var(--text);
}

.center {
  flex: 1;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: var(--s-4) var(--s-4) var(--s-9);
}

.steps {
  display: flex;
  gap: var(--s-2);
  margin-bottom: var(--s-5);
  padding: 0;
  list-style: none;
}

.steps li {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-4);
  border-top: 3px solid var(--border);
  transition: color var(--t-base), border-color var(--t-base);
}

.steps li.on,
.steps li.done {
  color: var(--text);
  border-color: var(--brand);
}

.dot {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  font-size: var(--text-xs);
  border-radius: 50%;
  background: var(--surface-active);
}

.on .dot,
.done .dot {
  color: var(--on-brand);
  background: var(--brand);
}

.panel {
  padding: var(--s-8) var(--s-8) var(--s-6);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

h1 {
  font-size: var(--text-2xl);
  letter-spacing: -0.025em;
}

.lead {
  margin: var(--s-2) 0 var(--s-6);
  color: var(--text-3);
}

.center-t {
  text-align: center;
}

.choices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-4);
}

.choice {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: var(--s-5);
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: var(--r-xl);
  background: var(--surface);
  transition: border-color var(--t-fast), box-shadow var(--t-base), transform var(--t-fast);
}

.choice:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

.choice.on {
  border-color: var(--brand);
  box-shadow: 0 0 0 4px var(--brand-ring);
}

.c-ic {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin-bottom: 6px;
  font-size: 26px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: var(--r-lg);
}

.c-t {
  font-size: var(--text-lg);
  font-weight: 650;
}

.c-d {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.c-check {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 22px;
  height: 22px;
  color: var(--brand);
  opacity: 0;
  transform: scale(0.6);
  transition: opacity var(--t-base), transform var(--t-base) var(--ease-spring);
}

.on .c-check {
  opacity: 1;
  transform: none;
}

.nif-state {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: var(--warning);
}

.nif-state.ok {
  color: var(--success);
}

.pills.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.pills {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--s-2);
}

.pills.small {
  grid-template-columns: repeat(3, 1fr);
}

.pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface);
  transition: border-color var(--t-fast), background var(--t-fast), color var(--t-fast);
}

.pill strong {
  font-size: var(--text-md);
  color: var(--text);
}

.pill:hover {
  border-color: var(--border-strong);
}

.pill.on {
  color: var(--brand-text);
  border-color: var(--brand);
  background: var(--brand-soft);
}

.tip {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-4);
  border-radius: var(--r-lg);
  background: var(--ai-soft);
  box-shadow: inset 0 0 0 1px rgb(124 58 237 / 0.18);
}

.tip-ic {
  width: 22px;
  height: 22px;
  color: var(--ai-1);
  flex-shrink: 0;
}

.tip p {
  margin-top: 2px;
  font-size: var(--text-sm);
  color: var(--text-2);
}

.verifactu,
.demo {
  padding: var(--s-4);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface-2);
}

.done-ic {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin: 0 auto var(--s-4);
  font-size: 34px;
  color: #fff;
  background: var(--ai-grad);
  border-radius: 20px;
  box-shadow: 0 10px 30px -8px rgb(99 70 229 / 0.6);
}

.summary {
  display: grid;
  gap: 1px;
  margin-bottom: var(--s-5);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--border-subtle);
}

.summary div {
  display: flex;
  justify-content: space-between;
  gap: var(--s-4);
  padding: 11px 16px;
  background: var(--surface);
}

.summary dt {
  color: var(--text-3);
}

.summary dd {
  margin: 0;
  font-weight: 560;
  text-align: right;
}

.nav {
  display: flex;
  justify-content: space-between;
  margin-top: var(--s-7);
  padding-top: var(--s-5);
  border-top: 1px solid var(--border-subtle);
}

.step-enter-active {
  transition: opacity var(--t-base) var(--ease-out), transform var(--t-slow) var(--ease-out);
}

.step-leave-active {
  transition: opacity 120ms var(--ease-in);
}

.step-enter-from {
  opacity: 0;
  transform: translateX(14px);
}

.step-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .top {
    padding: var(--s-4);
  }

  .panel {
    padding: var(--s-6) var(--s-4) var(--s-4);
  }

  .choices {
    grid-template-columns: minmax(0, 1fr);
  }

  .s-label {
    display: none;
  }

  .steps li.on .s-label {
    display: inline;
  }

  .pills {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
