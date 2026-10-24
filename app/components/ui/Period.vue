<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import type { Quarter } from '#shared/utils/fiscal'
import type { Period } from '~/utils/period'

/**
 * Selector de periodo: ‹ 2026 › con las flechas pasando de año (o de trimestre o mes, según lo elegido) y,
 * al pulsar el centro, un panel con el año, «Todo el año», los cuatro trimestres, los doce meses y
 * «Todos los años».
 */
const props = withDefaults(defineProps<{ allowAll?: boolean }>(), { allowAll: true })
const model = defineModel<Period>({ required: true })

const now = new Date()
const thisYear = now.getFullYear()
const thisQuarter = quarterOf(now)
const thisMonth = now.getMonth() + 1

const open = ref(false)
const root = ref<HTMLElement>()
const panel = ref<HTMLElement>()
onClickOutside(root, () => (open.value = false), { ignore: [panel] })
const { style, placedUp } = useFloating(root, panel, open, { align: 'start', width: 296 })

// Año a la vista en el panel: se cambia sin cerrar y se aplica al elegir
const shown = ref(model.value.year ?? thisYear)
watch(open, (v) => {
  if (v) shown.value = model.value.year ?? thisYear
})

const label = computed(() => periodLabel(model.value))
const unit = computed(() => (model.value.month ? 'Mes' : model.value.quarter ? 'Trimestre' : 'Año'))
const canNext = computed(() => !periodIsFuture(shiftPeriod(model.value, 1)))

function pick(p: Period) {
  model.value = p
  open.value = false
}

const isOn = (q: Quarter | null, m: number | null) => model.value.year === shown.value && model.value.quarter === q && model.value.month === m
const MONTHS_SHORT = MONTH_NAMES.map(m => m.slice(0, 3))

function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    open.value = false
    root.value?.querySelector<HTMLElement>('.cur')?.focus()
  }
}
</script>

<template>
  <div ref="root" class="ui-period" role="group" :aria-label="`Periodo: ${label}`" @keydown="onKey">
    <UiButton v-if="model.year" variant="ghost" size="sm" square icon="ph:caret-left" :aria-label="`${unit} anterior`" @click="model = shiftPeriod(model, -1)" />
    <button type="button" class="cur" :class="{ all: !model.year }" aria-haspopup="dialog" :aria-expanded="open" @click="open = !open">
      <Icon name="ph:calendar-blank" class="cal" aria-hidden="true" />
      <span class="num" aria-live="polite">{{ label }}</span>
      <Icon name="ph:caret-down" class="car" :class="{ flip: open }" aria-hidden="true" />
    </button>
    <UiButton v-if="model.year" variant="ghost" size="sm" square icon="ph:caret-right" :aria-label="`${unit} siguiente`" :disabled="!canNext" @click="model = shiftPeriod(model, 1)" />

    <Teleport to="body">
      <Transition name="pop">
        <div v-if="open" ref="panel" class="pp" :class="{ up: placedUp }" :style="style" role="dialog" aria-label="Elegir periodo" @keydown="onKey">
          <div class="pp-year">
            <UiButton variant="ghost" size="sm" square icon="ph:caret-left" aria-label="Año anterior" :disabled="shown <= 2000" @click="shown--" />
            <strong class="num">{{ shown }}</strong>
            <UiButton variant="ghost" size="sm" square icon="ph:caret-right" aria-label="Año siguiente" :disabled="shown >= thisYear" @click="shown++" />
          </div>

          <button type="button" class="opt full" :class="{ on: isOn(null, null) }" @click="pick({ year: shown, quarter: null, month: null })">
            Todo {{ shown }}
            <Icon v-if="isOn(null, null)" name="ph:check-bold" class="ck" aria-hidden="true" />
          </button>

          <p class="pp-h">Trimestre</p>
          <div class="grid q">
            <button
              v-for="q in ([1, 2, 3, 4] as Quarter[])"
              :key="q"
              type="button"
              class="opt"
              :class="{ on: isOn(q, null), now: shown === thisYear && q === thisQuarter, later: shown === thisYear && q > thisQuarter }"
              :aria-label="`${q}.º trimestre de ${shown}`"
              @click="pick({ year: shown, quarter: q, month: null })"
            >
              <strong>{{ q }}T</strong>
              <small>{{ QUARTER_MONTHS[q - 1] }}</small>
            </button>
          </div>

          <p class="pp-h">Mes</p>
          <div class="grid m">
            <button
              v-for="(m, i) in MONTHS_SHORT"
              :key="m"
              type="button"
              class="opt"
              :class="{ on: isOn(null, i + 1), now: shown === thisYear && i + 1 === thisMonth, later: shown === thisYear && i + 1 > thisMonth }"
              :aria-label="`${MONTH_NAMES[i]} de ${shown}`"
              @click="pick({ year: shown, quarter: null, month: i + 1 })"
            >
              {{ m }}
            </button>
          </div>

          <template v-if="props.allowAll">
            <hr class="divider sep">
            <button type="button" class="opt full every" :class="{ on: !model.year }" @click="pick({ year: null, quarter: null, month: null })">
              <Icon name="ph:infinity" aria-hidden="true" />
              Todos los años
              <Icon v-if="!model.year" name="ph:check-bold" class="ck" aria-hidden="true" />
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ui-period {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xs);
  max-width: 100%;
}

.cur {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 30px;
  min-width: 96px;
  padding: 0 10px;
  font-size: var(--text-md);
  font-weight: 650;
  color: var(--text);
  white-space: nowrap;
  border-radius: var(--r-md);
  transition: background var(--t-fast);
}

.cur:hover,
.cur[aria-expanded='true'] {
  background: var(--surface-hover);
}

.cur:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.cur.all {
  padding: 0 12px;
}

.cal {
  width: 16px;
  height: 16px;
  color: var(--brand-text);
}

.car {
  width: 12px;
  height: 12px;
  color: var(--text-3);
  transition: transform var(--t-fast);
}

.car.flip {
  transform: rotate(180deg);
}

/* ─── Panel ─── */

.pp {
  position: fixed;
  z-index: var(--z-popover);
  max-height: var(--float-max, 70vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
}

.pp-year {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 6px;
}

.pp-year strong {
  font-size: var(--text-lg);
  font-weight: 680;
  letter-spacing: -0.02em;
}

.pp-h {
  padding: 10px 4px 5px;
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-4);
}

.grid {
  display: grid;
  gap: 4px;
}

.grid.q {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.grid.m {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.opt {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-height: 34px;
  padding: 4px 2px;
  font-size: var(--text-sm);
  font-weight: 540;
  color: var(--text-2);
  background: var(--surface-sunken);
  border: 1px solid transparent;
  border-radius: var(--r-md);
  transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
}

.opt:hover {
  color: var(--text);
  background: var(--surface-hover);
  border-color: var(--border);
}

.opt:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.opt strong {
  font-weight: 650;
  font-size: var(--text-sm);
}

.opt small {
  font-size: 10.5px;
  color: var(--text-4);
  white-space: nowrap;
}

/* El mes y trimestre de hoy, marcados; los que aún no han llegado, más tenues */
.opt.now::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--brand);
}

.opt.later {
  color: var(--text-4);
}

.opt.on,
.opt.on:hover {
  color: var(--brand-text);
  background: var(--brand-soft);
  border-color: color-mix(in srgb, var(--brand) 35%, transparent);
}

.opt.on small {
  color: var(--brand-text);
  opacity: 0.8;
}

.opt.full {
  flex-direction: row;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  font-weight: 600;
}

.opt.every {
  background: none;
}

.opt.every:not(.on):hover {
  background: var(--surface-hover);
}

.ck {
  width: 13px;
  height: 13px;
}

.sep {
  margin: 8px -8px;
}

.pop-enter-active {
  transition: opacity var(--t-fast) var(--ease-out), transform var(--t-base) var(--ease-out);
}

.pop-leave-active {
  transition: opacity 100ms var(--ease-in);
}

.pop-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.pp.up.pop-enter-from {
  transform: translateY(4px) scale(0.98);
}

.pop-leave-to {
  opacity: 0;
}
</style>
