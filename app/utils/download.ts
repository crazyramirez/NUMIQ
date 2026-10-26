/** Guarda en el dispositivo un archivo pedido con `$fetch.raw(..., { responseType: 'blob' })`, con el nombre que da el servidor */
export function saveDownload(res: { headers: Headers, _data?: Blob }, fallback: string) {
  const disposition = res.headers.get('content-disposition') ?? ''
  const name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] || disposition.match(/filename="?([^";]+)"?/)?.[1] || '') || fallback
  const url = URL.createObjectURL(res._data!)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
