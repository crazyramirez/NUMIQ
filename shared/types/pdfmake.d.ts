declare module 'pdfmake' {
  interface OutputDocument {
    getBuffer(): Promise<Buffer>
  }
  interface PdfMake {
    virtualfs: { writeFileSync(name: string, content: Buffer): void, existsSync(name: string): boolean }
    setFonts(fonts: Record<string, { normal: string, bold: string, italics: string, bolditalics: string }>): void
    setUrlAccessPolicy(cb: (url: string) => boolean): void
    setLocalAccessPolicy(cb: (path: string) => boolean): void
    createPdf(definition: Record<string, unknown>): OutputDocument
  }
  const pdfmake: PdfMake
  export default pdfmake
}
