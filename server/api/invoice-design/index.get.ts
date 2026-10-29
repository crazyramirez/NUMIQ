export default defineEventHandler(async (event) => {
  const { company } = await requireCompany(event, 'advisor')
  const design = await getCompanyDesign(company)
  // El pie de factura antiguo (Ajustes › Empresa) se edita ahora aquí: si el diseño no tiene el suyo, se muestra ese
  if (!design.footerText && company.invoiceFooter) design.footerText = company.invoiceFooter.slice(0, 600)
  return {
    design,
    // La versión cambia con cada logo nuevo: evita que el navegador muestre el anterior
    logoUrl: company.logoPath ? `/api/company/logo?v=${encodeURIComponent(company.logoPath.split('/').pop() ?? '')}` : null,
    signatureImageUrl: signatureImageUrl(company.emailSignaturePath),
    // Datos de la empresa con los que se rellena la firma (vista previa)
    signatureTokens: signatureTokens(company),
  }
})
