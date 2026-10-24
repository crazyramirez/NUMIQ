import { z } from 'zod'

const text = z.string().max(6000).nullable()
const draft = z.object({
  kind: z.enum(['company', 'person']).nullable(),
  name: text,
  tradeName: text,
  contactPerson: text,
  nif: text,
  nifType: z.enum(['nif', 'vat_eu', 'passport', 'other']).nullable(),
  email: text,
  phone: text,
  website: text,
  address: text,
  postalCode: text,
  city: text,
  province: text,
  country: text,
  iban: text,
  paymentTermsDays: z.number().nullable(),
  irpfRate: z.number().nullable(),
  notes: text,
})

const schema = z.object({
  files: z.array(z.string().max(255)).max(20).default([]),
  rows: z.array(z.object({
    id: z.number().int(),
    action: z.enum(['create', 'fill', 'update']),
    data: draft,
    isClient: z.boolean(),
    isSupplier: z.boolean(),
    matchId: z.number().int().positive().nullable(),
  })).min(1, 'No hay ningún contacto que importar').max(10_000),
})

/** Crea y completa las fichas revisadas; devuelve el id de la importación para poder deshacerla */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const { rows, files } = await readInput(event, schema)
  const ip = getRequestIP(event, { xForwardedFor: true })?.slice(0, 45) ?? null
  return commitContactImport(company, user.id, rows, files, ip)
})
