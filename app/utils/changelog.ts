/**
 * Novedades de NUMIQ que ve el usuario en Ajustes → Novedades. Solo lo que le importa: funciones nuevas,
 * mejoras que nota y errores corregidos, en su idioma (nada de despliegues ni refactorizaciones).
 * Lo más reciente primero; `at` en hora de Madrid. Al añadir algo importante a la app, se añade aquí.
 */
export type ChangeKind = 'new' | 'improved' | 'fixed'

export interface ChangeEntry {
  /** Fecha y hora (AAAA-MM-DDTHH:mm), para ordenar y agrupar por día */
  at: string
  kind: ChangeKind
  /** Parte de la app: «Facturas», «Banco»… */
  area: string
  icon: string
  title: string
  body: string
  /** Dónde probarlo */
  to?: string
}

export const CHANGELOG: readonly ChangeEntry[] = Object.freeze([
  // ─── 26 de octubre de 2026 ───
  { at: '2026-10-26T00:10', kind: 'improved', area: 'Facturas', icon: 'ph:file-pdf', title: 'Ver PDF, a un toque en cada factura', body: 'Arriba de cada factura y presupuesto tienes Editar, Ver PDF, Descargar y Enviar. Los borradores también se ven y se descargan en PDF, con la marca BORRADOR. En el móvil caben todos en una fila.', to: '/facturas' },
  // ─── 25 de octubre de 2026 ───
  { at: '2026-10-25T23:15', kind: 'new', area: 'Asistente IA', icon: 'ph:envelope-simple', title: 'El asistente envía facturas por email', body: 'Pídele «envíamela para verla en PDF», «mándala al email de la empresa» o «envíasela al cliente» y prepara el correo con el PDF: ves a quién va, el asunto y el texto, y sale cuando pulsas Enviar. Los borradores solo te llegan a ti, con la marca BORRADOR. También envía presupuestos, recordatorios de pago y copias a tu gestor.', to: '/asistente' },
  { at: '2026-10-25T23:10', kind: 'improved', area: 'Listas', icon: 'ph:dots-three-circle', title: 'Los tres puntos, con todas las opciones', body: 'El botón «⋯» de cada fila abre el mismo menú completo que el clic derecho, ahora también en gastos. En facturas, «Cobrada hoy» y «Registrar cobro…» pasan a ese menú y la fila queda más limpia.', to: '/gastos' },
  { at: '2026-10-25T22:40', kind: 'improved', area: 'Navegación', icon: 'ph:arrow-u-up-left', title: '«Volver» siempre te lleva a donde estabas', body: 'Si abres un contacto, una factura o un gasto desde el calendario, Inicio, el banco u otra ficha, «Volver» te devuelve allí (y el calendario reabre el evento que tenías abierto). Desde una lista, vuelves a la lista tal como la dejaste. El botón dice a dónde vuelve.' },
  { at: '2026-10-25T21:44', kind: 'improved', area: 'Diseño de factura', icon: 'ph:text-aa', title: 'Facturas que caben en una página y letra compacta', body: 'Márgenes y espacios más ajustados: una factura con descripción larga, firma y datos de pago ya no salta a una segunda hoja. Y un tamaño de letra nuevo, Normal o Compacto, para meter aún más.', to: '/ajustes?s=diseno' },
  { at: '2026-10-25T21:34', kind: 'new', area: 'Firmas', icon: 'ph:seal-check', title: 'Facturas y presupuestos firmados', body: 'Activa la firma por defecto para facturas, presupuestos o ambos, elige cuál y el texto de encima («Firma y sello», «Conforme»…). En cada documento la pones, la quitas o la cambias. Sale en el PDF, en el email y en la página del cliente.', to: '/ajustes?s=firmas' },
  { at: '2026-10-25T21:33', kind: 'improved', area: 'Firmas', icon: 'ph:image', title: 'Fotos de firma recortadas y a buen tamaño', body: 'Al subir una foto de tu firma se quita el papel, se eliminan las motas, se recorta justo a la firma y se ajusta el tamaño. Se ve grande y nítida en todas las vistas previas.', to: '/ajustes?s=firmas' },
  { at: '2026-10-25T21:32', kind: 'improved', area: 'Firmas', icon: 'ph:trash', title: 'Elimina firmas desde el visor', body: 'Con clic derecho sobre una firma de la bandeja o con su botón de papelera, siempre con confirmación. Lo que ya habías colocado en el documento se queda.' },
  { at: '2026-10-25T21:15', kind: 'new', area: 'Documentos', icon: 'ph:signature', title: 'Firma cualquier documento desde el visor', body: 'Dibuja tu firma, escríbela con letra manuscrita o súbela desde una foto. Colócala con un toque o arrastrándola, muévela a otra página, cámbiala de tamaño, ponla en todas las páginas y añade la fecha. La copia firmada se guarda junto al original.', to: '/ajustes?s=firmas' },
  { at: '2026-10-25T20:46', kind: 'fixed', area: 'Visor', icon: 'ph:cursor-click', title: 'El visor se cierra al pulsar fuera del documento', body: 'Un clic o un toque fuera de la página lo cierra, como un visor de fotos. Arrastrar, seleccionar texto o usar la barra de desplazamiento no lo cierra por error.' },
  { at: '2026-10-25T20:40', kind: 'improved', area: 'Envíos', icon: 'ph:paperclip', title: 'Envía también el documento original', body: 'Si la factura viene de una importación o un escaneo, al enviarla por email puedes adjuntar el original. Nunca se ofrece si lleva datos de otros clientes (un Excel con todo el libro, por ejemplo).' },
  { at: '2026-10-25T18:02', kind: 'new', area: 'Listas', icon: 'ph:tag', title: 'Cambia el estado desde la lista', body: 'Pulsa la etiqueta de estado de una factura, un presupuesto o un gasto y cámbialo sin abrirlo.' },
  { at: '2026-10-25T16:01', kind: 'new', area: 'Toda la app', icon: 'ph:mouse-right-click', title: 'Menú con clic derecho y pulsación larga', body: 'Sobre una factura, un gasto, un contacto, un día del calendario o un documento verás sus acciones al momento: abrir, cambiar estado, copiar datos, eliminar… En el móvil, deja el dedo pulsado.' },
  { at: '2026-10-25T15:45', kind: 'improved', area: 'Banco', icon: 'ph:rows', title: 'Elige cuántas filas ver por página', body: 'En los movimientos del banco y en los envíos a la gestoría.', to: '/banco' },
  { at: '2026-10-25T15:15', kind: 'new', area: 'Calendario', icon: 'ph:calendar-dots', title: 'Calendario con todo lo que tiene fecha', body: 'Facturas, vencimientos, cobros y pagos, plazos de Hacienda y festivos, más tus propios eventos y tareas con aviso. Suscríbete desde Google Calendar, Apple u Outlook.', to: '/calendario' },
  { at: '2026-10-25T13:54', kind: 'new', area: 'Documentos', icon: 'ph:file-magnifying-glass', title: 'Visor de documentos integrado', body: 'PDF, imágenes, Word y hojas de cálculo se abren dentro de NUMIQ, con zoom, páginas, descarga, impresión y compartir. Sin pestañas nuevas.' },
  { at: '2026-10-25T13:16', kind: 'improved', area: 'Banco', icon: 'ph:link', title: 'Conciliación más lista con tus facturas', body: 'Cada cobro se casa con su factura por el número del concepto (aunque venga abreviado), el cliente y el importe. Un ingreso que paga varias facturas las cobra todas.', to: '/banco' },
  { at: '2026-10-25T13:38', kind: 'fixed', area: 'Móvil', icon: 'ph:device-mobile', title: 'Gastos y movimientos sin cortes en el móvil', body: 'El formulario de gasto con proveedores de nombre largo y el detalle de los movimientos del banco ya se ven completos.' },
  { at: '2026-10-25T11:02', kind: 'new', area: 'Móvil', icon: 'ph:list', title: 'Menú lateral y tema de un toque en el móvil', body: 'Un menú lateral con todo y el cambio entre claro, oscuro o automático a un toque. La barra de estado sigue el tema.' },
  { at: '2026-10-25T02:26', kind: 'improved', area: 'Navegación', icon: 'ph:chart-line-up', title: 'Impuestos e informes, juntos en «Informes»', body: 'Los modelos, el calendario fiscal y los informes, en un único sitio.' },
  { at: '2026-10-25T01:37', kind: 'new', area: 'Presupuestos', icon: 'ph:link-simple', title: 'Vincula presupuestos y facturas', body: 'La IA sugiere qué factura corresponde a cada presupuesto (y al revés). Desde cada uno saltas al otro con un clic.', to: '/presupuestos' },
  { at: '2026-10-25T01:12', kind: 'new', area: 'App', icon: 'ph:app-window', title: 'Instala NUMIQ como una app', body: 'En el ordenador o el móvil, con su propio icono y ventana. En Windows y Mac se abre a un tamaño cómodo.' },
  { at: '2026-10-25T00:43', kind: 'new', area: 'Inteligencia artificial', icon: 'ph:coins', title: 'Lo que cuesta la IA, al céntimo', body: 'En Ajustes → Inteligencia artificial: hoy, la semana y el mes con previsión, por tarea y por documento, con el precio exacto de cada llamada.', to: '/ajustes?s=ia' },
  { at: '2026-10-25T00:06', kind: 'fixed', area: 'Listas', icon: 'ph:columns', title: 'Listas que se adaptan a la pantalla', body: 'En tabletas y portátiles pequeños las tablas ya no se cortan: pasan a filas cómodas cuando no caben.' },

  // ─── 24 de octubre de 2026 ───
  { at: '2026-10-24T23:50', kind: 'improved', area: 'Presupuestos', icon: 'ph:file-text', title: 'Presupuestos más sencillos', body: 'Cuatro estados claros: pendiente, enviado, aceptado o rechazado. Se envían por email con su PDF y se convierten en factura con un clic.', to: '/presupuestos' },
  { at: '2026-10-24T23:12', kind: 'improved', area: 'Móvil', icon: 'ph:hand-pointing', title: 'Tacto de app en el móvil', body: 'Sin zoom accidental al tocar ni al escribir, y una barra inferior más ajustada en la app instalada.' },
  { at: '2026-10-24T23:01', kind: 'new', area: 'Listas', icon: 'ph:calendar-check', title: 'El año en curso, y un periodo que se recuerda', body: 'Las listas abren en el año actual con un selector de año, trimestre o mes que se mantiene al cambiar de pantalla.' },
  { at: '2026-10-24T21:36', kind: 'new', area: 'Formularios', icon: 'ph:x-circle', title: 'Borra cualquier campo con un toque', body: 'Una X aparece al escribir en cualquier campo de texto.' },
  { at: '2026-10-24T20:57', kind: 'improved', area: 'Listas', icon: 'ph:arrow-u-up-left', title: 'Al volver, la lista sigue como la dejaste', body: 'La búsqueda, los filtros y la página se conservan al abrir algo y volver atrás.' },
  { at: '2026-10-24T20:04', kind: 'new', area: 'Facturas', icon: 'ph:article', title: 'Facturas solo con descripción y columnas inteligentes', body: 'Factura un trabajo describiéndolo, sin líneas de conceptos. La tabla enseña cantidad, precio o IVA solo cuando aportan algo.', to: '/facturas' },
  { at: '2026-10-24T19:53', kind: 'new', area: 'Listas', icon: 'ph:checks', title: 'Cambia el estado de muchos a la vez', body: 'Selecciona varias facturas, presupuestos o gastos y márcalos como cobrados, enviados o pagados de una vez.' },
  { at: '2026-10-24T19:22', kind: 'improved', area: 'Contactos', icon: 'ph:users-three', title: 'Clientes y proveedores sin fichas repetidas', body: 'Se reconoce al mismo cliente aunque cambie el nombre («Endesa» y «Endesa Energía, S.A.U.») y las fichas duplicadas se fusionan.', to: '/clientes' },
  { at: '2026-10-24T19:17', kind: 'fixed', area: 'Importación', icon: 'ph:download-simple', title: 'Importaciones más fiables', body: 'Las facturas emitidas ya no entran como gastos, el concepto no se repite como descripción y desaparecen los avisos engañosos sobre el cliente.' },
  { at: '2026-10-24T18:55', kind: 'improved', area: 'Gastos', icon: 'ph:magnifying-glass', title: '«Por revisar» solo cuando hace falta', body: 'Un gasto leído con IA se marca para revisar solo si hay algo que hacer, y te dice qué.', to: '/gastos' },
  { at: '2026-10-24T18:38', kind: 'new', area: 'Contactos', icon: 'ph:map-pin', title: 'Mapa de la dirección en la ficha', body: 'Cada cliente y proveedor muestra un pequeño mapa con su dirección.' },
  { at: '2026-10-24T18:09', kind: 'new', area: 'Contactos', icon: 'ph:upload-simple', title: 'Importa clientes y proveedores de cualquier archivo', body: 'Excel, CSV, PDF, Word, una foto o vCard: la IA los lee, los revisas y los guardas, con opción de deshacer.', to: '/clientes' },
  { at: '2026-10-24T17:57', kind: 'new', area: 'Toda la app', icon: 'ph:copy', title: 'Nada se registra dos veces', body: 'Antes de importar, escanear o crear algo se compara con lo que ya tienes. Lo seguro se bloquea y lo probable se pregunta.' },
  { at: '2026-10-24T17:21', kind: 'new', area: 'App', icon: 'ph:arrows-clockwise', title: 'Aviso cuando hay una versión nueva', body: 'La versión aparece junto al logo y, tras cada actualización, un aviso para recargar.' },
  { at: '2026-10-24T17:17', kind: 'improved', area: 'Navegación', icon: 'ph:compass', title: '«Ingresos» y «Documentos»', body: 'Ventas pasa a llamarse Ingresos, y Documentos reúne el archivo y la importación.' },
  { at: '2026-10-24T16:53', kind: 'new', area: 'Equipo', icon: 'ph:user-check', title: 'Aprobación de gastos del equipo', body: 'En las sociedades, los gastos que registran los empleados quedan pendientes hasta que un administrador los aprueba.', to: '/ajustes?s=equipo' },
  { at: '2026-10-24T16:45', kind: 'new', area: 'Notificaciones', icon: 'ph:bell-ringing', title: 'Notificaciones de lo que pasa sin ti', body: 'Un cliente que abre tu factura, un plazo de Hacienda que se acerca, una importación que termina o una factura recurrente emitida te llegan como notificación, también al móvil.', to: '/ajustes?s=cuenta' },
  { at: '2026-10-24T16:40', kind: 'new', area: 'Cuenta', icon: 'ph:fingerprint', title: 'Entra con huella o Face ID', body: 'Sin contraseña: tu huella, tu cara o el PIN del dispositivo. Funciona también en iPhone.', to: '/ajustes?s=cuenta' },
  { at: '2026-10-24T16:25', kind: 'new', area: 'Asistente IA', icon: 'ph:robot', title: 'El asistente trabaja por ti', body: 'Pídele que reasigne clientes, aplique retenciones, clasifique movimientos o marque cobros. Cada cambio te lo propone antes y se puede deshacer.', to: '/asistente' },
  { at: '2026-10-24T16:13', kind: 'new', area: 'Atajos', icon: 'ph:keyboard', title: 'Atajos de una tecla', body: 'F nueva factura, P presupuesto, G gasto, E escanear y C cliente, desde cualquier pantalla.' },
  { at: '2026-10-24T16:12', kind: 'improved', area: 'Facturas', icon: 'ph:steps', title: 'Editor de factura en tres pasos en el móvil', body: 'Cliente, conceptos y revisión, uno detrás de otro y cómodos con el teclado abierto.' },
  { at: '2026-10-24T16:09', kind: 'new', area: 'Impuestos', icon: 'ph:flag-checkered', title: 'Cierra el trimestre paso a paso', body: 'Datos al día, presentar y pagar cada modelo y enviarlo a la gestoría, con el pago fraccionado (202) de las sociedades incluido.', to: '/impuestos' },
  { at: '2026-10-24T16:04', kind: 'new', area: 'Inicio', icon: 'ph:wallet', title: '«Tu dinero libre»', body: 'Lo que de verdad es tuyo: el saldo del banco menos los impuestos y pagos que tienes pendientes.', to: '/' },
  { at: '2026-10-24T16:01', kind: 'new', area: 'Cobros', icon: 'ph:hand-coins', title: 'Cobra antes', body: 'Enlace de pago propio, Bizum y envío por WhatsApp, y un aviso cuando el cliente abre tu factura.', to: '/ajustes?s=cobros' },
  { at: '2026-10-24T15:55', kind: 'new', area: 'Inicio', icon: 'ph:sun-horizon', title: '«Hoy» en Inicio', body: 'Lo que toca hoy de un vistazo, con recordatorios de un toque para las facturas vencidas.', to: '/' },
  { at: '2026-10-24T15:30', kind: 'improved', area: 'Facturas', icon: 'ph:arrow-counter-clockwise', title: 'Repite lo de la última vez', body: 'Un editor de factura más tranquilo que te propone los conceptos y precios que usaste con ese cliente.' },
  { at: '2026-10-24T15:21', kind: 'improved', area: 'Navegación', icon: 'ph:squares-four', title: 'Navegación más simple', body: 'Áreas con pestañas y, en el móvil, una barra inferior con lo esencial.' },
  { at: '2026-10-24T14:16', kind: 'fixed', area: 'Importes', icon: 'ph:currency-eur', title: 'Importes con impuestos en todas partes', body: 'Las listas, fichas e informes muestran el total con impuestos y, cuando aparece la base, va indicada.' },
  { at: '2026-10-24T14:57', kind: 'improved', area: 'Móvil', icon: 'ph:rows', title: 'Filas que nunca cortan nombres', body: 'En el móvil cada factura, gasto o contacto se lee entero, con el importe y el estado debajo.' },
])

export const CHANGE_KINDS: Record<ChangeKind, { label: string, plural: string, icon: string }> = {
  new: { label: 'Nuevo', plural: 'Novedades', icon: 'ph:sparkle-fill' },
  improved: { label: 'Mejora', plural: 'Mejoras', icon: 'ph:trend-up-bold' },
  fixed: { label: 'Corregido', plural: 'Correcciones', icon: 'ph:wrench-fill' },
}
