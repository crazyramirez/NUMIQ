<p align="center">
  <img src=".github/assets/readme-header.webp" alt="NUMIQ — Facturación, gastos e impuestos con IA" width="100%">
</p>

# NUMIQ

Gestión completa para autónomos y pequeñas empresas españolas: facturas y presupuestos, gastos, banco, impuestos, calendario con los plazos de Hacienda, archivo para la gestoría e IA que lee documentos y responde con las cifras reales de la empresa.

App web instalable (PWA), responsive y en español. Varias empresas por cuenta y equipo con roles.

También como **app de escritorio para Windows, macOS y Linux**, sin servidor: el instalador trae su propia base de datos y todo funciona en el ordenador. Ver [NUMIQ de escritorio](#numiq-de-escritorio-windows-macos-y-linux).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/inicio-dark.webp">
  <img src=".github/assets/screenshots/inicio-light.webp" alt="Panel de inicio de NUMIQ: tareas de hoy, dinero libre, facturado, gastos y pendientes del trimestre" width="100%">
</picture>

---

## Qué hace

| Área | Funciones |
|---|---|
| **Ingresos** | Facturas, rectificativas, proformas y presupuestos con numeración por series. Importación de facturas emitidas en otro programa conservando su número. Diseño de factura a medida (logo, colores, tipografías, textos por defecto) y PDF generado en el servidor. Envío por correo con PDF y adjuntos. Cobros parciales y recordatorios de pago automáticos. |
| **Presupuestos** | Cuatro estados: pendiente, enviado, aceptado y rechazado. Se cambian a mano desde la lista (también varios a la vez), la ficha o el editor; no hay borradores ni caducidad, y un presupuesto con la validez pasada no se marca como vencido. Se envían por email con su PDF y se convierten en factura con un clic. |
| **Página para el cliente** | Cada factura tiene un enlace privado (`/p/:token`) para verla, descargarla y pagarla: IBAN con datos para copiar, enlace de pago propio (Stripe, PayPal, SumUp…) o Bizum. Aviso cuando el cliente la abre. Se comparte por email, copiando el enlace o por WhatsApp. |
| **Catálogo y contactos** | Productos y servicios con imagen, precio, IVA y unidad, que se sugieren al escribir el concepto de una línea. Clientes y proveedores con validación de NIF/CIF/NIE y NIF-IVA, retención IRPF, recargo de equivalencia, categoría de gasto por defecto y mapa de la dirección. Relleno con IA a partir de una firma, una foto o un PDF, e importación masiva (Excel, CSV, PDF, Word, foto o vCard) con revisión antes de guardar y opción de deshacer. Sin fichas repetidas: el mismo NIF no se da de alta dos veces, un nombre parecido («Endesa» y «Endesa Energía, S.A.U.») reutiliza la ficha existente y los duplicados que ya haya se fusionan. |
| **Gastos** | Registro manual o leído con IA desde foto, PDF, Word o Excel, con un escáner siempre a mano. Importación por lotes (PDF, imágenes, Word, Excel, CSV, XML o un ZIP con todo). Nada se registra dos veces: antes de guardar se compara con lo que ya hay por número (aunque cambien ceros o separadores), proveedor, importe, fecha y concepto. Lo seguro se bloquea y lo probable se pregunta; un ticket escaneado se adjunta al gasto que ya se creó desde el banco. Gastos deducibles según la normativa. Aprobación opcional de los gastos que registra el equipo. |
| **Banco** | Importación de extractos (Norma 43, CSV, Excel y la exportación a Excel de Money Manager, cada una de sus cuentas en la suya; si el formato es desconocido, la IA identifica las columnas). Cada extracto importado queda también en Archivo → Banco, en el trimestre en que acaba, con la cuenta y el periodo. Un extracto solapado o del mismo periodo en otro formato no repite movimientos, y sin IBAN se reconoce la cuenta por los movimientos que ya tiene. Conciliación con facturas y gastos, en bloque para las coincidencias seguras: cada cobro se casa con su factura emitida por el número en el concepto (también abreviado), el cliente (IBAN, NIF, historial o nombre) y el importe; un ingreso que paga varias facturas del mismo cliente las cobra todas, y la IA resuelve los dudosos. Si el gasto o el cobro ya estaba anotado se enlaza en vez de crear otro. Saldo por cuenta. |
| **Impuestos** | Borradores de los modelos 303, 130, 111 y 115 (trimestrales), 390, 190, 180 y 347 (anuales) y, para sociedades, 200 y 202, con sus casillas listas para copiar en la Sede de la AEAT. Calendario fiscal y «Cerrar trimestre» paso a paso: datos al día, presentar y pagar cada modelo y enviarlo a la gestoría. Cada modelo se marca como presentado con su justificante, que lee la IA. La presentación se hace en la Sede (Cl@ve, DNIe o certificado del propio usuario): NUMIQ no presenta en nombre del usuario. |
| **Gestoría** | Archivo documental por trimestre (banco, contratos, nóminas…). «Envío al gestor» de un mes, trimestre, año o rango libre: ZIP con emitidas, recibidas con sus originales, archivo y resumen en Excel y PDF, enviado con un enlace seguro que caduca a los 30 días. Rol *gestor* en modo consulta: ve todo y descarga la documentación, pero la app no le ofrece (y el servidor no le permite) crear, cambiar ni borrar facturas, gastos ni los datos de la empresa. En Ajustes → Equipo se elige qué puede subir: nóminas, impuestos (registrar los modelos presentados con su justificante), extractos del banco y el resto del archivo; solo cambia o borra lo que subió él. |
| **Documentos y firmas** | Visor propio para PDF, imágenes, Word y hojas de cálculo, sin abrir pestañas. Firma de documentos desde el visor: la firma se coloca con un toque o arrastrándola, se mueve a cualquier página, se escala por las esquinas, se pone en todas las páginas y lleva la fecha si se quiere. La copia firmada se guarda junto al original (adjunta a la misma factura o gasto, o en la misma carpeta del archivo) o se descarga. Firmas guardadas en Ajustes → Firmas: dibujadas con el ratón, el dedo o un lápiz, escritas con letra manuscrita o subidas desde una foto (se quita el fondo, se recorta a la firma y se ajusta el tamaño). Las facturas y los presupuestos pueden salir firmados: se activa por defecto para cada tipo, con la firma y el texto elegidos, y cada documento la pone, la quita o la cambia; la firma aparece en el PDF, en la hoja, en la página del cliente y en los envíos por email. |
| **Recurrentes** | Facturas periódicas (cuotas, igualas, mantenimientos) que se generan solas en su fecha, como borrador o emitidas y enviadas. Gastos fijos (alquiler, suscripciones, cuota de autónomos) que se anotan solos sin duplicar el que ya exista en ese periodo. |
| **Calendario** | Mes, agenda y año con todo lo que tiene fecha: facturas emitidas, vencimientos de cobro y pago, cobros y pagos hechos, presupuestos, recurrentes previstos, plazos de Hacienda (franja de presentación y último día, marcados como presentados según los modelos) y festivos nacionales. Eventos y tareas propios con hora, varios días, repetición, color, contacto vinculado y aviso push; se arrastran a otro día. Suscripción privada (webcal) para Google Calendar, Apple Calendar, Outlook y Microsoft 365 con avisos de los plazos, y calendarios externos (dirección iCal de Google, iCloud u Outlook) vistos dentro de NUMIQ. |
| **Inicio e informes** | Inicio con las tareas de «Hoy», el dinero libre (saldo menos impuestos y pagos pendientes) y recomendaciones del Asesor NUMIQ. Informes por periodo con comparativa, cuenta de resultados, IVA por tipo, retenciones, mejores clientes y proveedores y antigüedad de los cobros; exportación a PDF, Excel y libros registro en CSV. Las listas abren en el año en curso, con un selector de año, trimestre o mes que se recuerda entre pantallas. |
| **Asistente IA** | Chat que consulta los datos de la empresa (ventas, gastos, impuestos, banco…) y opera sobre ellos: reasignar clientes, aplicar retenciones, clasificar o ignorar movimientos del banco, cambiar categorías, marcar cobros y pagos, emitir, eliminar o dar de alta registros, y enviar facturas, presupuestos y recordatorios por email con su PDF (al cliente, a la empresa, al propio usuario o al gestor; los borradores solo como copia interna). Cada cambio llega como una propuesta con los registros exactos que el usuario confirma (botón o «sí»), queda auditado y, si se puede, se deshace con un clic. |
| **Cuenta y equipo** | Registro con verificación de email, recuperación de contraseña y acceso con passkey (huella, cara o PIN del dispositivo). Bloqueo de la app con esa misma passkey en cada dispositivo que la tiene (siempre al volver, cada 24 horas o solo al entrar), comprobado por el servidor: con la sesión bloqueada la API no entrega datos. Invitaciones con roles (`owner`, `admin`, `member`, `advisor`). Copia de seguridad desde Ajustes: archivo de la empresa en formatos abiertos (Excel, JSON y PDF) o, solo para quien administra el servidor, clonación de la instalación completa. Eliminar la cuenta con todos sus datos (Ajustes → Tu cuenta). Modo claro y oscuro. |
| **Coste de la IA** | Cada llamada a OpenAI guarda sus tokens reales (entrada, caché, salida y razonamiento) y su coste con la tarifa oficial del modelo, en euros con el cambio del BCE del día. En Ajustes → Inteligencia artificial: hoy, últimos 7 días, mes con previsión y total; evolución por días, semanas o meses; desglose por categoría, tarea, modelo y usuario; coste medio por documento y por respuesta, y las últimas llamadas. El titular de la app ve también el total de todas las empresas. |
| **App y avisos** | PWA instalable con accesos directos (escanear, nueva factura, añadir gasto, asistente) y aviso de nueva versión. Notificaciones push por dispositivo: el cliente abre una factura, se emite una recurrente, la IA termina de leer documentos, se acerca un plazo de impuestos o hay gastos del equipo por aprobar. |

**Desactivado por ahora:** VeriFactu y el certificado digital de la empresa. El código sigue en el proyecto, pero la app no genera registros VeriFactu ni admite subir certificados.

---

## Capturas

Cuenta de demostración con datos ficticios. Las imágenes siguen el tema claro u oscuro de GitHub.

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/factura-dark.webp">
        <img src=".github/assets/screenshots/factura-light.webp" alt="Factura con su diseño, estado de cobro y adjuntos">
      </picture>
      <p align="center"><b>Factura</b> · diseño propio, cobros parciales y adjuntos</p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/gastos-dark.webp">
        <img src=".github/assets/screenshots/gastos-light.webp" alt="Lista de gastos con categoría, deducibilidad y resumen del trimestre">
      </picture>
      <p align="center"><b>Gastos</b> · categoría, deducibilidad y resumen del periodo</p>
    </td>
  </tr>
  <tr>
    <td width="100%" colspan="2">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/calendario-dark.webp">
        <img src=".github/assets/screenshots/calendario-light.webp" alt="Calendario del mes con vencimientos de cobro y pago, plazos de Hacienda, recurrentes, festivos y eventos propios">
      </picture>
      <p align="center"><b>Calendario</b> · cobros, pagos, plazos de Hacienda y tus citas; se añade a Google, Apple u Outlook con un toque</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/banco-dark.webp">
        <img src=".github/assets/screenshots/banco-light.webp" alt="Banco con saldo por cuenta y movimientos conciliados con facturas y gastos">
      </picture>
      <p align="center"><b>Banco</b> · saldos por cuenta y conciliación</p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/impuestos-dark.webp">
        <img src=".github/assets/screenshots/impuestos-light.webp" alt="Impuestos: modelos 111, 115, 130 y 303 por trimestre y calendario fiscal">
      </picture>
      <p align="center"><b>Impuestos</b> · modelos por trimestre y calendario fiscal</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/informes-dark.webp">
        <img src=".github/assets/screenshots/informes-light.webp" alt="Informe anual con evolución mensual e indicadores">
      </picture>
      <p align="center"><b>Informes</b> · evolución mensual e indicadores</p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/asistente-dark.webp">
        <img src=".github/assets/screenshots/asistente-light.webp" alt="Asistente IA respondiendo con las cifras del trimestre">
      </picture>
      <p align="center"><b>Asistente IA</b> · responde con las cifras reales</p>
    </td>
  </tr>
</table>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/movil-inicio-dark.webp">
    <img src=".github/assets/screenshots/movil-inicio-light.webp" alt="Inicio en el móvil" width="23%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/movil-factura-dark.webp">
    <img src=".github/assets/screenshots/movil-factura-light.webp" alt="Factura en el móvil" width="23%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/movil-calendario-dark.webp">
    <img src=".github/assets/screenshots/movil-calendario-light.webp" alt="Calendario en el móvil" width="23%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/movil-banco-dark.webp">
    <img src=".github/assets/screenshots/movil-banco-light.webp" alt="Banco en el móvil" width="23%">
  </picture>
</p>
<p align="center"><b>En el móvil</b> · inicio, factura, calendario y banco</p>

---

## Tecnología

- **Nuxt 4** en modo SPA (`ssr: false`): el servidor Nitro solo expone la API (`/api/*`).
- **Vue 3 + TypeScript estricto**, con un sistema de diseño propio en CSS puro (`app/assets/css`) e iconos Phosphor (`@nuxt/icon`).
- **MariaDB / MySQL** con **Drizzle ORM** (`mysql2`) y migraciones SQL versionadas.
- **Zod 4** para validar las entradas de la API y **nuxt-auth-utils** para sesiones en cookie cifrada.
- **pdfmake** para los PDF, **SheetJS** para los Excel y **fflate** para los ZIP.
- **nodemailer** (SMTP) para el correo y **web-push** para las notificaciones.
- **OpenAI** para leer documentos y para el asistente, con la clave de cada usuario guardada cifrada.
- **Passkeys** con **@simplewebauthn**, a través de nuxt-auth-utils.
- **pdf.js**, **pdf-lib** y **docx-preview** para las vistas previas de documentos, y **exifr** para sus fechas.
- **MapLibre GL** con mapas de OpenFreeMap y direcciones de CartoCiudad (IGN).
- **Electron** y **electron-builder** para la app de escritorio, con **MySQL 8.4** embebido (`desktop/`).

Requisitos: **Node.js ≥ 22.22**. En local no hace falta instalar MySQL (ver más abajo).

---

## Puesta en marcha en local

```bash
npm install
cp .env.example .env      # y rellena al menos NUXT_SESSION_PASSWORD
npm run dev               # http://localhost:3210
```

`npm run dev` hace dos cosas:

1. Arranca un **MariaDB portable** del propio proyecto en `127.0.0.1:3308` (usuario `root` sin contraseña). La primera vez descarga los binarios a `.data/mariadb` y guarda los datos en `.data/mysql`, fuera de git. Está pensado para Windows. En otros sistemas, apunta `NUXT_DATABASE_URL` a tu MySQL.
2. Lanza Nuxt en el puerto **3210**, escuchando en `0.0.0.0`, así que también se puede abrir desde el móvil en `http://<ip-del-pc>:3210`.

Al arrancar se aplican las migraciones pendientes (`autoMigrate`).

Para tener datos con los que probar, crea una cuenta en `/registro` y, en la bienvenida, activa **«Rellenar con datos de ejemplo»**. Genera un año de actividad ficticia de un estudio de diseño: facturas emitidas en orden cronológico, gastos, clientes, banco e impuestos.

Para generar la clave de sesión:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Variables de entorno

Plantilla completa y comentada en [`.env.example`](.env.example). Las claves reales van solo en `.env`, que no se sube a git.

| Variable | Para qué |
|---|---|
| `NUXT_SESSION_PASSWORD` | **Obligatoria.** 32 o más caracteres aleatorios para cifrar las sesiones. |
| `NUXT_DATABASE_URL` | Conexión MySQL (`mysql://usuario:clave@host:puerto/base`). |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` `DB_SOCKET` | Alternativa por partes (útil en Plesk). Tienen prioridad sobre la URL y la contraseña no necesita codificarse. |
| `NUXT_UPLOADS_DIR` | Carpeta de archivos subidos (por defecto `./storage/uploads`). |
| `NUXT_SITE_URL` | URL pública para los enlaces de los correos y la imagen al compartir un enlace (`og:image`, se fija al compilar), sin barra final. |
| `NUXT_CERT_SECRET` | Recomendada: 32 o más caracteres para cifrar en la base de datos los certificados y las claves de OpenAI de los usuarios. Si falta se usa la de sesión, y cambiar esta obligaría a volver a pegarlas. |
| `NUXT_OPENAI_MODEL` · `NUXT_OPENAI_PRO_MODEL` · `NUXT_OPENAI_CHAT_MODEL` · `NUXT_OPENAI_CONCURRENCY` | Opcionales: modelo de lectura rápida, modelo de segunda lectura cuando los importes no cuadran, modelo del asistente y documentos leídos en paralelo. |
| `NUXT_OPENAI_PRICES` | Opcional: tarifas en USD por millón de tokens (`{"gpt-5.5":[5,0.5,30]}`: entrada, caché, salida) si OpenAI cambia un precio. El coste de la IA (Ajustes → Inteligencia artificial) se calcula con ellas. |
| `GOOGLE_APP_EMAIL` · `GOOGLE_APP_PASSWORD` | Correo con Gmail o Workspace (contraseña de aplicación) para enviar por SMTP. |
| `NUXT_MAIL_SMTP_HOST` `…_PORT` `NUXT_MAIL_USER` `NUXT_MAIL_PASSWORD` `NUXT_MAIL_FROM` | Otro proveedor de correo en lugar de Gmail. |
| `NUXT_MAIL_ONLY_TO` | **Modo pruebas:** solo salen correos a estas direcciones o `@dominios`; el resto se omite y queda registrado como no enviado. |
| `NUXT_SERVER_ADMINS` | Emails (separados por comas) que administran el servidor: clonar y restaurar la base de datos entera desde Ajustes. El titular de `GOOGLE_APP_EMAIL` ya lo es. Siempre con el email confirmado en NUMIQ. |
| `NUXT_VAPID_PUBLIC_KEY` · `NUXT_VAPID_PRIVATE_KEY` | Opcionales: claves de las notificaciones push. Si faltan, se generan una vez y se guardan junto a la carpeta de subidas. |
| `NUXT_RECURRING_DISABLED` · `NUXT_REMINDERS_DISABLED` · `NUXT_PUSH_DEADLINES_DISABLED` · `NUXT_CALENDAR_REMINDERS_DISABLED` | `true` apaga la tarea programada correspondiente. |

La IA no se configura en el servidor: cada usuario pega su clave de OpenAI en Ajustes → Inteligencia artificial, se comprueba con OpenAI y se guarda cifrada (AES-256-GCM); nunca vuelve al navegador. Los miembros del equipo sin clave propia usan la del titular de la empresa; el gestor usa siempre la de la empresa (la del titular o la del administrador que le invitó) y la suya solo si la empresa no tiene. Sin ninguna clave la app funciona, pero sin las funciones de IA. Sin el correo configurado no sale ningún email: la verificación de cuenta se omite y los envíos quedan registrados como no enviados («Sin configurar»).

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | MariaDB local y Nuxt en el puerto 3210. |
| `npm run build` | Compila a `.output/`, migraciones incluidas. |
| `npm run preview` | Arranca la versión compilada (`node .output/server/index.mjs`). |
| `npm run db:local` / `npm run db:stop` | Arranca en primer plano o detiene el MariaDB local. |
| `npm run db:generate` | Crea una migración a partir de `server/db/schema.ts`. |
| `npm run db:migrate` · `npm run db:studio` | Aplica migraciones a mano o abre Drizzle Studio. |
| `npm run clone:export` / `npm run clone:import <zip>` | Clona una instalación completa (todas las tablas y archivos) a otro servidor. |
| `npm run test:*` | Pruebas de la importación (duplicados, fechas de archivo, lectura y vista previa) y de los contactos (limpieza y coincidencias). `test:imports:integration` compila antes de probar. |

---

## Estructura

```
app/                      Cliente (Vue)
  pages/                  Rutas: facturas, presupuestos, gastos, banco, impuestos, informes, ajustes…
  components/             Pantallas y piezas por área (sales/, bank/, import/, settings/, taxes/…)
  components/ui/          Sistema de diseño: <UiButton>, <UiModal>, <UiInput>… (prefijo Ui)
  components/app/         Estructura de la app: barra lateral, paleta de comandos… (prefijo App)
  composables/            useMe, useToast, useConfirm, usePwa, useTheme…
  assets/css/             tokens.css, base.css, ui.css (utilidades) y paper.css (factura)
server/
  api/                    Endpoints REST, agrupados por recurso
  utils/                  Lógica de negocio (autoimportada en Nitro)
  plugins/                Tareas programadas y comprobación de configuración
  db/schema.ts            Esquema Drizzle
  db/migrations/          Migraciones SQL (0000…)
shared/                   Tipos y utilidades comunes a cliente y servidor (NIF, IVA, recurrencias…)
public/                   Manifest de la PWA, iconos y estáticos
scripts/                  MariaDB local, clonación y pruebas
storage/uploads/          Archivos subidos, por empresa (fuera de git)
desktop/                  App de escritorio (Electron): arranque, MySQL embebido, instaladores y pruebas
```

Las rutas de la API comprueban la sesión y la empresa activa con `requireCompany(event, rolMínimo)`. Todas las consultas filtran por `companyId`.

---

## Base de datos

- El esquema está en `server/db/schema.ts`. Tras cambiarlo:
  ```bash
  npx drizzle-kit generate --name descripcion_corta
  ```
  Eso crea `server/db/migrations/00NN_descripcion_corta.sql`. Revísalo antes de dar el cambio por bueno.
- Las migraciones se aplican solas al arrancar el servidor, en desarrollo y en producción. `npm run build` las copia dentro de `.output`.
- Los ajustes flexibles de cada empresa (gestoría, recordatorios, copia de seguridad…) se guardan como JSON en `companies.settings`.

---

## Tareas programadas

Se ejecutan dentro del propio servidor Nitro (`server/plugins`):

| Tarea | Frecuencia |
|---|---|
| Recurrentes: genera las facturas y gastos que tocan | Cada 15 min. Usa un bloqueo por fila, así que es seguro con varias instancias. |
| Recordatorios de cobro a clientes con facturas vencidas | Cada 20 min, de lunes a viernes de 9 a 19 h (hora de Madrid), si el correo está configurado. |
| Avisos push de plazos de impuestos con modelos sin presentar (5 días antes y el último día) | Cada hora, en horario laboral. |
| Avisos push de los eventos del calendario que lo piden (a la hora elegida; los de todo el día desde las 9:00) | Cada minuto. Desactivable con `NUXT_CALENDAR_REMINDERS_DISABLED=true`. |
| Limpieza de escaneos no guardados y ZIP de gestoría caducados | Cada hora. |
| Presupuestos al día: los borradores que queden se emiten y los caducados pasan a rechazados | Una vez, al arrancar. |

---

## NUMIQ de escritorio (Windows, macOS y Linux)

La misma app, instalada en el ordenador y sin servidor ni hosting. El instalador trae su propio servidor de NUMIQ y su base de datos (MySQL 8.4), que solo escuchan dentro del equipo. Los datos no salen del ordenador salvo lo que tú envías: correos, consultas a la IA con tu clave de OpenAI, mapas y calendarios externos.

### Descargar e instalar

Los instaladores están en [Releases](https://github.com/crazyramirez/NUMIQ/releases). Todos son instalables, no portables.

| Sistema | Archivo | Instalación |
|---|---|---|
| **Windows** 10 y 11 (64 bits) | `NUMIQ-x.y.z-win-x64.exe` | Instalador con acceso directo en el escritorio y en el menú Inicio. Se desinstala desde Configuración → Aplicaciones. |
| **macOS** 15 o posterior, Apple Silicon (M1 a M4) | `NUMIQ-x.y.z-mac-arm64.dmg` | Abre el DMG y arrastra NUMIQ a Aplicaciones. |
| **macOS** 15 o posterior, Intel | `NUMIQ-x.y.z-mac-x64.dmg` | Igual que el anterior. |
| **Ubuntu, Debian, Mint** (64 bits) | `NUMIQ-x.y.z-linux-amd64.deb` | `sudo apt install ./NUMIQ-x.y.z-linux-amd64.deb` |
| **Fedora, openSUSE** (64 bits) | `NUMIQ-x.y.z-linux-x86_64.rpm` | `sudo dnf install ./NUMIQ-x.y.z-linux-x86_64.rpm` |

Necesitas unos 500 MB de disco. Se recomiendan 4 GB de RAM.

**Si el sistema avisa al abrirla.** Mientras los instaladores no lleven firma digital de pago:

- **Windows** muestra «Windows protegió su PC». Pulsa **Más información → Ejecutar de todas formas**.
- **macOS** puede decir que NUMIQ «está dañada» o que «no se puede abrir». Abre Terminal y ejecuta una sola vez:
  ```bash
  xattr -dr com.apple.quarantine /Applications/NUMIQ.app
  ```
  También puedes ir a **Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente**.

### Primer arranque

1. NUMIQ abre directamente **Crear cuenta**. La cuenta es local: el email no se confirma y la contraseña protege la app en este equipo.
2. En la bienvenida das de alta tu empresa. Puedes rellenarla con datos de ejemplo para probar.
3. **IA:** pega tu clave de OpenAI en **Ajustes → Inteligencia artificial**.
4. **Correo:** añade tu cuenta en **Ajustes → Correo**. Sirve Gmail con contraseña de aplicación, Outlook/Microsoft 365 u otro SMTP. La contraseña se guarda cifrada.
5. Si olvidas la contraseña, pulsa **¿Olvidaste tu contraseña?** al entrar y elige otra desde la propia app, sin correo.

### Qué funciona y qué no

| Función | En el escritorio |
|---|---|
| Facturas, presupuestos, gastos, banco, impuestos, informes, calendario, archivo, firmas, importación y PDF | ✅ Igual que en la web |
| IA: lectura de documentos, importación y asistente | ✅ Con internet y tu clave de OpenAI |
| Enviar facturas, presupuestos, recordatorios y documentación al gestor por email | ✅ Con la cuenta de **Ajustes → Correo**. La documentación para el gestor va adjunta en un ZIP de hasta 18 MB; si pesa más, descárgala y compártela tú |
| Recordatorios de cobro automáticos, facturas recurrentes y avisos de plazos | ✅ Mientras NUMIQ está abierta, aunque esté minimizada. Lo que toque con la app cerrada se hace al abrirla |
| Avisos | ✅ Como notificaciones del sistema |
| Calendarios externos (iCal de Google, iCloud u Outlook) vistos en NUMIQ | ✅ |
| Copia de seguridad, clonación completa y restauración | ✅ En **Ajustes → Copia de seguridad** |
| Página online para el cliente (`/p/…`): enlace para compartir, WhatsApp, aviso de «visto por el cliente» y pago desde la página | ❌ No hay dirección pública. La factura va por email con su PDF. «Ver como el cliente» sí funciona, dentro de la app |
| Enlace de descarga para el gestor | ❌ El ZIP va adjunto o se descarga |
| Equipo, invitaciones y rol de gestor | ❌ La app vive en un solo equipo. Para trabajar con otras personas, usa la versión web |
| Suscripción webcal desde Google Calendar, Apple Calendar u Outlook | ❌ |
| Llaves de acceso (huella, Face ID) y bloqueo con llave | ❌ Se entra con la contraseña |
| Avisos push en el móvil, varios dispositivos y sincronización | ❌ |
| Instalar como PWA | ❌ Ya es una app instalada |

### Tus datos

Todo vive en una carpeta de tu usuario. **Archivo → Abrir la carpeta de datos** te lleva a ella.

| Sistema | Carpeta |
|---|---|
| Windows | `%APPDATA%\NUMIQ` |
| macOS | `~/Library/Application Support/NUMIQ` |
| Linux | `~/.config/NUMIQ` |

Dentro:

- `data/mysql`: la base de datos.
- `data/uploads`: logos, escaneos y documentos.
- `data/settings.json`: la cuenta de correo, con la contraseña cifrada.
- `numiq-desktop.json`: las claves que cifran las sesiones, las claves de OpenAI y el correo, y la contraseña de la base de datos. **Guárdalo junto a tus copias**: sin él no se pueden abrir los datos cifrados.
- `logs/`: registros de la app, del servidor y de la base de datos, para soporte.

Comportamiento con actualizaciones y desinstalación:

- **Actualizar:** instala la versión nueva encima y tus datos se conservan. NUMIQ avisa cuando hay una versión nueva; solo consulta la lista de Releases de GitHub, sin enviar ningún dato.
- **Desinstalar** no borra tus datos. Para quitarlo todo, borra también la carpeta.

**Copias y migración entre la web y el escritorio.** En **Ajustes → Copia de seguridad** tienes dos opciones:

- La copia de la empresa, en Excel, JSON y PDF.
- La **clonación completa** (`.zip`), que se restaura en otro ordenador o en un servidor de NUMIQ.

Para pasar de la web al escritorio, clona la instalación en la web (lo hace quien administra el servidor) y restaura el ZIP en el escritorio. Funciona también en sentido contrario. Las cuentas mantienen sus contraseñas. Las claves de OpenAI y el correo hay que volver a ponerlos, porque cada instalación las cifra con sus propias claves.

**Seguridad.** La base de datos y el servidor solo aceptan conexiones del propio equipo (`127.0.0.1`). La base tiene una contraseña aleatoria propia. La ventana solo carga NUMIQ y los enlaces externos se abren en tu navegador. El ejecutable no puede usarse como Node.js (fuses de Electron).

### Compilar la app de escritorio

```bash
cd desktop
npm install
npm run dev          # compila NUMIQ, descarga MySQL para tu sistema y abre la app
npm run smoke        # prueba de humo sin Electron: MySQL + servidor + API completa
npm run dist:win     # instalador de Windows   (en Windows)
npm run dist:mac     # DMG arm64 e Intel        (en un Mac)
npm run dist:linux   # .deb y .rpm             (en Linux, con rpm instalado)
```

El flujo de GitHub Actions **Escritorio** (`.github/workflows/desktop.yml`) hace todo esto en Windows, macOS y Linux:

1. Compila NUMIQ.
2. Pasa la prueba de humo: registro, datos de ejemplo, todas las consultas de la API, modelos de Hacienda, PDF, copia, clonación y restauración.
3. Genera los instaladores.
4. Arranca la app ya empaquetada y comprueba que se cierra en orden.

Se ejecuta con cada cambio en `desktop/` o en la base de datos, o a mano. Para publicar una versión en Releases, sube una etiqueta `vX.Y.Z` o lanza el flujo a mano con **Publicar** marcado.

**Firma de los instaladores (opcional).** Si existen estos secretos en el repositorio, los instaladores salen firmados:

- Windows: `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD`.
- macOS: `MAC_CSC_LINK` y `MAC_CSC_KEY_PASSWORD` (certificado Developer ID). Para notarizar, además `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID`.

**Cómo está hecha:**

```
Electron (desktop/src/main.mjs)
  ├─ MySQL 8.4 en 127.0.0.1, datos en la carpeta del usuario (desktop/src/database.mjs)
  ├─ servidor de NUMIQ (el mismo .output de Nitro) en un utilityProcess → http://localhost:47300
  │    con NUMIQ_DESKTOP=1 y NUXT_PUBLIC_DESKTOP=true
  └─ ventana con la app, puente mínimo en window.numiqDesktop (desktop/src/preload.cjs)
```

Se usa MySQL porque MariaDB no publica binarios para macOS. La app funciona con los dos motores: la prueba de humo lo comprueba, incluida una clonación hecha con MariaDB y restaurada en MySQL.

En el código, el modo escritorio se consulta con `isDesktop()` en el servidor (`server/utils/desktop.ts`) y con `useDesktop()` en el cliente. Cualquier función nueva que dependa de una URL pública, de varios usuarios o de passkeys tiene que tener en cuenta ese modo.

---

## Instalación en servidor (Plesk)

1. **Base de datos.** En el dominio, **Bases de datos → Añadir base de datos**: nombre (p. ej. `numiq`), usuario y contraseña. No hay que importar nada: las tablas se crean solas en el primer arranque.
2. **Git.** **Git → Añadir repositorio**, rama `master`, despliegue automático. En **Acciones de despliegue adicionales**:
   ```bash
   bash scripts/plesk-deploy.sh
   ```
   Instala, compila y solo publica la nueva versión si el build sale bien. Registro en `logs/deploy.log`.
3. **Node.js.** Versión 24, archivo de inicio `.output/server/index.mjs` y raíz del documento `.output/public`. La raíz del documento tiene que ser esa: si fuera la carpeta de la app, el `.env` se podría descargar desde la web.
4. **`.env`** en la carpeta de la app (junto a `package.json`). La app lo lee al arrancar; si hay variables en el panel Node.js, mandan esas.
   ```ini
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=usuario_de_la_base
   DB_PASSWORD=contraseña_de_la_base
   DB_NAME=numiq
   NUXT_SESSION_PASSWORD=32+ caracteres aleatorios
   NUXT_SITE_URL=https://tu-dominio
   ```
   Los `DB_*` son los del paso 1, tal como aparecen en Plesk. Si la contraseña lleva `#` o espacios, ponla entre comillas simples. Correo, IA y el resto, en [Variables de entorno](#variables-de-entorno).

   Para generar `NUXT_SESSION_PASSWORD`, entra por SSH y ejecuta:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copia los 64 caracteres que imprime. Si `node` no está en el `PATH`, usa el de Plesk: `/opt/plesk/node/24/bin/node`. Cambiarla más adelante cierra la sesión de todos los usuarios.
5. **Arranque.** Activa HTTPS (la cookie de sesión es `Secure`), reinicia la aplicación y crea la primera cuenta en `/registro`.

Si la base no conecta, `https://tu-dominio/api/me` responde 503 con la causa (contraseña incorrecta, base inexistente…).

Para mover una instalación con todos sus datos usa `npm run clone:export` en el origen y `npm run clone:import <zip>` en el destino, desde la carpeta de la app: leen el mismo `.env`.

---

## Comprobar tipos

El `tsconfig.json` raíz solo contiene referencias, así que `vue-tsc` sin `-p` no comprueba nada. Hay que comprobar cada proyecto por separado:

```bash
npx vue-tsc --noEmit -p .nuxt/tsconfig.app.json
npx vue-tsc --noEmit -p .nuxt/tsconfig.server.json
npx vue-tsc --noEmit -p .nuxt/tsconfig.shared.json
```

---

## Buenas prácticas del proyecto

- **Secretos:** solo en `.env`. Nunca en `.env.example` ni en el código.
- **Correos en pruebas:** arranca con `NUXT_MAIL_ONLY_TO=<tu correo>` para no escribir nunca a clientes reales. Las direcciones de dominios reservados (`example.com`, `.test`…) se omiten siempre.
- **Autoimportaciones:** las utilidades de `server/utils` y `shared/utils` se autoimportan. Si una función nueva da «is not defined» en desarrollo, reinicia el servidor.
- **Imágenes subidas:** el tipo se comprueba por el contenido, no por la extensión. Productos y contactos admiten PNG o JPG; el logo de la empresa admite también SVG, que se sirve aislado para que no pueda ejecutar nada en el dominio.
