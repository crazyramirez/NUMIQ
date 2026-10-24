<script setup lang="ts">
/** Certificado digital: subida (.p12/.pfx + contraseña), datos del titular, caducidad y retirada */
interface Cert {
  holderName: string
  holderNif: string | null
  representativeName: string | null
  representativeNif: string | null
  kind: 'persona' | 'representante' | 'sello' | 'otro'
  issuer: string | null
  fingerprint: string
  validFrom: string
  validTo: string
  expired: boolean
  expiresInDays: number
  matchesCompany: boolean
  createdAt: string
}

defineProps<{ canEdit: boolean }>()
const toast = useToast()
const { confirm } = useConfirm()
const { data, refresh, pending } = await useFetch<{ certificate: Cert | null }>('/api/certificate', { default: () => ({ certificate: null }) })

const replacing = ref(false)
const file = ref<File | null>(null)
const password = ref('')
const showPassword = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const fileInput = ref<HTMLInputElement>()
const over = ref(false)

const KIND: Record<Cert['kind'], string> = { persona: 'Persona física', representante: 'Representante de entidad', sello: 'Sello de entidad', otro: 'Certificado' }

function pick(f: File | null | undefined) {
  if (!f) return
  if (!/\.(p12|pfx)$/i.test(f.name)) {
    error.value = 'Elige un archivo .p12 o .pfx (tu certificado exportado con clave privada)'
    return
  }
  error.value = null
  file.value = f
}

async function save() {
  if (!file.value) return
  saving.value = true
  error.value = null
  try {
    const form = new FormData()
    form.append('file', file.value, file.value.name)
    form.append('password', password.value)
    const r = await $fetch<{ holderName: string, holderNif: string | null }>('/api/certificate', { method: 'POST', body: form })
    toast.success('Certificado guardado', `${r.holderName}${r.holderNif ? ` · ${r.holderNif}` : ''}`)
    file.value = null
    password.value = ''
    replacing.value = false
    await refresh()
  }
  catch (err) {
    error.value = errorMessage(err)
  }
  finally {
    saving.value = false
  }
}

async function remove() {
  const ok = await confirm({ title: '¿Retirar el certificado?', body: 'Se borra de NUMIQ de forma segura. Los envíos a la AEAT se detendrán hasta que subas otro.', confirmLabel: 'Retirar', danger: true })
  if (!ok) return
  await $fetch('/api/certificate', { method: 'DELETE' }).catch(err => toast.error('No se pudo retirar', errorMessage(err)))
  toast.success('Certificado retirado')
  await refresh()
}

const cert = computed(() => data.value.certificate)
const showForm = computed(() => !cert.value || replacing.value)
</script>

<template>
  <div class="cert-panel">
    <div v-if="pending && !cert" class="skeleton" style="height: 120px" />

    <div v-else-if="cert && !replacing" class="cert" :class="{ bad: cert.expired, warn: !cert.expired && cert.expiresInDays < 30 }">
      <span class="c-ic" aria-hidden="true"><Icon name="ph:certificate-fill" /></span>
      <div class="grow min0">
        <div class="row gap-2 wrap">
          <p class="c-name">{{ cert.holderName }}</p>
          <UiBadge size="sm" tone="neutral">{{ KIND[cert.kind] }}</UiBadge>
        </div>
        <dl class="c-meta">
          <div v-if="cert.holderNif"><dt>NIF</dt><dd class="mono">{{ cert.holderNif }}</dd></div>
          <div v-if="cert.representativeName"><dt>Representante</dt><dd>{{ cert.representativeName }} · {{ cert.representativeNif }}</dd></div>
          <div><dt>Emisor</dt><dd>{{ cert.issuer ?? '—' }}</dd></div>
          <div><dt>Válido hasta</dt><dd>{{ fdate(cert.validTo) }} <span class="days" :class="{ bad: cert.expired, warn: !cert.expired && cert.expiresInDays < 30 }">{{ cert.expired ? 'caducado' : `quedan ${cert.expiresInDays} días` }}</span></dd></div>
        </dl>
        <p v-if="!cert.matchesCompany" class="c-note"><Icon name="ph:info-fill" aria-hidden="true" /> El NIF del certificado no es el de la empresa: solo servirá si el titular está apoderado ante la AEAT para actuar en su nombre.</p>
        <p class="c-fp mono" :title="cert.fingerprint">{{ cert.fingerprint.slice(0, 47) }}…</p>
      </div>
      <div v-if="canEdit" class="c-act">
        <UiButton size="sm" variant="secondary" icon="ph:arrows-clockwise" @click="replacing = true">Reemplazar</UiButton>
        <UiButton size="sm" variant="ghost" icon="ph:trash" @click="remove">Retirar</UiButton>
      </div>
    </div>

    <form v-if="showForm && canEdit" class="upload" @submit.prevent="save">
      <div
        class="drop"
        :class="{ over, has: !!file }"
        role="button"
        tabindex="0"
        @click="fileInput?.click()"
        @keydown.enter.prevent="fileInput?.click()"
        @dragover.prevent="over = true"
        @dragleave="over = false"
        @drop.prevent="over = false; pick($event.dataTransfer?.files[0])"
      >
        <Icon :name="file ? 'ph:certificate-fill' : 'ph:upload-simple'" class="d-ic" aria-hidden="true" />
        <p class="d-t">{{ file ? file.name : 'Sube tu certificado .p12 o .pfx' }}</p>
        <p class="d-s">{{ file ? 'Escribe su contraseña y guárdalo' : 'Exportado desde tu navegador o el gestor de certificados, con clave privada' }}</p>
        <input ref="fileInput" type="file" accept=".p12,.pfx,application/x-pkcs12" class="sr-only" tabindex="-1" aria-hidden="true" @change="pick(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''">
      </div>
      <div class="pw">
        <UiInput v-model="password" :type="showPassword ? 'text' : 'password'" label="Contraseña del certificado" autocomplete="off" :error="error">
          <template #end>
            <button type="button" class="eye" :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'" @click="showPassword = !showPassword"><Icon :name="showPassword ? 'ph:eye-slash' : 'ph:eye'" /></button>
          </template>
        </UiInput>
        <div class="row gap-2 pw-act">
          <UiButton v-if="replacing" variant="ghost" @click="replacing = false; file = null; error = null">Cancelar</UiButton>
          <UiButton type="submit" variant="primary" icon="ph:lock-key" :loading="saving" :disabled="!file">Guardar cifrado</UiButton>
        </div>
      </div>
      <p class="sec"><Icon name="ph:shield-check-fill" aria-hidden="true" /> Se cifra en el servidor (AES-256) y nunca vuelve al navegador. Solo se usa para tus envíos a la AEAT.</p>
    </form>
  </div>
</template>

<style scoped>
.cert-panel {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.min0 {
  min-width: 0;
}

.cert {
  display: flex;
  align-items: flex-start;
  gap: var(--s-4);
  padding: var(--s-4);
  background: var(--success-soft);
  border: 1px solid color-mix(in srgb, var(--success-solid) 30%, var(--border));
  border-radius: var(--r-lg);
}

.cert.warn {
  background: var(--warning-soft);
  border-color: color-mix(in srgb, var(--warning-solid) 35%, var(--border));
}

.cert.bad {
  background: var(--danger-soft);
  border-color: color-mix(in srgb, var(--danger-solid) 35%, var(--border));
}

.c-ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 42px;
  height: 42px;
  font-size: 22px;
  color: var(--success);
  background: var(--surface);
  border-radius: var(--r-lg);
}

.warn .c-ic { color: var(--warning); }
.bad .c-ic { color: var(--danger); }

.c-name {
  font-weight: 650;
  font-size: var(--text-md);
}

.c-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px var(--s-5);
  margin-top: var(--s-2);
  font-size: var(--text-sm);
}

.c-meta dt {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.c-meta dd {
  margin: 0;
  font-weight: 540;
}

.days {
  margin-left: 4px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--success);
}

.days.warn { color: var(--warning); }
.days.bad { color: var(--danger); }

.c-note {
  display: flex;
  gap: 6px;
  margin-top: var(--s-3);
  font-size: var(--text-sm);
  color: var(--text-2);
}

.c-fp {
  margin-top: var(--s-2);
  font-size: var(--text-2xs);
  color: var(--text-3);
}

.c-act {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.upload {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--s-6) var(--s-4);
  text-align: center;
  cursor: pointer;
  background: var(--surface-2);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-lg);
  transition: border-color var(--t-fast), background var(--t-fast);
}

.drop:hover,
.drop.over {
  border-color: var(--brand);
  background: color-mix(in srgb, var(--brand) 5%, var(--surface));
}

.drop.has {
  border-style: solid;
  border-color: color-mix(in srgb, var(--success-solid) 45%, var(--border));
}

.d-ic {
  font-size: 28px;
  color: var(--brand);
}

.has .d-ic {
  color: var(--success);
}

.d-t {
  font-weight: 600;
}

.d-s {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.pw {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--s-3);
  align-items: end;
}

.pw-act {
  padding-bottom: 1px;
}

.eye {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--text-3);
}

.sec {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-3);
}

.sec :deep(svg) {
  color: var(--success);
}

@media (max-width: 640px) {
  .cert {
    flex-direction: column;
  }

  .c-meta {
    grid-template-columns: minmax(0, 1fr);
  }

  .c-act {
    flex-direction: row;
  }

  .pw {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
