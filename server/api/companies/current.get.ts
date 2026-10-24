export default defineEventHandler(async (event) => {
  const { company, role } = await requireCompany(event, 'advisor')
  return { ...company, role }
})
