/** Certificado digital de la empresa (solo datos públicos, nunca la clave) */
export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'admin')
  const c = await currentCertificate(company.id)
  if (!c) return { certificate: null }
  const { path: _p, ...info } = c
  const days = Math.floor((c.validTo.getTime() - Date.now()) / 86_400_000)
  return {
    certificate: {
      ...info,
      expired: days < 0,
      expiresInDays: days,
      // Para VeriFactu el certificado debe ser del obligado (o de quien lo representa ante la AEAT)
      matchesCompany: !!c.holderNif && normalizeNif(c.holderNif) === normalizeNif(company.nif),
    },
  }
})
