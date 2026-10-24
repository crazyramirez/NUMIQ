<script setup lang="ts">
const { state, settle } = useConfirm()
const open = computed({
  get: () => !!state.value,
  set: (v) => {
    if (!v) settle(false)
  },
})
</script>

<template>
  <UiModal v-model="open" size="sm">
    <div v-if="state" class="confirm">
      <div class="ic" :class="{ danger: state.danger }" aria-hidden="true">
        <Icon :name="state.danger ? 'ph:warning-fill' : 'ph:question-fill'" />
      </div>
      <h2>{{ state.title }}</h2>
      <p v-if="state.body">{{ state.body }}</p>
    </div>
    <template #footer>
      <UiButton @click="settle(false)">{{ state?.cancelLabel ?? 'Cancelar' }}</UiButton>
      <UiButton :variant="state?.danger ? 'danger' : 'primary'" autofocus @click="settle(true)">{{ state?.confirmLabel ?? 'Confirmar' }}</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.confirm {
  text-align: center;
  padding-top: var(--s-2);
}

.ic {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin: 0 auto var(--s-4);
  font-size: 24px;
  color: var(--brand-text);
  background: var(--brand-soft);
  border-radius: 50%;
}

.ic.danger {
  color: var(--danger);
  background: var(--danger-soft);
}

h2 {
  font-size: var(--text-lg);
}

p {
  margin-top: var(--s-2);
  color: var(--text-3);
  white-space: pre-line;
}
</style>
