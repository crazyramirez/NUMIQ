/**
 * Validación de identificadores fiscales españoles: DNI/NIF de persona física, NIE y NIF de
 * persona jurídica (antiguo CIF), con su dígito de control.
 */

export type NifKind = 'dni' | 'nie' | 'cif'

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'
const CIF_LETTERS = 'JABCDEFGHI'

export function normalizeNif(raw: string) {
  return raw.toUpperCase().replace(/[\s.\-/]/g, '')
}

export function validateNif(raw: string | null | undefined): { valid: boolean, kind?: NifKind, value: string } {
  const value = normalizeNif(raw ?? '')

  // DNI: 8 cifras + letra
  if (/^\d{8}[A-Z]$/.test(value)) {
    return { valid: DNI_LETTERS[Number(value.slice(0, 8)) % 23] === value[8], kind: 'dni', value }
  }

  // NIE: X/Y/Z + 7 cifras + letra (X=0, Y=1, Z=2)
  if (/^[XYZ]\d{7}[A-Z]$/.test(value)) {
    const n = Number('XYZ'.indexOf(value[0]!) + value.slice(1, 8))
    return { valid: DNI_LETTERS[n % 23] === value[8], kind: 'nie', value }
  }

  // Persona jurídica: letra de entidad + 7 cifras + control (cifra o letra según el tipo)
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value)) {
    const digits = value.slice(1, 8)
    let sum = 0
    for (let i = 0; i < 7; i++) {
      let d = Number(digits[i])
      if (i % 2 === 0) {
        d *= 2
        d = Math.floor(d / 10) + (d % 10)
      }
      sum += d
    }
    const control = (10 - (sum % 10)) % 10
    const last = value[8]!
    const letterOnly = 'NPQRSW'.includes(value[0]!)
    const digitOnly = 'ABEH'.includes(value[0]!)
    const okDigit = last === String(control)
    const okLetter = last === CIF_LETTERS[control]
    return { valid: letterOnly ? okLetter : digitOnly ? okDigit : okDigit || okLetter, kind: 'cif', value }
  }

  return { valid: false, value }
}

/** NIF-IVA intracomunitario: prefijo de país UE + identificador (validación de forma, no VIES) */
export function looksLikeEuVat(raw: string) {
  return /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[0-9A-Z]{2,13}$/.test(normalizeNif(raw))
}
