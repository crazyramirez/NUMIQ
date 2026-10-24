<script setup lang="ts">
import type { ContactImportAction, ContactImportRow } from '#shared/types/contact-import'
import type { ContactDraft, ContactDraftField } from '#shared/utils/contact-clean'

/** Revisión de un contacto leído: sus datos, lo que se ha cambiado solo, los avisos y qué hacer con él */
const props = defineProps<{ row: ContactImportRow | null, base: string }>()
const emit = defineEmits<{ save: [row: ContactImportRow] }>()
const open = defineModel<boolean>({ default: false })

const form = ref<ContactDraft>(emptyContactDraft())
const isClient = ref(true)
const isSupplier = ref(false)
const action = ref<ContactImportAction>('create')
const formId = useId()

watch(open, (v) => {
  if (!v || !props.row) return
  form.value = { ...props.row.data }
  isClient.value = props.row.isClient
  isSupplier.value = props.row.isSupplier
  action.value = props.row.action
}, { immediate: true })

const issues = computed(() => checkContactDraft(form.value))
const errorOf = (f: ContactDraftField) => issues.value.find(i => i.field === f && i.level === 'error')?.text ?? null
const warnOf = (f: ContactDraftField) => issues.value.find(i => i.field === f && i.level === 'warning')?.text

/** Cambios automáticos que aún siguen puestos (si el usuario ya lo ha tocado, no se ofrece deshacerlo) */
const changes = computed(() => (props.row?.changes ?? []).filter(c => String(form.value[c.field] ?? '') === String(c.to ?? '')))

function revert(field: ContactDraftField, from: string | null) {
  const f = form.value as unknown as Record<string, unknown>
  f[field] = field === 'paymentTermsDays' || field === 'irpfRate' ? (from == null ? null : Number(from)) : from
}

function applyFix(field: ContactDraftField | null, fix: string) {
  if (field) (form.value as unknown as Record<string, unknown>)[field] = fix
}

const nifTypeOptions = [
  { value: 'nif', label: 'NIF / CIF español' },
  { value: 'vat_eu', label: 'NIF-IVA intracomunitario' },
  { value: 'passport', label: 'Pasaporte' },
  { value: 'other', label: 'Otro documento' },
]
const nifType = computed({
  get: () => form.value.nifType ?? 'nif',
  set: v => (form.value.nifType = v as ContactDraft['nifType']),
})
const kind = computed({
  get: () => form.value.kind ?? 'company',
  set: v => (form.value.kind = v as ContactDraft['kind']),
})

const actionOptions = computed(() => {
  const r = props.row
  if (r?.match) {
    return [
      { value: 'fill', label: 'Completar su ficha' },
      { value: 'update', label: 'Actualizar con el archivo' },
      ...(r.match.certain ? [] : [{ value: 'create', label: 'Crear otro' }]),
      { value: 'skip', label: 'No importar' },
    ]
  }
  return [{ value: 'create', label: r?.mergedInto ? 'Crear por separado' : 'Crear' }, { value: 'skip', label: 'No importar' }]
})

function save() {
  if (!props.row) return
  // Lo escrito a mano también se deja en su forma correcta (NIF sin guiones, teléfono, CP…)
  const { contact } = cleanContactDraft(form.value)
  contact.kind ??= 'company'
  emit('save', {
    ...props.row,
    data: contact,
    isClient: isClient.value,
    isSupplier: isSupplier.value,
    action: action.value,
    mergedInto: action.value === 'create' ? null : props.row.mergedInto,
    issues: checkContactDraft(contact),
  })
  open.value = false
}

const FIELD = CONTACT_FIELD_LABELS
</script>

<template>
  <UiModal v-model="open" :title="row?.data.name || 'Contacto'" :subtitle="row?.source" size="md" side>
    <form v-if="row" :id="formId" class="ci-edit" novalidate @submit.prevent="save">
      <section v-if="row.match" class="ci-box ci-match" aria-label="Ya existe">
        <p class="ci-box-t"><Icon name="ph:user-circle-check" aria-hidden="true" /> {{ row.match.label }}</p>
        <ul v-if="row.match.conflicts.length" class="ci-conf">
          <li v-for="c in row.match.conflicts" :key="c.field">
            <span class="ci-k">{{ FIELD[c.field] }}</span>
            <span class="ci-v">En la ficha: <b>{{ c.current }}</b></span>
            <span class="ci-v">En el archivo: <b>{{ c.incoming }}</b></span>
          </li>
        </ul>
        <p v-else-if="row.match.fills.length" class="ci-box-s">El archivo añade: {{ row.match.fills.map(f => FIELD[f].toLowerCase()).join(', ') }}.</p>
        <p v-else class="ci-box-s">Su ficha ya tiene todos estos datos.</p>
        <NuxtLink :to="`${base}/${row.match.id}`" target="_blank" class="ci-open">Ver su ficha <Icon name="ph:arrow-square-out" aria-hidden="true" /></NuxtLink>
      </section>

      <section v-if="row.notContact" class="ci-box ci-not">
        <p class="ci-box-t"><Icon name="ph:prohibit" aria-hidden="true" /> {{ row.notContact }}</p>
      </section>

      <div class="ci-action">
        <UiSelect v-model="action" :options="actionOptions" label="Qué hacer con este contacto" />
      </div>

      <section v-if="changes.length" class="ci-box ci-changes" aria-label="Cambios automáticos">
        <p class="ci-box-t"><Icon name="ph:sparkle-fill" aria-hidden="true" /> Corregido al leerlo</p>
        <ul>
          <li v-for="(c, i) in changes" :key="i">
            <div class="grow">
              <p class="ci-ch"><b>{{ FIELD[c.field] }}:</b> <s>{{ contactChangeValue(c.field, c.from) }}</s> → {{ contactChangeValue(c.field, c.to) }}</p>
              <p class="ci-why">{{ c.reason }}<template v-if="c.by === 'ai'"> · IA</template></p>
            </div>
            <UiButton size="sm" variant="ghost" icon="ph:arrow-counter-clockwise" @click="revert(c.field, c.from)">Deshacer</UiButton>
          </li>
        </ul>
      </section>

      <ul v-if="issues.length" class="ci-issues" aria-label="Avisos">
        <li v-for="(i, n) in issues" :key="n" :class="i.level">
          <Icon :name="i.level === 'error' ? 'ph:warning-circle-fill' : 'ph:info-fill'" aria-hidden="true" />
          <span class="grow">{{ i.text }}</span>
          <UiButton v-if="i.fix" size="sm" variant="soft" @click="applyFix(i.field, i.fix)">Usar {{ i.fix }}</UiButton>
        </li>
      </ul>

      <div class="form-grid">
        <UiSegmented v-model="kind" :options="[{ value: 'company', label: 'Empresa' }, { value: 'person', label: 'Persona' }]" label="Tipo de contacto" class="ci-kind" />
        <UiInput v-model="form.name" :label="kind === 'company' ? 'Razón social' : 'Nombre y apellidos'" :error="errorOf('name')" required />
        <UiInput v-model="form.tradeName" class="c-6" label="Nombre comercial" />
        <UiInput v-model="form.contactPerson" class="c-6" label="Persona de contacto" />
        <UiInput v-model="form.nif" class="c-7 upper" :label="nifType === 'vat_eu' ? 'NIF-IVA' : 'NIF'" :error="errorOf('nif')" :hint="warnOf('nif')" autocomplete="off" />
        <UiSelect v-model="nifType" class="c-5" label="Tipo" :options="nifTypeOptions" />
        <UiInput v-model="form.email" class="c-6" type="email" label="Email" icon="ph:envelope-simple" :error="errorOf('email')" autocomplete="off" />
        <UiInput v-model="form.phone" class="c-6" type="tel" label="Teléfono" icon="ph:phone" :hint="warnOf('phone')" autocomplete="off" />
        <UiInput v-model="form.address" label="Dirección" autocomplete="off" />
        <UiInput v-model="form.postalCode" class="c-4" label="C. postal" inputmode="numeric" :hint="warnOf('postalCode')" autocomplete="off" />
        <UiInput v-model="form.city" class="c-4" label="Población" :hint="warnOf('city')" autocomplete="off" />
        <UiInput v-model="form.province" class="c-4" label="Provincia" autocomplete="off" />
        <UiInput v-model="form.country" class="c-4 upper" label="País" maxlength="2" placeholder="ES" :error="errorOf('country')" autocomplete="off" />
        <UiInput v-model="form.iban" class="c-8 upper" label="IBAN" icon="ph:bank" :error="errorOf('iban')" autocomplete="off" />
        <UiInput v-model="form.website" class="c-8" label="Web" placeholder="https://" autocomplete="off" />
        <UiInput v-model="form.paymentTermsDays" class="c-4" label="Plazo de pago" numeric suffix="días" />
        <UiTextarea v-model="form.notes" label="Notas internas" rows="3" />
        <div class="ci-roles">
          <UiSwitch v-model="isClient" label="Cliente" hint="Podrás emitirle facturas" />
          <UiSwitch v-model="isSupplier" label="Proveedor" hint="Podrás registrar sus gastos" />
        </div>
      </div>
    </form>

    <template #footer>
      <UiButton @click="open = false">Cancelar</UiButton>
      <UiButton type="submit" :form="formId" variant="primary" icon="ph:check-bold" :disabled="!isClient && !isSupplier">Guardar</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.ci-edit {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.ci-box {
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  font-size: var(--text-sm);
}

.ci-box-t {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.ci-box-t :deep(svg) {
  flex: none;
  width: 17px;
  height: 17px;
}

.ci-box-s {
  margin-top: 4px;
  color: var(--text-2);
}

.ci-match {
  background: var(--info-soft);
  border-color: color-mix(in srgb, var(--info) 25%, transparent);
}

.ci-match .ci-box-t :deep(svg) {
  color: var(--info);
}

.ci-not .ci-box-t :deep(svg) {
  color: var(--text-3);
}

.ci-conf {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding: 0;
  list-style: none;
}

.ci-conf li {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ci-k {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ci-v {
  color: var(--text-2);
  overflow-wrap: anywhere;
}

.ci-open {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-weight: 560;
  color: var(--brand-text);
}

.ci-changes {
  background: var(--ai-soft), var(--surface);
  border-color: color-mix(in srgb, var(--ai-2) 25%, var(--border));
}

.ci-changes .ci-box-t :deep(svg) {
  color: var(--ai-1);
}

.ci-changes ul {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 0;
  list-style: none;
}

.ci-changes li {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.ci-ch {
  overflow-wrap: anywhere;
}

.ci-ch s {
  color: var(--text-3);
}

.ci-why {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ci-issues {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
}

.ci-issues li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-md);
}

.ci-issues li :deep(svg) {
  flex: none;
}

.ci-issues .error {
  color: var(--danger);
  background: var(--danger-soft);
}

.ci-issues .warning {
  color: var(--warning);
  background: var(--warning-soft);
}

.ci-kind {
  justify-self: start;
}

.ci-roles {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--s-3);
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
}

@media (max-width: 480px) {
  .ci-roles {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
