<script setup lang="ts" generic="T extends number | null">
/**
 * Retención de IRPF: admite cualquier tipo con decimales (nóminas, 24 % de no residentes, regularizaciones…)
 * y ofrece los habituales a un toque. Con `nullable`, vacío significa «sin tipo propio».
 */
const props = withDefaults(defineProps<{
  label?: string
  hint?: string | null
  error?: string | null
  nullable?: boolean
  /** Texto del campo vacío (con `nullable`) */
  placeholder?: string
  presets?: readonly number[]
}>(), { label: 'Retención IRPF', presets: () => [0, 7, 15, 19] })

// number, o number | null con `nullable`
const model = defineModel<T>({ required: true })

const PRESET_TITLE: Record<number, string> = {
  0: 'Sin retención',
  1: 'Módulos: actividades empresariales',
  2: 'Módulos: actividades agrícolas y ganaderas',
  7: 'Nuevos autónomos: el año de alta y los dos siguientes',
  15: 'Actividades profesionales',
  19: 'Alquileres y rendimientos del capital',
}

// Entre 0 y 100, con dos decimales como mucho; vacío vale 0 salvo que se admita «sin tipo»
const value = computed({
  get: (): number | null => model.value,
  set: (v: number | null) => {
    model.value = (v == null ? (props.nullable ? null : 0) : Math.min(100, Math.max(0, Math.round(v * 100) / 100))) as T
  },
})
</script>

<template>
  <div class="irpf">
    <UiInput
      v-model="value"
      :label="label"
      numeric
      suffix="%"
      :placeholder="nullable ? placeholder : '0'"
      :hint="hint ?? undefined"
      :error="error"
      autocomplete="off"
    />
    <div class="presets" role="group" :aria-label="`Tipos habituales de ${label.toLowerCase()}`">
      <button
        v-for="r in presets"
        :key="r"
        type="button"
        class="preset"
        :class="{ on: model === r }"
        :aria-pressed="model === r"
        :title="PRESET_TITLE[r]"
        @click="model = r as T"
      >
        {{ r === 0 ? 'Sin retención' : `${r} %` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.irpf {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset {
  height: 28px;
  padding: 0 10px;
  font-size: var(--text-xs);
  font-weight: 560;
  color: var(--text-2);
  white-space: nowrap;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
}

.preset:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.preset:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.preset.on {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: transparent;
}
</style>
