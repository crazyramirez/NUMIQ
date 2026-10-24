<script setup lang="ts">
import type { SalesInvoiceLink } from '#shared/types/sales-links'

withDefaults(defineProps<{ invoices: SalesInvoiceLink[], size?: 'sm' | 'md' }>(), { size: 'sm' })
</script>

<template>
  <UiButton
    v-if="invoices.length === 1"
    :size="size"
    icon="ph:receipt"
    :to="`/facturas/${invoices[0]!.id}`"
    :title="`Ver factura ${invoices[0]!.number ?? 'sin número'}`"
    :aria-label="`Ver factura ${invoices[0]!.number ?? 'sin número'}`"
  >Ver factura</UiButton>
  <UiMenu
    v-else-if="invoices.length > 1"
    :items="invoices.map(invoice => ({ label: invoice.number ?? 'Factura sin número', icon: 'ph:receipt', to: `/facturas/${invoice.id}`, hint: salesStatus('invoice', invoice.status, false).label }))"
  >
    <template #default="{ toggle }">
      <UiButton :size="size" icon="ph:receipt" @click="toggle">Ver facturas ({{ invoices.length }})</UiButton>
    </template>
  </UiMenu>
</template>
