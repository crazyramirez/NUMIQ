import { and, eq } from 'drizzle-orm'

/** Punto del mapa de la ficha: null si el contacto no tiene dirección o no se encuentra */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const id = idParam(event)
  const c = tables.contacts
  const [contact] = await useDb().select({
    id: c.id, address: c.address, postalCode: c.postalCode, city: c.city, province: c.province, country: c.country,
    geoLat: c.geoLat, geoLng: c.geoLng, geoPrecision: c.geoPrecision, geoKey: c.geoKey,
  }).from(c).where(and(eq(c.id, id), eq(c.companyId, company.id)))
  if (!contact) throw createError({ statusCode: 404, statusMessage: 'Contacto no encontrado' })
  try {
    return { location: await contactLocation(contact) }
  }
  catch (err) {
    console.warn('[geo] Sin ubicación para el contacto', id, (err as Error)?.message ?? err)
    throw createError({ statusCode: 502, statusMessage: 'No se pudo consultar el mapa' })
  }
})
