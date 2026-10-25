/** Documento que abre el visor: un archivo guardado, el PDF de una factura o cualquier URL de la app */
export interface ViewerFile {
  url: string
  name?: string | null
  mime?: string | null
  size?: number | null
  date?: string | null
  /** Descarga del servidor; si falta, se descarga lo ya cargado en el visor */
  downloadUrl?: string | null
}

interface ViewerState {
  open: boolean
  /** Montado desde la primera apertura: el visor y pdf.js no se cargan hasta que hacen falta */
  mounted: boolean
  items: ViewerFile[]
  index: number
}

/** Archivo guardado en NUMIQ (adjuntos, originales escaneados, justificantes, archivo trimestral) */
export function storedFile(f: { id: number, name?: string | null, originalName?: string | null, mime?: string | null, size?: number | null, createdAt?: string | null }): ViewerFile {
  return {
    url: `/api/files/${f.id}`,
    downloadUrl: `/api/files/${f.id}?download=1`,
    name: f.originalName ?? f.name,
    mime: f.mime,
    size: f.size,
    date: f.createdAt,
  }
}

/** Visor de documentos de la app (pantalla completa, sin abrir pestañas del navegador) */
export function useFileViewer() {
  const state = useState<ViewerState>('file-viewer', () => ({ open: false, mounted: false, items: [], index: 0 }))
  return {
    state,
    open(files: ViewerFile | ViewerFile[], index = 0) {
      const items = Array.isArray(files) ? files : [files]
      if (!items.length) return
      state.value = { open: true, mounted: true, items, index: Math.max(0, Math.min(items.length - 1, index)) }
    },
    close() {
      state.value = { ...state.value, open: false }
    },
  }
}
