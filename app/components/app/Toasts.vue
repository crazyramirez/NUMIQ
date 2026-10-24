<script setup lang="ts">
const { toasts, dismiss } = useToast()
const icons = { success: 'ph:check-circle-fill', error: 'ph:warning-circle-fill', info: 'ph:info-fill' }
const update = useAppUpdate()
</script>

<template>
  <div class="toasts" aria-live="polite" role="status">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.tone">
        <Icon :name="icons[t.tone]" class="ic" aria-hidden="true" />
        <div class="grow">
          <p class="title">{{ t.title }}</p>
          <p v-if="t.body" class="body">{{ t.body }}</p>
        </div>
        <button v-if="t.action" type="button" class="action" @click="t.action.run(); dismiss(t.id)">{{ t.action.label }}</button>
        <button type="button" class="x" aria-label="Cerrar aviso" @click="dismiss(t.id)"><Icon name="ph:x" /></button>
      </div>
      <!-- Versión nueva publicada: queda abajo, compacto, hasta que se actualice o se cierre -->
      <div v-if="update.visible.value" key="update" class="toast update">
        <Icon name="ph:arrow-clockwise-bold" class="ic" aria-hidden="true" />
        <p class="title">Nueva versión</p>
        <button type="button" class="action" @click="update.apply()">Actualizar</button>
        <button type="button" class="x" aria-label="Cerrar aviso" @click="update.dismiss()"><Icon name="ph:x" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: var(--s-5);
  bottom: calc(var(--s-5) + var(--bnav) + env(safe-area-inset-bottom));
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  width: min(380px, calc(100vw - 2 * var(--s-4)));
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 12px 13px 14px;
  color: var(--text-inverse);
  background: var(--surface-inverse);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xl);
  pointer-events: auto;
}

.ic {
  width: 19px;
  height: 19px;
  margin-top: 1px;
  flex-shrink: 0;
}

.success .ic { color: #34d399; }
.error .ic { color: #f87171; }
.info .ic { color: #818cf8; }

:root[data-theme='dark'] .success .ic { color: var(--success-solid); }
:root[data-theme='dark'] .error .ic { color: var(--danger-solid); }
:root[data-theme='dark'] .info .ic { color: var(--brand); }

.title {
  font-weight: 600;
}

.body {
  margin-top: 2px;
  font-size: var(--text-sm);
  opacity: 0.75;
}

.action {
  font-weight: 600;
  color: #a5b4fc;
  white-space: nowrap;
}

.x {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  opacity: 0.55;
  border-radius: var(--r-xs);
}

.x:hover {
  opacity: 1;
}

.update {
  align-self: flex-end;
  align-items: center;
  gap: 10px;
  padding: 7px 8px 7px 12px;
  font-size: var(--text-sm);
  border-radius: var(--r-full);
}

.update .ic {
  width: 15px;
  height: 15px;
  margin-top: 0;
  color: #818cf8;
}

:root[data-theme='dark'] .update .ic { color: var(--brand); }

.update .title {
  font-weight: 550;
  white-space: nowrap;
}

.update .action {
  padding: 3px 10px;
  background: rgb(255 255 255 / 0.1);
  border-radius: var(--r-full);
  transition: background var(--t-fast);
}

.update .action:hover {
  background: rgb(255 255 255 / 0.18);
}

:root[data-theme='dark'] .action { color: #4338ca; }
:root[data-theme='dark'] .update .action { background: rgb(0 0 0 / 0.07); }
:root[data-theme='dark'] .update .action:hover { background: rgb(0 0 0 / 0.13); }

.toast-enter-active {
  transition: transform var(--t-slow) var(--ease-spring), opacity var(--t-base);
}

.toast-leave-active {
  transition: transform 160ms var(--ease-in), opacity 160ms var(--ease-in);
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
