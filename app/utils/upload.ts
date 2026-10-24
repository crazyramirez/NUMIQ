/**
 * Subida con progreso (fetch no informa del envío). Los errores tienen la misma forma que los de
 * $fetch, así que errorMessage() los entiende.
 */
export function uploadForm<T>(url: string, form: FormData, onProgress?: (loaded: number, total: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T)
      else reject({ statusCode: xhr.status, data: xhr.response ?? { statusMessage: 'No se pudo subir' } })
    }
    xhr.onerror = () => reject({ data: { statusMessage: 'Sin conexión: no se pudo subir' } })
    xhr.send(form)
  })
}

/** Reparte archivos en tandas por número y tamaño para no enviar peticiones enormes */
export function chunkFiles<T extends { file: File }>(files: T[], maxFiles = 15, maxBytes = 30 * 1024 * 1024): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let bytes = 0
  for (const f of files) {
    if (current.length && (current.length >= maxFiles || bytes + f.file.size > maxBytes)) {
      out.push(current)
      current = []
      bytes = 0
    }
    current.push(f)
    bytes += f.file.size
  }
  if (current.length) out.push(current)
  return out
}
