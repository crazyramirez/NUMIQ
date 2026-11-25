/** Guarda una página como plantilla (nueva, o sobrescribe la del mismo id o nombre) */
export default defineEventHandler(async (event) => {
  const { company, user } = await requireCompany(event)
  const input = await readInput(event, pageTemplateInput)
  const page = cleanPages([input.page as DocPage])?.[0]
  if (!page) throw createError({ statusCode: 400, statusMessage: 'La página está vacía: escribe algo o añade una imagen' })
  const list = pageTemplatesOf(company)
  const at = list.findIndex(t => (input.id && t.id === input.id) || t.name.toLowerCase() === input.name.toLowerCase())
  if (at < 0 && list.length >= 30) throw createError({ statusCode: 400, statusMessage: 'Máximo 30 plantillas: borra alguna que ya no uses' })
  const tpl: PageTemplate = { id: at >= 0 ? list[at]!.id : pageId(), name: input.name, page: { ...page, id: 'tpl' + pageId().slice(0, 5) }, updatedAt: new Date().toISOString() }
  const next = at >= 0 ? list.map((t, i) => (i === at ? tpl : t)) : [...list, tpl]
  await savePageTemplates(company, next)
  await audit(event, { companyId: company.id, userId: user.id, action: 'sales.page_template', data: { name: input.name, replaced: at >= 0 } })
  return { template: tpl, list: next, replaced: at >= 0 }
})
