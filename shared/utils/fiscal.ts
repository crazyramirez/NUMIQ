/**
 * Calendario fiscal de la AEAT: trimestres y plazos de presentación de los modelos habituales de
 * autónomos y sociedades. Si el plazo acaba en fin de semana pasa al siguiente día hábil.
 * (Los festivos nacionales concretos no se tienen en cuenta.)
 */

export type Quarter = 1 | 2 | 3 | 4

export interface FiscalDeadline {
  /** Modelos que vencen ese día */
  models: string[]
  title: string
  /** Periodo al que se refiere: 3T 2026, 2026… */
  period: string
  start: string
  end: string
}

export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function quarterOf(date: Date | string): Quarter {
  const d = typeof date === 'string' ? new Date(`${date}T12:00:00`) : date
  return (Math.floor(d.getMonth() / 3) + 1) as Quarter
}

/** Primer y último día del trimestre (YYYY-MM-DD) */
export function quarterRange(year: number, q: Quarter) {
  const startMonth = (q - 1) * 3
  return {
    from: toISODate(new Date(year, startMonth, 1)),
    to: toISODate(new Date(year, startMonth + 3, 0)),
  }
}

function nextBusinessDay(d: Date) {
  const r = new Date(d)
  while (r.getDay() === 0 || r.getDay() === 6) r.setDate(r.getDate() + 1)
  return r
}

function deadline(models: string[], title: string, period: string, start: Date, end: Date): FiscalDeadline {
  return { models, title, period, start: toISODate(start), end: toISODate(nextBusinessDay(end)) }
}

/** Plazos de un año natural de presentación (incluye el 4T y anuales del año anterior en enero) */
export function deadlinesForYear(year: number, kind: 'autonomo' | 'sociedad'): FiscalDeadline[] {
  const quarterly = kind === 'autonomo' ? ['303', '130', '111', '115'] : ['303', '111', '115']
  const list: FiscalDeadline[] = [
    deadline([...quarterly], 'Trimestrales 4T', `4T ${year - 1}`, new Date(year, 0, 1), new Date(year, 0, 30)),
    deadline(['390', '190', '180'], 'Resúmenes anuales', `${year - 1}`, new Date(year, 0, 1), new Date(year, 0, 31)),
    deadline(['347'], 'Operaciones con terceros', `${year - 1}`, new Date(year, 1, 1), new Date(year, 2, 0)),
    deadline([...quarterly], 'Trimestrales 1T', `1T ${year}`, new Date(year, 3, 1), new Date(year, 3, 20)),
    deadline([...quarterly], 'Trimestrales 2T', `2T ${year}`, new Date(year, 6, 1), new Date(year, 6, 20)),
    deadline([...quarterly], 'Trimestrales 3T', `3T ${year}`, new Date(year, 9, 1), new Date(year, 9, 20)),
  ]
  if (kind === 'autonomo') {
    list.push(deadline(['100'], 'Declaración de la Renta', `${year - 1}`, new Date(year, 3, 2), new Date(year, 5, 30)))
  }
  else {
    list.push(deadline(['200'], 'Impuesto sobre Sociedades', `${year - 1}`, new Date(year, 6, 1), new Date(year, 6, 25)))
    list.push(deadline(['202'], 'Pago fraccionado IS', `1P ${year}`, new Date(year, 3, 1), new Date(year, 3, 20)))
    list.push(deadline(['202'], 'Pago fraccionado IS', `2P ${year}`, new Date(year, 9, 1), new Date(year, 9, 20)))
    list.push(deadline(['202'], 'Pago fraccionado IS', `3P ${year}`, new Date(year, 11, 1), new Date(year, 11, 20)))
  }
  return list.sort((a, b) => a.end.localeCompare(b.end))
}

/** Próximos plazos a partir de una fecha */
export function upcomingDeadlines(from: Date, kind: 'autonomo' | 'sociedad', count = 4) {
  const today = toISODate(from)
  return [...deadlinesForYear(from.getFullYear(), kind), ...deadlinesForYear(from.getFullYear() + 1, kind)]
    .filter(d => d.end >= today)
    .slice(0, count)
}

export const MODEL_NAMES: Record<string, string> = {
  '303': 'IVA trimestral',
  '130': 'Pago fraccionado IRPF',
  '111': 'Retenciones de trabajadores y profesionales',
  '115': 'Retenciones de alquileres',
  '349': 'Operaciones intracomunitarias',
  '390': 'Resumen anual de IVA',
  '347': 'Operaciones con terceros',
  '190': 'Resumen anual de retenciones',
  '180': 'Resumen anual de alquileres',
  '100': 'Renta (IRPF)',
  '200': 'Impuesto sobre Sociedades',
  '202': 'Pago fraccionado de Sociedades',
}
