import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'

/**
 * Asistente financiero: responde con las cifras reales de la empresa y opera sobre sus datos. El
 * modelo no ve la base de datos: consulta con herramientas filtradas por la empresa activa y, para
 * cambiar algo, solo prepara propuestas que el usuario confirma (assistant-actions.ts).
 */

type Company = typeof tables.companies.$inferSelect

// ─── Herramientas ────────────────────────────────────────────────────────────

const int = { type: ['integer', 'null'] }
const str = (description?: string) => ({ type: ['string', 'null'], ...(description ? { description } : {}) })
const num = (description?: string) => ({ type: ['number', 'null'], ...(description ? { description } : {}) })
const bool = (description?: string) => ({ type: ['boolean', 'null'], ...(description ? { description } : {}) })
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const PAY_ENUM = { type: ['string', 'null'], enum: ['transferencia', 'tarjeta', 'efectivo', 'domiciliacion', 'bizum', 'otro', null] }
const EXPENSE_KIND_ENUM = { type: ['string', 'null'], enum: ['factura', 'ticket', 'nomina', 'seguridad_social', 'impuesto', 'otro', null] }
const clear = (fields: string[]) => ({ type: ['array', 'null'], items: { type: 'string', enum: fields }, description: 'Datos que hay que dejar en blanco (borrar su valor)' })
/** Tipo de gasto con las palabras del filtro (filtro.tipo) */
const EXPENSE_KIND_ES: Readonly<Record<string, string>> = Object.freeze({ invoice: 'factura', ticket: 'ticket', payroll: 'nomina', social_security: 'seguridad_social', tax: 'impuesto', other: 'otro' })

/** Qué registros: el mismo filtro para todas las entidades (cada una usa los campos que le aplican) */
const FILTER = obj({
  ids: { type: ['array', 'null'], items: { type: 'integer' }, description: 'Ids exactos (los que devuelve listar)' },
  todos: { type: 'boolean', description: 'true SOLO si el usuario pide expresamente todos los registros, sin más filtro' },
  nombres: { type: ['array', 'null'], items: { type: 'string' }, description: 'Facturas/presupuestos: clientes. Gastos: proveedores, perceptores o comercios. Movimientos: textos del concepto u ordenante. Contactos: nombres o NIF. Productos: nombres. Recurrentes: su nombre o el cliente/proveedor. Varios = cualquiera de ellos ("Paloma y Andrés" → ["Paloma", "Andrés"])' },
  texto: str('Texto dentro del concepto, la descripción o las notas'),
  estado: { type: ['string', 'null'], enum: ['borrador', 'emitida', 'pendiente', 'enviado', 'cobrada', 'vencida', 'anulada', 'aceptado', 'rechazado', 'facturado', 'pagada', 'por_aprobar', 'por_revisar', 'conciliado', 'ignorado', 'activo', 'pausado', null], description: 'Facturas: borrador, emitida, pendiente (de cobro), cobrada, vencida, anulada. Presupuestos: pendiente, enviado, aceptado, rechazado, facturado. Gastos: pendiente o pagada (de pago), por_aprobar o rechazado (aprobación del equipo), por_revisar. Movimientos: pendiente (por revisar), conciliado o ignorado. Recurrentes: activo o pausado' },
  tipo: { type: ['string', 'null'], enum: ['rectificativa', 'factura', 'ticket', 'nomina', 'seguridad_social', 'impuesto', 'otro', 'cargo', 'abono', 'cliente', 'proveedor', 'servicio', 'producto', null], description: 'Facturas: rectificativa. Gastos: factura, ticket, nomina, seguridad_social, impuesto, otro. Movimientos: cargo o abono. Contactos: cliente o proveedor. Productos: servicio o producto' },
  categoria: str('Categoría de gasto (gastos) o de catálogo (productos); "ninguna" = sin categoría'),
  desde: str('Fecha inicial AAAA-MM-DD (emisión o movimiento)'),
  hasta: str('Fecha final AAAA-MM-DD'),
  importe_min: num('Importe mínimo (total con impuestos; en movimientos, en valor absoluto)'),
  importe_max: num('Importe máximo'),
  numeros: { type: ['array', 'null'], items: { type: 'string' }, description: 'Números exactos de factura o gasto' },
})

export function assistantToolDefs() {
  const fn = (name: string, description: string, properties: Record<string, unknown> = {}) => ({
    type: 'function',
    name,
    description,
    strict: true,
    parameters: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
  })
  return [
    fn('resumen_periodo', 'Cuenta de resultados de un año, trimestre o mes: ingresos, gastos, beneficio, margen, IVA repercutido y soportado, retenciones (111, 115), estimación del 130, mejores clientes y proveedores, gastos por categoría y comparación con el periodo anterior y el mismo del año pasado.', {
      anio: { type: 'integer', description: 'Año, p. ej. 2026' },
      trimestre: { ...int, description: '1 a 4, o null para el año o un mes' },
      mes: { ...int, description: '1 a 12, o null' },
    }),
    fn('cobros_pendientes', 'Facturas emitidas pendientes de cobro con cliente, importe pendiente, vencimiento y días de retraso.'),
    fn('pagos_pendientes', 'Gastos y facturas recibidas pendientes de pago.'),
    fn('banco', 'Saldo de las cuentas bancarias importadas, últimos movimientos y cuántos quedan por conciliar.'),
    fn('calendario_fiscal', 'Próximos plazos de impuestos (303, 130, 111, 115, 390, 190, 180, 347, renta…) con el importe estimado de cada modelo trimestral y si ya consta presentado.'),
    fn('evolucion_mensual', 'Ingresos, gastos y beneficio mes a mes de los últimos meses.', {
      meses: { type: 'integer', description: 'Cuántos meses hacia atrás (1 a 36), incluido el actual' },
    }),
    fn('buscar', 'Busca clientes, proveedores, facturas emitidas y gastos por nombre, NIF, número o concepto.', {
      texto: { type: 'string' },
    }),
    fn('detalle_factura', 'Detalle completo de una factura emitida o recibida por su número (líneas, importes, estado, cobros).', {
      numero: { type: 'string' },
    }),
    fn('crear_borrador', 'Crea un BORRADOR de factura (no se emite ni se envía: el usuario la revisa y la emite él) o un presupuesto (los presupuestos no tienen borrador: queda pendiente, con su número, sin enviar) para un cliente que ya existe. Úsalo solo cuando el usuario pida preparar una factura o un presupuesto. Si faltan el cliente o los conceptos, pregúntalos antes.', {
      tipo: { type: 'string', enum: ['factura', 'presupuesto'] },
      cliente: { type: 'string', description: 'Nombre o NIF del cliente tal como lo dice el usuario' },
      lineas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['concepto', 'cantidad', 'precio', 'iva'],
          properties: {
            concepto: { type: 'string' },
            cantidad: { type: 'number' },
            precio: { type: ['number', 'null'], description: 'Precio unitario sin IVA; null para usar el del catálogo' },
            iva: { type: ['number', 'null'], description: 'Tipo de IVA; null para el habitual' },
          },
        },
      },
      fecha: { type: ['string', 'null'], description: 'AAAA-MM-DD; null = hoy' },
      notas: { type: ['string', 'null'] },
    }),
    fn('listar', 'Lista registros con un filtro preciso y devuelve cuántos hay, el importe total y sus ids (con base, IVA, retención y total de cada uno). Úsalo para responder "¿cuántas facturas tiene X?" o para comprobar el alcance antes de proponer un cambio.', {
      entidad: { type: 'string', enum: ['facturas', 'presupuestos', 'gastos', 'movimientos', 'contactos', 'productos', 'recurrentes', 'categorias'] },
      filtro: FILTER,
    }),
    fn('operar_facturas', 'Prepara un cambio sobre facturas o presupuestos para que el usuario lo confirme. modificar: cualquier dato (cliente, importe total o base, líneas y conceptos, precios, cantidades, descuento, IVA, retención, fechas, vencimiento, forma de pago, notas, condiciones, referencia, descripción). También eliminar, emitir borradores, marcar cobradas o quitar cobros (marcar_pendientes; en presupuestos, volver a pendiente), marcar enviadas, aceptar o rechazar presupuestos, convertir presupuestos en factura y devolver facturas a borrador. NO ejecuta nada: crea una propuesta con los registros exactos.', {
      documentos: { type: 'string', enum: ['facturas', 'presupuestos'] },
      accion: { type: 'string', enum: ['modificar', 'eliminar', 'emitir', 'marcar_cobradas', 'marcar_pendientes', 'marcar_enviadas', 'marcar_aceptados', 'marcar_rechazados', 'convertir_en_factura', 'pasar_a_borrador'] },
      filtro: FILTER,
      cambios: obj({
        cliente: str('Nuevo cliente (nombre o NIF) para reasignar los documentos'),
        base: num('Nueva base imponible del documento: los precios de las líneas se ajustan en proporción'),
        total: num('Nuevo total con impuestos del documento: los precios se ajustan para llegar a él'),
        lineas: {
          type: ['array', 'null'],
          description: 'Cambios en las líneas (conceptos), aplicados en orden',
          items: obj({
            accion: { type: 'string', enum: ['anadir', 'modificar', 'quitar'] },
            buscar: str('modificar o quitar: texto del concepto de la línea; null en modificar = todas las líneas'),
            concepto: str('Concepto nuevo (obligatorio al añadir)'),
            cantidad: num(),
            precio: num('Precio unitario sin IVA (al añadir, null = el del catálogo)'),
            iva: num('21, 10, 5, 4 o 0 (al añadir, null = el habitual)'),
            descuento: num('% de descuento de la línea'),
          }),
        },
        descuento: num('% de descuento para todas las líneas; 0 para quitarlo'),
        irpf: num('Retención de IRPF en %, p. ej. 15; 0 para quitarla'),
        iva: num('Tipo de IVA para todas las líneas: 21, 10, 5, 4 o 0'),
        fecha: str('Nueva fecha de emisión AAAA-MM-DD (o fecha del cobro al marcar cobradas)'),
        vencimiento: str('Nueva fecha de vencimiento AAAA-MM-DD'),
        fecha_operacion: str('Fecha de la operación AAAA-MM-DD si es distinta de la de emisión'),
        forma_pago: PAY_ENUM,
        notas: str(),
        condiciones: str(),
        referencia: str('Referencia o nº de pedido del cliente'),
        descripcion: str('Descripción del trabajo que va antes de las líneas'),
        vaciar: clear(['notas', 'condiciones', 'referencia', 'vencimiento', 'fecha_operacion', 'descripcion']),
      }),
    }),
    fn('enviar_email', 'Prepara el envío por email de facturas o presupuestos con su PDF (o un recordatorio de pago) para que el usuario lo confirme. NO envía nada hasta que confirme. Los borradores solo pueden enviarse a la empresa o al propio usuario, para revisarlos (van con la marca BORRADOR); al cliente solo van documentos emitidos.', {
      documentos: { type: 'string', enum: ['facturas', 'presupuestos'] },
      filtro: FILTER,
      para: { type: 'array', items: { type: 'string' }, description: 'Destinatarios: "cliente" (el email de cada documento), "empresa" (el email de la empresa en Ajustes), "yo" (el email del usuario que habla contigo), "gestor" (el asesor configurado) o direcciones de email concretas. «Envíamela» = ["yo"]; «al email de la empresa» = ["empresa"]' },
      copia: { type: ['array', 'null'], items: { type: 'string' }, description: 'CC, con los mismos valores que para' },
      recordatorio: bool('true para un recordatorio de pago de facturas pendientes en vez del envío normal'),
      asunto: str('Solo si el usuario lo pide; null = el habitual de la empresa'),
      mensaje: str('Texto del correo solo si el usuario lo dicta o pide algo concreto; null = el habitual de la empresa'),
      adjuntos: bool('true para adjuntar también los archivos del documento (pedido, albarán…)'),
    }),
    fn('operar_gastos', 'Prepara un cambio sobre gastos (facturas recibidas, tickets, nóminas, Seguridad Social, impuestos, cuotas) para que el usuario lo confirme. modificar: cualquier dato (importes: base imponible, total, cuota de IVA o desglose por tipos; IVA, retención, proveedor, categoría, tipo, % deducible, fecha, vencimiento, número, descripción, notas, forma de pago, bien de inversión, inversión del sujeto pasivo, revisado). También eliminar, marcar como pagados, quitar los pagos (marcar_pendientes) y aprobar o rechazar gastos del equipo. NO ejecuta nada.', {
      accion: { type: 'string', enum: ['modificar', 'eliminar', 'marcar_pagados', 'marcar_pendientes', 'aprobar', 'rechazar'] },
      filtro: FILTER,
      cambios: obj({
        proveedor: str('Nuevo proveedor o perceptor (nombre o NIF); si no existe se crea'),
        categoria: str('Categoría de gasto (nombre o cuenta, p. ej. "Suministros" o "628"); "ninguna" para quitarla'),
        tipo: EXPENSE_KIND_ENUM,
        base: num('Nueva base imponible (en nóminas, el bruto). Se mantienen los tipos de IVA y retención y se recalculan cuotas y total'),
        total: num('Nuevo total con impuestos, lo pagado (en nóminas, el neto). Se mantienen los tipos y se recalculan base y cuotas. Con base también, la cuota de IVA sale de la diferencia'),
        cuota_iva: num('Cuota de IVA exacta que figura en la factura'),
        desglose: {
          type: ['array', 'null'],
          description: 'Desglose completo por tipos de IVA (sustituye al actual); para gastos con varios tipos',
          items: obj({
            base: { type: 'number' },
            iva: { type: 'number', description: '21, 10, 5, 4 o 0' },
            cuota: num('Cuota exacta si figura en la factura; null = se calcula'),
            recargo: bool('Lleva recargo de equivalencia'),
          }),
        },
        iva: num('Tipo de IVA (21, 10, 5, 4 o 0). Sin base ni total, se mantiene el total pagado'),
        irpf: num('Retención que practica el proveedor en % (en nóminas, la del IRPF)'),
        deducible: num('% deducible del gasto (0 = no deducible, p. ej. gasto personal)'),
        iva_deducible: num('% del IVA deducible; null = igual que el deducible'),
        fecha: str('Nueva fecha AAAA-MM-DD (o fecha del pago al marcar pagados)'),
        vencimiento: str('Fecha de vencimiento AAAA-MM-DD'),
        numero: str('Número de la factura del proveedor (de uno en uno)'),
        descripcion: str(),
        notas: str(),
        forma_pago: PAY_ENUM,
        bien_inversion: bool('Es un bien de inversión (ordenador, vehículo, maquinaria…)'),
        inversion_sujeto_pasivo: bool('Adquisición intracomunitaria o inversión del sujeto pasivo'),
        revisado: bool('true = darlo por revisado; false = marcarlo para revisar'),
        motivo: str('rechazar: motivo para quien lo registró'),
        vaciar: clear(['descripcion', 'notas', 'numero', 'vencimiento', 'forma_pago']),
      }),
    }),
    fn('operar_banco', 'Prepara un cambio sobre movimientos de los extractos bancarios para que el usuario lo confirme: crear_gasto (asignar cargos a una categoría de gasto; si ya tenían gasto lo reclasifica), ignorar (revisado sin documento con un motivo: "Gasto personal", "Traspaso entre cuentas", "Pago de impuestos"…), deshacer (volver a dejarlos por revisar) o eliminar. NO ejecuta nada.', {
      accion: { type: 'string', enum: ['crear_gasto', 'ignorar', 'deshacer', 'eliminar'] },
      filtro: FILTER,
      opciones: obj({
        categoria: str('crear_gasto: categoría de gasto (obligatoria)'),
        proveedor: str('crear_gasto: nombre limpio del comercio o proveedor; null = el ordenante del banco'),
        iva: num('crear_gasto: IVA incluido en el cargo (21, 10, 5, 4 o 0); null = 21, o 0 en nóminas, Seguridad Social y comisiones'),
        tipo_gasto: EXPENSE_KIND_ENUM,
        deducible: num('crear_gasto: % deducible; null = el habitual'),
        iva_deducible: num('crear_gasto: % del IVA deducible; null = igual que el deducible'),
        motivo: str('ignorar: motivo, p. ej. "Gasto personal"'),
      }),
    }),
    fn('operar_contactos', 'Prepara un cambio sobre clientes o proveedores para que el usuario lo confirme: modificar cualquier dato de su ficha (nombre, NIF, email, teléfono, web, dirección, IBAN, persona de contacto, retención, días de pago, recargo, categoría de gasto por defecto, notas…) o eliminarlos. NO ejecuta nada.', {
      accion: { type: 'string', enum: ['modificar', 'eliminar'] },
      filtro: FILTER,
      cambios: obj({
        nombre: str(), nombre_comercial: str(), nif: str(), email: str(), telefono: str(), web: str(), direccion: str(), cp: str(), ciudad: str(), provincia: str(),
        pais: str('Código de dos letras'), iban: str(),
        persona_contacto: str('Persona con la que se trata'),
        tipo_persona: { type: ['string', 'null'], enum: ['persona', 'empresa', null], description: 'Persona física o empresa' },
        dias_pago: num('Días de vencimiento de sus facturas'),
        irpf: num('Retención de IRPF en % que se aplica a este cliente en facturas nuevas'),
        recargo_equivalencia: bool(), es_cliente: bool(), es_proveedor: bool(),
        categoria_gasto: str('Categoría de gasto por defecto (proveedores)'),
        notas: str(),
        vaciar: clear(['nombre_comercial', 'persona_contacto', 'nif', 'email', 'telefono', 'web', 'direccion', 'cp', 'ciudad', 'provincia', 'iban', 'dias_pago', 'irpf', 'categoria_gasto', 'notas']),
      }),
    }),
    fn('operar_productos', 'Prepara un cambio sobre el catálogo de productos y servicios para que el usuario lo confirme: modificar (precio, subida en %, IVA, categoría, nombre, referencia, unidad, descripción…) o eliminar. NO ejecuta nada.', {
      accion: { type: 'string', enum: ['modificar', 'eliminar'] },
      filtro: FILTER,
      cambios: obj({
        nombre: str(), precio: num('Precio unitario sin IVA'), subir_pct: num('Subida (o bajada, en negativo) del precio en %'),
        iva: num(), categoria: str(), tipo: { type: ['string', 'null'], enum: ['servicio', 'producto', null] }, unidad: str(), descripcion: str(),
        referencia: str('Referencia o código (SKU)'),
        vaciar: clear(['unidad', 'descripcion', 'referencia', 'categoria']),
      }),
    }),
    fn('operar_recurrentes', 'Prepara un cambio sobre facturas o gastos recurrentes (igualas, cuotas, alquileres, nóminas, suscripciones que NUMIQ genera solo cada periodo) para que el usuario lo confirme: modificar (importe base o total, IVA, retención, próxima fecha, fecha final, frecuencia, concepto, categoría, cliente o proveedor, forma de pago, si se emite o se envía sola…), pausar, reanudar o eliminar. Solo cambia lo que se genere a partir de ahora. NO ejecuta nada.', {
      de: { type: ['string', 'null'], enum: ['facturas', 'gastos', null], description: 'Facturas o gastos recurrentes; null = ambos' },
      accion: { type: 'string', enum: ['modificar', 'pausar', 'reanudar', 'eliminar'] },
      filtro: FILTER,
      cambios: obj({
        nombre: str(),
        base: num('Base imponible de cada documento (en nóminas, el bruto)'),
        total: num('Total con impuestos de cada documento (en nóminas, el neto)'),
        iva: num('21, 10, 5, 4 o 0'),
        irpf: num('Retención en %'),
        proxima_fecha: str('Próxima fecha AAAA-MM-DD (fija el día del mes de la serie)'),
        fecha_fin: str('Último día AAAA-MM-DD'),
        frecuencia: { type: ['string', 'null'], enum: ['semanal', 'mensual', 'trimestral', 'anual', null] },
        cada: num('Cada cuántos periodos (1 = todos)'),
        concepto: str(),
        categoria: str('Categoría de gasto (gastos)'),
        contacto: str('Nuevo cliente (facturas) o proveedor (gastos)'),
        forma_pago: PAY_ENUM,
        deducible: num('% deducible (gastos)'),
        pagado: bool('Gastos: se dan por pagados al generarse'),
        automatico: bool('Facturas: se emiten solas (false = borrador para revisar). Gastos: se anotan sin pedir revisión'),
        enviar_sola: bool('Facturas: se envían solas al cliente al emitirse'),
        vaciar: clear(['fecha_fin', 'concepto', 'categoria']),
      }),
    }),
    fn('crear_contacto', 'Da de alta un cliente o proveedor nuevo. Se crea al momento (el usuario puede deshacerlo). Úsalo solo cuando lo pidan.', {
      nombre: { type: 'string' },
      tipo: { type: 'string', enum: ['cliente', 'proveedor', 'ambos'] },
      persona: { type: 'boolean', description: 'true si es una persona física' },
      nif: str(), email: str(), telefono: str(), direccion: str(), cp: str(), ciudad: str(), provincia: str(), pais: str('Código de dos letras; null = ES'),
      irpf: num('Retención que se le aplica en %'), dias_pago: num(), notas: str(),
    }),
    fn('crear_producto', 'Da de alta un producto o servicio en el catálogo. Se crea al momento (el usuario puede deshacerlo).', {
      nombre: { type: 'string' },
      precio: { type: 'number', description: 'Precio unitario sin IVA' },
      iva: num('null = el habitual de la empresa'),
      tipo: { type: ['string', 'null'], enum: ['servicio', 'producto', null] },
      unidad: str(), descripcion: str(), categoria: str(),
    }),
    fn('crear_gasto', 'Anota un gasto nuevo (factura recibida, ticket…). Se crea al momento (el usuario puede deshacerlo). Pregunta el importe y el proveedor si faltan.', {
      proveedor: str('Nombre o NIF; si no existe se crea'),
      fecha: str('AAAA-MM-DD; null = hoy'),
      descripcion: str(),
      numero: str('Número de la factura del proveedor'),
      importe: { type: 'number' },
      importe_incluye_iva: { type: 'boolean', description: 'true si el importe es el total con IVA (lo normal en un ticket)' },
      iva: num('21, 10, 5, 4 o 0; null = 21'),
      irpf: num('Retención que practica el proveedor en %'),
      categoria: str(),
      tipo: EXPENSE_KIND_ENUM,
      pagado: { type: 'boolean' },
      forma_pago: PAY_ENUM,
      deducible: num('% deducible; null = el habitual'),
    }),
  ]
}

export const TOOL_LABELS: Record<string, string> = {
  resumen_periodo: 'Revisando tus cifras',
  cobros_pendientes: 'Mirando los cobros pendientes',
  pagos_pendientes: 'Mirando los pagos pendientes',
  calendario_fiscal: 'Calculando tus impuestos',
  evolucion_mensual: 'Analizando la evolución',
  buscar: 'Buscando en tus datos',
  detalle_factura: 'Abriendo la factura',
  crear_borrador: 'Preparando el borrador',
  banco: 'Mirando el banco',
  listar: 'Buscando los registros',
  operar_facturas: 'Preparando el cambio',
  enviar_email: 'Preparando el correo',
  operar_gastos: 'Preparando el cambio',
  operar_banco: 'Preparando el cambio',
  operar_contactos: 'Preparando el cambio',
  operar_productos: 'Preparando el cambio',
  operar_recurrentes: 'Preparando el cambio',
  crear_contacto: 'Creando el contacto',
  crear_producto: 'Creando el producto',
  crear_gasto: 'Anotando el gasto',
}

const WRITE_TOOLS = new Set(['crear_borrador', 'operar_facturas', 'enviar_email', 'operar_gastos', 'operar_banco', 'operar_contactos', 'operar_productos', 'operar_recurrentes', 'crear_contacto', 'crear_producto', 'crear_gasto'])

/** Saldos y últimos movimientos del banco */
async function bancoResumen(company: Company) {
  const db = useDb()
  const t = tables.bankTransactions
  const [accounts, recent, pending] = await Promise.all([
    db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, company.id)),
    db.select({ fecha: t.date, importe: t.amount, concepto: t.description, estado: t.status }).from(t).where(eq(t.companyId, company.id)).orderBy(desc(t.date), desc(t.id)).limit(15),
    db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(t).where(and(eq(t.companyId, company.id), eq(t.status, 'pending'))),
  ])
  if (!accounts.length) return { aviso: 'Aún no hay extractos importados: se suben en Banco (/banco) en formato Norma 43, Excel o CSV, o la exportación a Excel de Money Manager.' }
  return {
    cuentas: accounts.map(a => ({ nombre: a.name, iban: a.iban ? `${a.iban.slice(0, 4)}···${a.iban.slice(-4)}` : null, saldo: a.balance, saldoA: a.balanceAt })),
    saldoTotal: round2(accounts.reduce((s, a) => s + a.balance, 0)),
    porConciliar: pending[0]?.n ?? 0,
    ultimosMovimientos: recent,
    enlace: '/banco',
  }
}

const r2 = (n: number | null | undefined) => (n == null ? null : round2(n))

async function resumenPeriodo(company: Company, a: { anio: number, trimestre: number | null, mes: number | null }) {
  const period = resolveReportPeriod(a.anio, a.trimestre && a.trimestre >= 1 && a.trimestre <= 4 ? a.trimestre : null, a.mes && a.mes >= 1 && a.mes <= 12 ? a.mes : null)
  const r = await buildReport(company, period)
  return {
    periodo: r.period.label,
    desde: r.period.from,
    hasta: r.period.to,
    en_curso: r.period.partial,
    cuenta_resultados: r.pnl,
    iva: r.vat.totals,
    iva_repercutido_por_tipo: r.vat.charged,
    retenciones: { soportadas_en_mis_facturas: r.irpf.withheld.amount, modelo_111: r.irpf.m111, modelo_115: r.irpf.m115, modelo_130_estimado: r.irpf.m130 },
    comparacion: r.compare,
    mejores_clientes: r.topClients.slice(0, 6).map(c => ({ ...c, url: c.id ? `/clientes/${c.id}` : null })),
    mayores_proveedores: r.topSuppliers.slice(0, 6).map(c => ({ ...c, url: c.id ? `/proveedores/${c.id}` : null })),
    gastos_por_categoria: r.expensesByCategory.slice(0, 10),
    por_columnas: r.columns.map(c => ({ periodo: c.label, ingresos: c.metrics.income, gastos: c.metrics.expenses, beneficio: c.profit, iva: c.vatResult, m130: c.m130, futuro: c.future })),
    cobros_pendientes: r.receivables,
    pagos_pendientes: r.payables,
  }
}

async function cobrosPendientes(company: Company) {
  const s = tables.salesDocuments
  const c = tables.contacts
  const today = toISODate(new Date())
  const rows = await useDb().select({
    id: s.id, number: s.number, issueDate: s.issueDate, dueDate: s.dueDate, total: s.total, paid: s.paidTotal, status: s.status,
    client: sql<string>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')))`, email: c.email,
  }).from(s).leftJoin(c, eq(c.id, s.contactId))
    .where(and(eq(s.companyId, company.id), inArray(s.kind, ['invoice', 'rectifying']), inArray(s.status, [...OPEN_STATUSES])))
    .orderBy(asc(s.dueDate)).limit(60)
  const list = rows.map(r => ({
    factura: r.number,
    cliente: r.client,
    email_cliente: r.email,
    emitida: r.issueDate,
    vence: r.dueDate,
    pendiente: round2(r.total - r.paid),
    dias_vencida: r.dueDate && r.dueDate < today ? Math.round((Date.now() - new Date(`${r.dueDate}T12:00:00`).getTime()) / 86_400_000) : 0,
    estado: r.status,
    url: `/facturas/${r.id}`,
  }))
  return {
    total_pendiente: round2(list.reduce((s, x) => s + x.pendiente, 0)),
    total_vencido: round2(list.filter(x => x.dias_vencida > 0).reduce((s, x) => s + x.pendiente, 0)),
    facturas: list,
  }
}

async function pagosPendientes(company: Company) {
  const e = tables.expenses
  const rows = await useDb().select({ id: e.id, number: e.number, issueDate: e.issueDate, dueDate: e.dueDate, total: e.total, paid: e.paidTotal, supplier: e.supplier, description: e.description })
    .from(e).where(and(eq(e.companyId, company.id), inArray(e.status, ['pending', 'partial'])))
    .orderBy(asc(e.dueDate)).limit(60)
  const list = rows.map(r => ({ proveedor: r.supplier?.name ?? null, numero: r.number, concepto: r.description, fecha: r.issueDate, vence: r.dueDate, pendiente: round2(r.total - r.paid), url: `/gastos?ver=${r.id}` }))
  return { total_pendiente: round2(list.reduce((s, x) => s + x.pendiente, 0)), gastos: list }
}

async function calendarioFiscal(company: Company) {
  const now = new Date()
  const upcoming = upcomingDeadlines(now, company.kind, 6)
  const filings = await useDb().select({ model: tables.taxFilings.model, year: tables.taxFilings.year, period: tables.taxFilings.period, status: tables.taxFilings.status, result: tables.taxFilings.result })
    .from(tables.taxFilings).where(eq(tables.taxFilings.companyId, company.id))
  const applies130 = company.kind === 'autonomo' && company.taxRegime !== 'modulos'
  const out = []
  for (const d of upcoming) {
    const m = d.period.match(/^([1-4])T (\d{4})$/)
    let estimates: Record<string, unknown> | null = null
    if (m) {
      const q = Number(m[1]) as Quarter
      const y = Number(m[2])
      const { from, to } = quarterRange(y, q)
      const [m303, m130, w] = await Promise.all([estimate303(company.id, y, q), applies130 ? estimate130(company.id, y, q) : Promise.resolve(null), withholdings(company.id, from, to)])
      estimates = { '303': m303, ...(m130 ? { '130': m130 } : {}), '111': w.m111, '115': w.m115 }
    }
    out.push({
      modelos: d.models,
      concepto: d.title,
      periodo: d.period,
      plazo_desde: d.start,
      plazo_hasta: d.end,
      estimaciones: estimates,
      presentado: filings.filter(f => d.models.includes(f.model) && d.period.includes(String(f.year))).map(f => ({ modelo: f.model, estado: f.status, resultado: f.result })),
    })
  }
  return { hoy: toISODate(now), plazos: out, url_impuestos: '/impuestos' }
}

async function buscar(company: Company, texto: string) {
  const term = `%${texto.trim().slice(0, 80)}%`
  const db = useDb()
  const c = tables.contacts
  const s = tables.salesDocuments
  const e = tables.expenses
  const [contacts, docs, exps] = await Promise.all([
    db.select({ id: c.id, name: c.name, nif: c.nif, email: c.email, isClient: c.isClient, isSupplier: c.isSupplier }).from(c)
      .where(and(eq(c.companyId, company.id), isNull(c.archivedAt), or(like(c.name, term), like(c.tradeName, term), like(c.nif, term), like(c.email, term)))).limit(8),
    db.select({ id: s.id, kind: s.kind, number: s.number, status: s.status, total: s.total, date: s.issueDate, client: sql<string>`COALESCE(${c.name}, JSON_UNQUOTE(JSON_EXTRACT(${s.customer}, '$.name')))` })
      .from(s).leftJoin(c, eq(c.id, s.contactId))
      .where(and(eq(s.companyId, company.id), or(like(s.number, term), like(c.name, term)))).orderBy(desc(s.issueDate)).limit(10),
    db.select({ id: e.id, number: e.number, description: e.description, total: e.total, date: e.issueDate, supplier: c.name }).from(e).leftJoin(c, eq(c.id, e.supplierId))
      .where(and(eq(e.companyId, company.id), or(like(e.number, term), like(e.description, term), like(c.name, term)))).orderBy(desc(e.issueDate)).limit(10),
  ])
  return {
    contactos: contacts.map(x => ({ ...x, url: x.isClient ? `/clientes/${x.id}` : `/proveedores/${x.id}` })),
    documentos: docs.map(x => ({ ...x, url: x.kind === 'quote' || x.kind === 'proforma' ? `/presupuestos/${x.id}` : `/facturas/${x.id}` })),
    gastos: exps.map(x => ({ ...x, url: `/gastos?ver=${x.id}` })),
  }
}

async function detalleFactura(company: Company, numero: string) {
  const db = useDb()
  const n = numero.trim()
  const [doc] = await db.select({ id: tables.salesDocuments.id }).from(tables.salesDocuments)
    .where(and(eq(tables.salesDocuments.companyId, company.id), eq(tables.salesDocuments.number, n))).limit(1)
  if (doc) {
    const d = await loadSalesDocument(company.id, doc.id)
    return {
      tipo: d.kind, numero: d.number, estado: d.status, fecha: d.issueDate, vence: d.dueDate, cliente: d.customer?.name ?? d.contact?.name ?? null,
      lineas: d.lines.map(l => ({ concepto: l.description, cantidad: l.quantity, precio: l.unitPrice, descuento: l.discountPct, iva: l.vatRate, base: l.base })),
      base: d.taxBase, iva: d.vatTotal, recargo: d.surchargeTotal, irpf: d.irpfTotal, total: d.total, cobrado: d.paidTotal,
      cobros: d.payments.map(p => ({ fecha: p.date, importe: p.amount, forma: p.method })),
      importada: d.imported,
      url: `/facturas/${d.id}`,
    }
  }
  const [exp] = await db.select().from(tables.expenses).where(and(eq(tables.expenses.companyId, company.id), eq(tables.expenses.number, n))).limit(1)
  if (exp) {
    const [lines, [cat]] = await Promise.all([
      db.select().from(tables.expenseTaxLines).where(eq(tables.expenseTaxLines.expenseId, exp.id)),
      exp.categoryId ? db.select({ name: tables.categories.name }).from(tables.categories).where(eq(tables.categories.id, exp.categoryId)) : Promise.resolve([]),
    ])
    return {
      tipo: 'gasto', clase: EXPENSE_KIND_ES[exp.kind] ?? exp.kind, id: exp.id, numero: exp.number, proveedor: exp.supplier?.name ?? null, fecha: exp.issueDate, vence: exp.dueDate,
      concepto: exp.description, categoria: cat?.name ?? null, base: exp.taxBase, iva: exp.vatTotal, recargo: exp.surchargeTotal, retencion_pct: exp.irpfRate, irpf: exp.irpfTotal, total: exp.total,
      desglose: lines.map(l => ({ base: l.base, iva: l.vatRate, cuota: l.vatAmount, recargo: l.surchargeAmount || undefined })),
      deducible: exp.deductiblePct, iva_deducible: exp.vatDeductiblePct, pagado: exp.paidTotal, estado: exp.status, notas: exp.notes, url: `/gastos?ver=${exp.id}`,
    }
  }
  return { error: `No hay ninguna factura con el número ${n}` }
}

interface DraftLine { concepto: string, cantidad: number, precio: number | null, iva: number | null }

const STOP_WORDS = new Set(['del', 'las', 'los', 'para', 'por', 'con', 'una', 'uno', 'mes', 'mensual', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'servicio', 'servicios'])

/** Borrador de factura o presupuesto pedido en el chat: cliente existente, precios del catálogo si no se dan */
async function crearBorrador(company: Company, actor: Actor, a: { tipo: string, cliente: string, lineas: DraftLine[], fecha: string | null, notas: string | null }) {
  if (actor.role === 'advisor') return { error: 'Tu rol (gestor) solo permite consultar: no puedes crear documentos' }
  const db = useDb()
  const q = a.cliente.trim()
  if (!q) return { error: 'Falta el cliente' }
  if (!a.lineas.length) return { error: 'Faltan los conceptos' }
  const contacts = await db.select().from(tables.contacts).where(and(eq(tables.contacts.companyId, company.id), isNull(tables.contacts.archivedAt)))
  const nif = normalizeNif(q)
  const target = comparableName(q)
  let matches = contacts.filter(c => c.nif && normalizeNif(c.nif) === nif)
  if (!matches.length) matches = contacts.filter(c => comparableName(c.name) === target || (c.tradeName && comparableName(c.tradeName) === target))
  if (!matches.length) matches = contacts.filter(c => comparableName(c.name).includes(target) || (c.tradeName && comparableName(c.tradeName).includes(target)))
  if (!matches.length) return { error: `No hay ningún cliente que coincida con "${q}". Puede crearlo en Clientes (/clientes?nuevo=1) o decirte otro nombre.` }
  if (matches.length > 1) return { error: 'Hay varios clientes que coinciden: pregunta cuál', candidatos: matches.slice(0, 6).map(c => ({ nombre: c.name, nif: c.nif })) }
  const client = matches[0]!
  const catalog = await db.select().from(tables.items).where(and(eq(tables.items.companyId, company.id), isNull(tables.items.archivedAt)))
  // Producto del catálogo por palabras significativas ("mantenimiento web de noviembre" → "Mantenimiento web y hosting")
  const words = (s: string) => comparableName(s).split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w))
  const bestItem = (concept: string) => {
    const a = new Set(words(concept))
    let best: { item: typeof catalog[number], score: number } | null = null
    for (const item of catalog) {
      const b = words(item.name)
      if (!a.size || !b.length) continue
      const shared = b.filter(w => a.has(w)).length
      const score = shared / Math.min(a.size, b.length)
      if (shared >= 1 && score >= 0.6 && (!best || score > best.score)) best = { item, score }
    }
    return best?.item
  }
  const lines = a.lineas.slice(0, 50).map((l) => {
    const name = comparableName(l.concepto)
    const item = catalog.find(i => comparableName(i.name) === name) ?? bestItem(l.concepto)
    return {
      itemId: item?.id ?? null,
      description: l.concepto.trim().slice(0, 2000) || item?.name || 'Concepto',
      quantity: l.cantidad || 1,
      unitPrice: l.precio ?? item?.unitPrice ?? 0,
      discountPct: 0,
      vatRate: l.iva ?? item?.vatRate ?? company.defaultVatRate ?? 21,
      surchargeRate: client.equivalenceSurcharge ? SURCHARGE_BY_VAT[l.iva ?? item?.vatRate ?? 21] ?? 0 : 0,
      irpfApplies: true,
    }
  })
  const issueDate = a.fecha && /^\d{4}-\d{2}-\d{2}$/.test(a.fecha) ? a.fecha : toISODate(new Date())
  const terms = client.paymentTermsDays ?? company.paymentTermsDays
  const due = new Date(`${issueDate}T12:00:00`)
  due.setDate(due.getDate() + terms)
  const kind = a.tipo === 'presupuesto' ? 'quote' as const : 'invoice' as const
  // Retención: la del cliente o, si es empresa o profesional, la habitual de la empresa
  const irpfRate = kind === 'invoice' ? (client.irpfRate ?? (client.kind === 'company' && company.kind === 'autonomo' ? company.defaultIrpfRate : 0)) : 0
  const id = await saveSalesDraft(company.id, actor.id, {
    kind,
    contactId: client.id,
    issueDate,
    dueDate: toISODate(due),
    irpfRate,
    paymentMethod: 'transfer',
    notes: a.notas,
    lines,
  } as SalesInput)
  // Los presupuestos no tienen borrador: nacen pendientes, con su número
  if (kind === 'quote') await issueSalesDocument(company.id, id)
  const totals = computeTotals(lines, irpfRate)
  const missingPrice = lines.some(l => !l.unitPrice)
  return {
    creado: true,
    tipo: a.tipo,
    cliente: client.name,
    base: totals.taxBase,
    iva: totals.vatTotal,
    retencion: totals.irpfTotal,
    total: totals.total,
    lineas: lines.map(l => ({ concepto: l.description, cantidad: l.quantity, precio: l.unitPrice, iva: l.vatRate })),
    aviso: missingPrice ? 'Alguna línea quedó sin precio: que lo complete al revisar' : null,
    url: kind === 'quote' ? `/presupuestos/${id}/editar` : `/facturas/${id}/editar`,
  }
}

// ─── Listados y operaciones ──────────────────────────────────────────────────

const LIST_LIMIT = 40

/** Registros que cumplen un filtro: cuántos son, cuánto suman y los primeros con su id */
async function listar(company: Company, entidad: string, rawFilter: unknown) {
  const f = cleanFilter(rawFilter)
  const more = (n: number) => Math.max(0, n - LIST_LIMIT)
  // Nada con ese estado: cuántos hay con otro, para no dar por perdido lo que solo está en pausa, pagado…
  const otherState = async (found: number, run: (g: typeof f) => Promise<number>) => (!found && f.estado ? { con_otro_estado: await run({ ...f, estado: null }) } : {})
  if (entidad === 'facturas' || entidad === 'presupuestos') {
    const family = entidad === 'presupuestos' ? 'quote' : 'invoice'
    const { rows, matched } = await salesTargets(company, f, family, 2001)
    const all = rows.slice(0, 2000)
    return {
      encontrados: rows.length > 2000 ? 'más de 2000' : rows.length,
      ...await otherState(rows.length, async g => (await salesTargets(company, g, family, 500)).rows.length),
      importe_total: round2(all.reduce((s, r) => s + r.total, 0)),
      ...(entidad === 'facturas' ? { pendiente_de_cobro: round2(all.filter(r => isOpenStatus(r.status)).reduce((s, r) => s + r.total - r.paidTotal, 0)) } : {}),
      ...(f.nombres ? { clientes_coincidentes: matched } : {}),
      documentos: rows.slice(0, LIST_LIMIT).map(r => ({
        id: r.id, numero: r.number ?? 'borrador', cliente: r.client, fecha: r.issueDate, vence: r.dueDate, base: r.taxBase, total: r.total, cobrado: r.paidTotal,
        retencion: r.irpfRate, estado: r.status, url: r.kind === 'quote' || r.kind === 'proforma' ? `/presupuestos/${r.id}` : `/facturas/${r.id}`,
      })),
      mas: more(all.length),
    }
  }
  if (entidad === 'gastos') {
    const { rows, matched } = await expenseTargets(company, f, 2001)
    const all = rows.slice(0, 2000)
    return {
      encontrados: rows.length > 2000 ? 'más de 2000' : rows.length,
      ...await otherState(rows.length, async g => (await expenseTargets(company, g, 500)).rows.length),
      importe_total: round2(all.reduce((s, r) => s + r.total, 0)),
      ...(f.nombres ? { proveedores_coincidentes: matched } : {}),
      gastos: rows.slice(0, LIST_LIMIT).map(r => ({
        id: r.id, fecha: r.issueDate, tipo: EXPENSE_KIND_ES[r.kind] ?? r.kind, proveedor: r.supplier, concepto: r.description, numero: r.number, categoria: r.category,
        base: r.taxBase, iva: r.vatTotal, retencion_pct: r.irpfRate || undefined, retencion: r.irpfTotal || undefined, total: r.total, deducible: r.deductiblePct,
        estado: r.status, vence: r.dueDate ?? undefined, aprobacion: r.approval !== 'approved' ? r.approval : undefined, por_revisar: r.reviewed ? undefined : true,
        url: `/gastos?ver=${r.id}`,
      })),
      mas: more(all.length),
    }
  }
  if (entidad === 'recurrentes') {
    const rows = await recurringTargets(company, f, null)
    return {
      encontrados: rows.length,
      ...await otherState(rows.length, async g => (await recurringTargets(company, g, null)).length),
      recurrentes: rows.slice(0, LIST_LIMIT).map(r => ({
        id: r.id, nombre: r.name, tipo: r.kind === 'invoice' ? 'factura' : EXPENSE_KIND_ES[r.template.expenseKind ?? 'invoice'], contacto: r.contact,
        frecuencia: r.frequency, cada: r.interval, proxima: r.nextDate, fin: r.endDate, estado: recurringStatus(r),
        base: r.template.base ?? null, total: r.template.total ?? null, automatico: r.autoIssue,
      })),
      mas: more(rows.length),
      url: '/recurrentes',
    }
  }
  if (entidad === 'movimientos') {
    const rows = await bankTargets(company, f)
    return {
      encontrados: rows.length,
      cargos: round2(rows.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0)),
      abonos: round2(rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0)),
      movimientos: rows.slice(0, LIST_LIMIT).map(r => ({
        id: r.id, fecha: r.date, importe: r.amount, concepto: r.description, ordenante: r.counterparty,
        estado: r.status === 'pending' ? 'por revisar' : r.status === 'matched' ? 'conciliado' : 'ignorado', motivo: r.ignoreReason,
      })),
      mas: more(rows.length),
      url: '/banco',
    }
  }
  if (entidad === 'contactos') {
    const rows = await contactTargets(company, f)
    return {
      encontrados: rows.length,
      contactos: rows.slice(0, LIST_LIMIT).map(c => ({
        id: c.id, nombre: c.name, nif: c.nif, cliente: c.isClient, proveedor: c.isSupplier, email: c.email, retencion: c.irpfRate,
        dias_pago: c.paymentTermsDays, url: c.isClient ? `/clientes/${c.id}` : `/proveedores/${c.id}`,
      })),
      mas: more(rows.length),
    }
  }
  if (entidad === 'productos') {
    const rows = await itemTargets(company, f)
    return {
      encontrados: rows.length,
      productos: rows.slice(0, LIST_LIMIT).map(i => ({ id: i.id, nombre: i.name, tipo: i.kind === 'service' ? 'servicio' : 'producto', precio: i.unitPrice, iva: i.vatRate, unidad: i.unit })),
      mas: more(rows.length),
      url: '/productos',
    }
  }
  if (entidad === 'categorias') {
    const db = useDb()
    const [cats, itemCats] = await Promise.all([
      db.select().from(tables.categories).where(eq(tables.categories.companyId, company.id)),
      db.select().from(tables.itemCategories).where(eq(tables.itemCategories.companyId, company.id)),
    ])
    return {
      gasto: cats.filter(c => c.kind === 'expense').map(c => ({ nombre: c.name, cuenta: c.accountCode, deducible: c.deductiblePct })),
      ingreso: cats.filter(c => c.kind === 'income').map(c => ({ nombre: c.name, cuenta: c.accountCode })),
      catalogo: itemCats.map(c => c.name),
    }
  }
  return { error: 'Entidad desconocida' }
}

/** Lo que ve el modelo de una propuesta: la tarjeta con todos los registros ya la ve el usuario */
function proposalForModel(v: ActionView) {
  return {
    propuesta: v.id,
    estado: 'pendiente de confirmar: NO está hecho',
    titulo: v.title,
    cambio: v.preview.change,
    alcance: v.preview.scope ?? null,
    registros: v.preview.count,
    importe_total: v.preview.total,
    avisos: v.preview.warnings,
    se_puede_deshacer: v.preview.undoable,
    muestra: v.preview.rows.slice(0, 6).map(r => [r.label, r.sub, r.before && r.after ? `${r.before} → ${r.after}` : null].filter(Boolean).join(' · ')),
    nota: 'El usuario ve una tarjeta con todos los registros y los botones Confirmar y Cancelar. Resume en una o dos frases qué va a pasar, menciona los avisos importantes y pide que confirme (con el botón o respondiendo «sí»). No repitas la lista.',
  }
}

interface ToolCtx {
  conversationId: number | null
  emit: (e: ChatEvent) => void
}

async function runTool(company: Company, actor: Actor, name: string, args: Record<string, unknown>, ctx: ToolCtx) {
  if (WRITE_TOOLS.has(name) && actor.role === 'advisor') return { error: 'Tu rol (gestor) solo permite consultar: no puedes cambiar datos' }
  const op = { company, actor }
  // Propuesta pendiente: la tarjeta aparece en el chat y el modelo solo recibe el resumen
  const propose = async (plan: Promise<OpPlan>) => {
    const ready = await plan
    for (const old of await supersedePending(op, ctx.conversationId)) ctx.emit({ type: 'action', action: old })
    const v = await proposeAction(op, ctx.conversationId, ready)
    ctx.emit({ type: 'action', action: v })
    return proposalForModel(v)
  }
  // Altas: se hacen al momento y quedan en una tarjeta con «Deshacer»
  const create = async (plan: Promise<OpPlan>) => {
    const pending = await proposeAction(op, ctx.conversationId, await plan)
    const v = await confirmAction(op, pending.id)
    ctx.emit({ type: 'action', action: v })
    return v.status === 'done'
      ? { hecho: true, titulo: v.title, url: v.result?.url ?? null, nota: 'Ya está hecho; el usuario puede deshacerlo desde la tarjeta.' }
      : { error: v.error ?? 'No se pudo crear' }
  }
  try {
    switch (name) {
      case 'listar': return await listar(company, String(args.entidad ?? ''), args.filtro)
      case 'operar_facturas': return await propose(planSales(op, args.documentos === 'presupuestos' ? 'quote' : 'invoice', String(args.accion), args.filtro, args.cambios as SalesChangesIn))
      case 'enviar_email': return await propose(planSalesEmail(op, args.documentos === 'presupuestos' ? 'quote' : 'invoice', args.filtro, args as unknown as SalesEmailIn))
      case 'operar_gastos': return await propose(planExpenses(op, String(args.accion), args.filtro, args.cambios as ExpenseChangesIn))
      case 'operar_banco': return await propose(planBank(op, String(args.accion), args.filtro, args.opciones as BankOptionsIn))
      case 'operar_contactos': return await propose(planContacts(op, String(args.accion), args.filtro, args.cambios as ContactChangesIn))
      case 'operar_productos': return await propose(planItems(op, String(args.accion), args.filtro, args.cambios as ItemChangesIn))
      case 'operar_recurrentes': return await propose(planRecurrings(op, String(args.accion), (args.de as string | null) ?? null, args.filtro, args.cambios as RecurringChangesIn))
      case 'crear_contacto': return await create(planNewContact(op, args as unknown as NewContactIn))
      case 'crear_producto': return await create(planNewItem(op, args as unknown as NewItemIn))
      case 'crear_gasto': return await create(planNewExpense(op, args as unknown as NewExpenseIn))
    }
  }
  catch (err) {
    if (err instanceof OpError) return { error: err.message, ...err.data }
    throw err
  }
  switch (name) {
    case 'crear_borrador': return crearBorrador(company, actor, args as unknown as Parameters<typeof crearBorrador>[2])
    case 'resumen_periodo': return resumenPeriodo(company, { anio: Number(args.anio) || new Date().getFullYear(), trimestre: (args.trimestre as number | null) ?? null, mes: (args.mes as number | null) ?? null })
    case 'cobros_pendientes': return cobrosPendientes(company)
    case 'pagos_pendientes': return pagosPendientes(company)
    case 'banco': return bancoResumen(company)
    case 'calendario_fiscal': return calendarioFiscal(company)
    case 'evolucion_mensual': return monthlySeries(company.id, Math.min(Math.max(Number(args.meses) || 12, 1), 36))
    case 'buscar': return buscar(company, String(args.texto ?? ''))
    case 'detalle_factura': return detalleFactura(company, String(args.numero ?? ''))
    default: return { error: 'Herramienta desconocida' }
  }
}

// ─── Instrucciones ───────────────────────────────────────────────────────────

const REGIMES: Record<string, string> = { directa_simplificada: 'estimación directa simplificada', directa_normal: 'estimación directa normal', modulos: 'módulos', sociedades: 'Impuesto sobre Sociedades' }
const VAT: Record<string, string> = { general: 'régimen general', recargo_equivalencia: 'recargo de equivalencia', criterio_caja: 'criterio de caja', exento: 'exento' }

export function assistantSystemPrompt(company: Company, userName: string) {
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  // Lo que cambia por empresa, usuario o día va al final: el principio, igual para todos, se lee de la caché de OpenAI
  return `Eres el asistente financiero y fiscal de NUMIQ, la app de gestión de la empresa que se describe al final (Contexto).

Cómo respondes:
- En español de España, claro, cercano y directo. Primero la respuesta; después, si ayuda, el detalle.
- Para cualquier dato de la empresa usa SIEMPRE las herramientas. Nunca inventes ni estimes cifras que puedas consultar. Si un dato no existe, dilo.
- Importes con formato español (1.234,56 €). Los importes de las herramientas son bases imponibles salvo que se diga otra cosa.
- Enlaza facturas, clientes y gastos con los enlaces que devuelven las herramientas, en Markdown: [F2026-0012](/facturas/12).
- Usa listas o tablas Markdown cortas cuando aclaren. Sin títulos grandes. Máximo unas 250 palabras salvo que pidan más detalle.
- Eres experto en fiscalidad española de autónomos y pymes (IVA, IRPF, modelos 303, 130, 111, 115, 349, 390, 190, 180, 347, Renta y Sociedades, gastos deducibles, plazos, VeriFactu). Da consejos prácticos y concretos para esta empresa. En decisiones con riesgo fiscal, recomienda confirmarlo con su asesor en una sola frase.
- Las cifras de impuestos de NUMIQ son estimaciones a partir de lo registrado: dilo si es relevante.
- Puedes preparar BORRADORES de facturas y presupuestos con la herramienta crear_borrador cuando te lo pidan: confirma cliente y conceptos si no están claros, resume lo creado con su total y enlázalo para que lo revise (la factura la emite él; el presupuesto queda pendiente con su número). Nunca digas que está enviado.
- Puedes enviar facturas y presupuestos por email con su PDF (enviar_email): al cliente, al email de la empresa, al propio usuario («envíamela», «mándamela para verla»), al gestor o a cualquier dirección que te den, y recordatorios de pago. Si piden ver un borrador en PDF, envíaselo a «yo» sin emitirlo. Al cliente solo van documentos emitidos: si es un borrador, ofrece emitirlo antes. No escribas tú el texto del correo salvo que lo pidan: se usa el habitual de la empresa. Como cualquier cambio, queda pendiente de que el usuario confirme; nunca digas que se ha enviado hasta que el historial lo marque como ejecutado.

Cambios en los datos (tienes control completo, siempre con la confirmación del usuario):
- Con operar_facturas, operar_gastos, operar_banco, operar_contactos, operar_productos y operar_recurrentes puedes cambiar CUALQUIER dato de la empresa, en uno o en cientos de registros a la vez: importes (base, total, cuota de IVA, desglose por tipos, líneas, precios, cantidades, descuentos), IVA, retención, fechas, vencimientos, números, conceptos, descripciones, notas, cliente o proveedor, categoría, deducibilidad, forma de pago, estados (cobrada, pagada, enviada, aceptada, borrador…), aprobaciones, recurrentes… y también eliminar. Antes de decir que algo no se puede, repasa los parámetros de esas herramientas: casi todo se puede. Si de verdad no hay forma, dilo y explica dónde se cambia en la app; nunca respondas solo con lo que no puedes hacer.
- Importes: «base», «base imponible» o «bruto» → cambios.base; «total», «con IVA», «lo que pagué», «neto» o «líquido» → cambios.total. En nóminas la base es el bruto y el total el neto (bruto − retención). Si dicen solo «importe» y en esos registros base y total son distintos (llevan IVA o retención) y no se deduce del contexto, pregunta cuál en una frase; si coinciden, da igual. Gastos con varios tipos de IVA: cambios.desglose. Facturas: cambios.base o cambios.total ajustan los precios; cambios.lineas añade, cambia o quita conceptos.
- «Todas las nóminas» → filtro.tipo "nomina" (y fechas si las dan). Si cambias gastos que genera un recurrente (nóminas, cuotas, alquileres…), ofrece cambiar también el recurrente para los próximos periodos (operar_recurrentes), y al revés: cambiar un recurrente no toca lo ya generado.
- Para borrar un dato (el email, la fecha final, las notas…) usa cambios.vaciar.
- «Factura» puede ser emitida a un cliente (operar_facturas) o recibida de un proveedor (operar_gastos): si el número o el nombre son de un proveedor, es un gasto. Si una herramienta devuelve una sugerencia de usar otra, hazlo directamente sin preguntar.
- Esas herramientas NO ejecutan nada: preparan una propuesta con los registros exactos, que el usuario ve en una tarjeta y confirma con un botón o respondiendo «sí». Después de proponer, explica en una o dos frases qué va a pasar (cuántos registros, avisos importantes) y pide confirmación. Nunca digas que algo está hecho si el historial no lo marca como ejecutado.
- Filtra con precisión. Clientes, proveedores o comercios van en filtro.nombres (varios a la vez: «las de Paloma y Andrés» → ["Paloma", "Andrés"]); usa también fechas, estado, tipo, números o ids. todos: true solo si el usuario quiere de verdad todos los registros.
- Si una herramienta dice que no encuentra algo o que hay varios candidatos, pregunta al usuario en vez de adivinar. Si no está claro qué registros o qué valor quiere, pregunta antes de proponer. Si dudas del alcance, usa listar primero.
- Equivalencias habituales: «el IRPF» o «la retención» sin porcentaje = ${company.defaultIrpfRate} %. «Cambia el cliente de las facturas de A por B» → operar_facturas modificar, filtro.nombres [A], cambios.cliente B. En el banco: «gasto personal», «no es de la empresa», «traspaso», «pago de impuestos» → operar_banco ignorar con ese motivo (p. ej. "Gasto personal"); «asigna o clasifica los cargos de X como/en <categoría>» → operar_banco crear_gasto con esa categoría. «Gastos de X» se refiere a gastos ya anotados (operar_gastos); «movimientos, cargos o conceptos del banco» a operar_banco.
- Una propuesta por cada operación distinta; si piden varias cosas, prepara varias.
- Eliminar es definitivo: dilo al proponerlo. Cambiar clientes o importes de facturas ya emitidas tiene implicaciones legales: menciona el aviso que devuelva la herramienta.
- crear_contacto, crear_producto y crear_gasto se ejecutan al momento (el usuario puede deshacerlo desde la tarjeta): úsalos solo cuando lo pidan y con los datos necesarios.
- Las anotaciones entre corchetes [Operación #N …] del historial las añade NUMIQ con el estado real de cada propuesta: tenlas en cuenta y no las escribas tú.

Contexto: la empresa es ${company.tradeName || company.legalName} (${company.kind === 'autonomo' ? 'autónomo' : 'sociedad'}, NIF ${company.nif}, ${REGIMES[company.taxRegime] ?? company.taxRegime}, IVA en ${VAT[company.vatRegime] ?? company.vatRegime}${company.activityDescription ? `, actividad: ${company.activityDescription}` : ''}${company.activityStartDate ? `, alta el ${company.activityStartDate}` : ''}, retención habitual en sus facturas ${company.defaultIrpfRate} %). Hablas con ${userName}. Hoy es ${today}.`
}

// ─── Conversación con streaming ──────────────────────────────────────────────

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export type ChatEvent =
  | { type: 'delta', text: string }
  | { type: 'tool', name: string, label: string }
  | { type: 'action', action: ActionView }

interface StreamResult {
  text: string
  output: Array<Record<string, unknown>>
  calls: Array<{ name: string, arguments: string, call_id: string }>
}

function chatModel() {
  return String(useRuntimeConfig().openaiChatModel || 'gpt-5.5')
}

/** Última petición completa de cada caché (empresa): caracteres por token reales y lo que ya está en la caché de OpenAI */
const lastExact = new Map<string, { at: number, chars: number, input: number }>()

async function streamOnce(input: unknown[], tools: unknown[], onDelta: (t: string) => void, signal: AbortSignal, cacheKey: string): Promise<StreamResult> {
  const apiKey = (await currentAiKey())?.key
  if (!apiKey) throw new AiError(MISSING_AI_KEY, 503)
  const model = chatModel()
  const t0 = Date.now()
  const reasoning = /^(gpt-5|gpt-6|o\d)/.test(model)
  // Sin el razonamiento cifrado que se devuelve: es largo y no se parece a sus tokens
  const sentChars = JSON.stringify(input.filter(i => (i as { type?: string }).type !== 'reasoning')).length + JSON.stringify(tools).length
  // Cortada a medias (cerró el chat, cambió de app): OpenAI cobra lo ya procesado y no manda el uso
  let recorded = false
  let received = 0
  const cut = (err: unknown) => {
    if ((err as Error).name === 'AbortError' && !recorded) {
      recorded = true
      const last = lastExact.get(cacheKey)
      const tokens = Math.round(sentChars / (last ? last.chars / last.input : 4.8))
      // Lo enviado hace poco con la misma clave de caché se lee de la caché (en bloques de 128 tokens)
      const cached = last && Date.now() - last.at < 10 * 60_000 ? Math.floor(Math.min(last.input, tokens) / 128) * 128 : 0
      recordCutAiUsage({ task: 'asistente', model, input: tokens, cached, output: Math.round(received / 3.6), ms: Date.now() - t0 })
    }
    return err
  }
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      input,
      tools,
      stream: true,
      store: false,
      max_output_tokens: 6000,
      // Herramientas e instrucciones iguales en cada ronda y pregunta: se leen de la caché (10 % del precio)
      prompt_cache_key: cacheKey,
      ...(reasoning ? { reasoning: { effort: 'low' }, include: ['reasoning.encrypted_content'] } : {}),
    }),
    signal,
  }).catch((err) => {
    throw cut(err)
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null) as { error?: { message?: string, code?: string } } | null
    if (res.status === 401) throw new AiError('La clave de OpenAI no es válida o ha caducado: revísala en Ajustes → Inteligencia artificial', 503)
    if (res.status === 429) throw new AiError(body?.error?.code === 'insufficient_quota' ? 'La cuenta de OpenAI no tiene saldo' : 'La IA está saturada: inténtalo en unos segundos', 429)
    throw new AiError(body?.error?.message ?? 'El servicio de IA no responde', 502)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let output: Array<Record<string, unknown>> = []
  for (;;) {
    const { done, value } = await reader.read().catch((err) => {
      throw cut(err)
    })
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
      if (!data || data === '[DONE]') continue
      let ev: { type?: string, delta?: string, response?: { model?: string, service_tier?: string, usage?: OpenAiUsage, output?: Array<Record<string, unknown>>, error?: { message?: string } }, error?: { message?: string } }
      try {
        ev = JSON.parse(data)
      }
      catch {
        continue
      }
      // Texto, argumentos de herramientas y resumen del razonamiento: lo que ya se ha generado
      if (ev.delta) received += ev.delta.length
      if (ev.type === 'response.output_text.delta' && ev.delta) {
        text += ev.delta
        onDelta(ev.delta)
      }
      else if (ev.type === 'response.completed' || ev.type === 'response.incomplete') {
        output = ev.response?.output ?? []
        recorded = true
        if (ev.response?.usage?.input_tokens) lastExact.set(cacheKey, { at: Date.now(), chars: sentChars, input: ev.response.usage.input_tokens })
        recordAiUsage({ task: 'asistente', model: ev.response?.model || model, usage: ev.response?.usage, tier: ev.response?.service_tier, ms: Date.now() - t0, ok: ev.type === 'response.completed' })
      }
      else if (ev.type === 'response.failed' || ev.type === 'error') {
        recorded = true
        recordAiUsage({ task: 'asistente', model: ev.response?.model || model, usage: ev.response?.usage, tier: ev.response?.service_tier, ms: Date.now() - t0, ok: false })
        throw new AiError(ev.response?.error?.message ?? ev.error?.message ?? 'La IA no pudo responder', 502)
      }
    }
  }
  const calls = output.filter(o => o.type === 'function_call') as unknown as StreamResult['calls']
  return { text, output, calls }
}

export interface Actor {
  id: number
  name: string
  role: string
}

/**
 * Responde a la última pregunta. Las llamadas a herramientas se resuelven en el servidor y se
 * vuelve a preguntar al modelo hasta que contesta con texto (máximo 8 rondas). Las propuestas de
 * cambio quedan unidas a la conversación.
 */
export async function answer(company: Company, actor: Actor, history: ChatTurn[], emit: (e: ChatEvent) => void, signal: AbortSignal, conversationId: number | null = null) {
  const userName = actor.name
  const tools = assistantToolDefs()
  let input: unknown[] = [
    { role: 'developer', content: assistantSystemPrompt(company, userName) },
    ...history.map(h => ({ role: h.role, content: h.content })),
  ]
  const used: string[] = []
  let text = ''
  for (let round = 0; round < 8; round++) {
    const r = await streamOnce(input, tools, (t) => {
      text += t
      emit({ type: 'delta', text: t })
    }, signal, `numiq-asistente-${company.id}`)
    if (!r.calls.length) return { text, tools: used, model: chatModel() }
    const outputs = []
    for (const call of r.calls) {
      if (!used.includes(call.name)) used.push(call.name)
      emit({ type: 'tool', name: call.name, label: TOOL_LABELS[call.name] ?? 'Consultando tus datos' })
      let result: unknown
      try {
        result = await runTool(company, actor, call.name, JSON.parse(call.arguments || '{}'), { conversationId, emit })
      }
      catch (err) {
        console.error('[assistant] herramienta', call.name, err)
        result = { error: 'No se pudo consultar ese dato' }
      }
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) })
    }
    input = [...input, ...r.output, ...outputs]
  }
  return { text: text || 'No he podido completar la respuesta. ¿Puedes reformular la pregunta?', tools: used, model: chatModel() }
}

/** Título corto de una conversación a partir de la primera pregunta */
export function conversationTitle(q: string) {
  const t = q.replace(/\s+/g, ' ').trim()
  return t.length > 70 ? `${t.slice(0, 67).replace(/\s\S*$/, '')}…` : t
}
