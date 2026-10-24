export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  return {
    design: await getCompanyDesign(company),
    // La versión cambia con cada logo nuevo: evita que el navegador muestre el anterior
    logoUrl: company.logoPath ? `/api/company/logo?v=${encodeURIComponent(company.logoPath.split('/').pop() ?? '')}` : null,
  }
})
