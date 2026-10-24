<script setup lang="ts">
/**
 * «¿Es deducible?» en un toque: Sí / En parte / No. «En parte» abre el % del gasto y del IVA
 * (vehículo o casa de uso mixto). Con importes, dice cuánto desgrava.
 */
const props = withDefaults(defineProps<{
  /** La factura lleva IVA: si no, un solo % */
  hasVat?: boolean
  /** Base e IVA del gasto, para el «desgrava…» */
  base?: number | null
  vat?: number | null
  /** Proveedor cuya última elección se ha aplicado */
  learned?: string | null
  compact?: boolean
}>(), { hasVat: true, base: null, vat: null, learned: null, compact: false })

const pctModel = defineModel<number>('pct', { required: true })
const vatModel = defineModel<number>('vatPct', { required: true })
const groupId = useId()

const level = () => deductibleLevel(pctModel.value, vatModel.value, props.hasVat)
const mode = ref<DeductibleLevel>(level())

// Lo que llega de fuera (categoría, proveedor, otro gasto) cambia el modo; lo que se escribe aquí, no
let mine: string | null = null
const key = () => `${pctModel.value}|${vatModel.value}`
watch([pctModel, vatModel, () => props.hasVat], () => {
  if (key() === mine) return
  mine = null
  mode.value = level()
})

function set(p: number, v: number) {
  pctModel.value = p
  vatModel.value = props.hasVat ? v : p
  mine = key()
}

function choose(l: DeductibleLevel) {
  mode.value = l
  if (l === 'full') set(100, 100)
  else if (l === 'none') set(0, 0)
  // Uso mixto: lo habitual es la mitad
  else if (level() !== 'partial') set(50, 50)
}

const clamp = (n: unknown) => Math.min(100, Math.max(0, Number(n) || 0))
const pctInput = computed({ get: () => pctModel.value, set: (v: number | null) => set(clamp(v), props.hasVat ? vatModel.value : clamp(v)) })
const vatInput = computed({ get: () => vatModel.value, set: (v: number | null) => set(pctModel.value, clamp(v)) })

const OPTIONS: Array<{ value: DeductibleLevel, label: string, icon: string }> = [
  { value: 'full', label: 'Sí', icon: 'ph:check-circle-fill' },
  { value: 'partial', label: 'En parte', icon: 'ph:circle-half-fill' },
  { value: 'none', label: 'No', icon: 'ph:prohibit' },
]

function onKey(e: KeyboardEvent, i: number) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length]!
  choose(next.value)
  nextTick(() => document.getElementById(`${groupId}-${next.value}`)?.focus())
}

/** «Desgrava 82,64 € de gasto y 17,36 € de IVA» */
const impact = computed(() => {
  if (mode.value === 'none') return 'Gasto personal: no cuenta en tus impuestos'
  const base = props.base ?? 0
  const vat = props.hasVat ? props.vat ?? 0 : 0
  if (!base && !vat) {
    return mode.value === 'full'
      ? 'Resta como gasto en tu renta o Sociedades, y su IVA en el 303'
      : 'Uso mixto (vehículo, casa…): solo cuenta la parte profesional'
  }
  const g = pctOf(base, pctModel.value)
  const v = pctOf(vat, props.hasVat ? vatModel.value : pctModel.value)
  return `Desgrava ${eur(g)} de gasto${v ? ` y ${eur(v)} de IVA` : ''}`
})
</script>

<template>
  <div class="ded" :class="{ compact }">
    <div class="ded-head">
      <span :id="`${groupId}-l`" class="label">¿Es deducible?</span>
      <span v-if="learned" class="ded-learned" :title="`Lo marcaste así la última vez con ${learned}`">
        <Icon name="ph:clock-counter-clockwise" aria-hidden="true" />
        <span class="truncate">Como la última vez con {{ learned }}</span>
      </span>
    </div>
    <div class="ded-opts" role="radiogroup" :aria-labelledby="`${groupId}-l`">
      <button
        v-for="(o, i) in OPTIONS"
        :id="`${groupId}-${o.value}`"
        :key="o.value"
        type="button"
        role="radio"
        class="ded-opt"
        :class="[o.value, { on: mode === o.value }]"
        :aria-checked="mode === o.value"
        :tabindex="mode === o.value ? 0 : -1"
        @click="choose(o.value)"
        @keydown="onKey($event, i)"
      >
        <Icon :name="o.icon" aria-hidden="true" />
        {{ o.label }}
      </button>
    </div>
    <div v-if="mode === 'partial'" class="ded-pcts">
      <UiInput v-model="pctInput" numeric suffix="%" :label="hasVat ? 'Del gasto' : 'Deducible'" />
      <UiInput v-if="hasVat" v-model="vatInput" numeric suffix="%" label="Del IVA" />
    </div>
    <p class="ded-impact" :class="mode" aria-live="polite">{{ impact }}</p>
  </div>
</template>

<style scoped>
.ded {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.ded-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  min-width: 0;
}

.ded-learned {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--brand-text);
}

.ded-learned :deep(svg) {
  flex: none;
}

.ded-opts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.ded-opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 8px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-3);
  white-space: nowrap;
  border-radius: calc(var(--r-md) - 3px);
  transition: color var(--t-fast), background var(--t-fast), box-shadow var(--t-fast);
}

.ded-opt :deep(svg) {
  width: 15px;
  height: 15px;
  opacity: 0.55;
  transition: opacity var(--t-fast);
}

.ded-opt:hover {
  color: var(--text);
}

.ded-opt.on {
  background: var(--surface);
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--border-subtle);
}

.ded-opt.on :deep(svg) {
  opacity: 1;
}

.ded-opt.full.on {
  color: var(--success);
}

.ded-opt.partial.on {
  color: var(--warning);
}

.ded-opt.none.on {
  color: var(--text);
}

.ded-opt:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.ded-pcts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-3);
}

.ded-impact {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.ded-impact.full {
  color: var(--success);
}

.compact .ded-opt {
  min-height: 32px;
}
</style>
