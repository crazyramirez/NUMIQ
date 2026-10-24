/** El navegador suele dejar el MIME vacío en archivos locales de Office. */
export function filePreviewKind(name = '', mime = '') {
  const ext = name.split('.').pop()?.toLowerCase()
  if (/^image\/(png|jpe?g|webp|gif)$/i.test(mime) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext ?? '')) return 'image'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'word'
  if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(ext ?? '') || /^(application\/vnd\.(ms-excel|openxmlformats-officedocument\.spreadsheetml\.sheet|oasis\.opendocument\.spreadsheet)|text\/(csv|tab-separated-values))$/.test(mime)) return 'sheet'
  return 'other'
}
