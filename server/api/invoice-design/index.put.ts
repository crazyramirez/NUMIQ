export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event, 'admin')
  const design = await readInput(event, designInputSchema)
  await saveCompanyDesign(company.id, design)
  await audit(event, { companyId: company.id, userId: user.id, action: 'design.update', data: { layout: design.layout, font: design.font } })
  return { design }
})
