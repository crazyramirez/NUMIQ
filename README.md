<p align="center">
  <img src=".github/assets/readme-header.webp" alt="NUMIQ — Facturación, gastos e impuestos con IA" width="100%">
</p>

# NUMIQ

Gestión completa para autónomos y pequeñas empresas españolas: facturas y presupuestos, gastos, banco, impuestos, archivo para la gestoría e IA que lee documentos y responde con las cifras reales de la empresa.

App web instalable (PWA), responsive y en español. Varias empresas por cuenta y equipo con roles.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/inicio-dark.webp">
  <img src=".github/assets/screenshots/inicio-light.webp" alt="Panel de inicio de NUMIQ: facturado, gastos, beneficio y pendiente de cobro del trimestre, gráfico de los últimos 12 meses y recomendaciones del asesor IA" width="100%">
</picture>

---

## Qué hace

| Área | Funciones |
|---|---|
| **Ventas** | Facturas, presupuestos y rectificativas con numeración por series. Diseño de factura a medida (logo, colores, tipografías, textos por defecto) y PDF generado en el servidor. Envío por correo con PDF y adjuntos. Página pública para el cliente (`/p/:token`): ver, descargar, aceptar o rechazar presupuestos y datos de pago, con aviso de lectura. Cobros parciales y recordatorios de pago automáticos. |
| **Catálogo y contactos** | Productos y servicios con imagen, precio, IVA y unidad, que se sugieren al escribir el concepto de una línea. Clientes y proveedores con validación de NIF/CIF/NIE y NIF-IVA, retención IRPF, recargo de equivalencia y categoría de gasto por defecto. Relleno con IA a partir de una firma, una foto o un PDF. |
| **Gastos** | Registro manual o leído con IA desde foto, PDF, Word o Excel. Importación por lotes (PDF, imágenes, Word, Excel, CSV, XML o un ZIP con todo) con detección de duplicados. Recepción de facturas por correo (IMAP): cada empresa tiene su alias `cuenta+empresa@…`. Gastos deducibles según la normativa. |
| **Banco** | Importación de extractos (Norma 43, CSV, Excel; si el formato es desconocido, la IA identifica las columnas). Conciliación de movimientos con facturas y gastos, y saldo por cuenta. |
| **Impuestos** | Borradores de los modelos 303, 130, 111 y 115 (trimestrales) y 390, 190, 180 y 347 (anuales) con sus casillas, listos para copiar en la Sede de la AEAT. Guía de presentación y lectura con IA del justificante. |
| **Gestoría** | Archivo documental por trimestre (banco, contratos, nóminas…). «Envío al gestor»: ZIP con emitidas, recibidas con sus originales, archivo y resumen en Excel y PDF, enviado con enlace seguro. Rol *asesor* con acceso de solo lectura. |
| **Recurrentes** | Cuotas, igualas, alquileres y suscripciones que se generan solos en su fecha, como borrador o emitidos y enviados. |
| **Informes** | Panel de inicio, informes por periodo, libros registro y exportación a Excel y PDF. |
| **Asistente IA** | Chat que consulta los datos de la empresa con herramientas de solo lectura (ventas, gastos, impuestos, banco…) y puede preparar borradores de factura. |
| **Cuenta y equipo** | Registro con verificación de email, recuperación de contraseña e invitaciones con roles (`owner`, `admin`, `member`, `advisor`). Copia de seguridad completa en ZIP desde Ajustes. Modo claro y oscuro. |

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
    <img src=".github/assets/screenshots/movil-inicio-light.webp" alt="Inicio en el móvil" width="31%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/movil-factura-dark.webp">
    <img src=".github/assets/screenshots/movil-factura-light.webp" alt="Factura en el móvil" width="31%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/screenshots/movil-banco-dark.webp">
    <img src=".github/assets/screenshots/movil-banco-light.webp" alt="Banco en el móvil" width="31%">
  </picture>
</p>
<p align="center"><b>En el móvil</b> · inicio, factura y banco</p>

---

## Tecnología

- **Nuxt 4** en modo SPA (`ssr: false`): el servidor Nitro solo expone la API (`/api/*`).
- **Vue 3 + TypeScript estricto**, con un sistema de diseño propio en CSS puro (`app/assets/css`) e iconos Phosphor (`@nuxt/icon`).
- **MariaDB / MySQL** con **Drizzle ORM** (`mysql2`) y migraciones SQL versionadas.
- **Zod 4** para validar las entradas de la API y **nuxt-auth-utils** para sesiones en cookie cifrada.
- **pdfmake** para los PDF, **SheetJS** para los Excel y **fflate** para los ZIP.
- **nodemailer** (SMTP) para enviar e **imapflow** con **mailparser** para recibir.
- **OpenAI** para leer documentos y para el asistente, y **node-forge** para los certificados .p12/.pfx.

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
| `NUXT_SITE_URL` | URL pública para los enlaces de los correos, sin barra final. |
| `NUXT_OPENAI_API_KEY` | IA: lectura de documentos, importación, relleno de contactos y asistente. |
| `NUXT_OPENAI_MODEL` · `NUXT_OPENAI_PRO_MODEL` · `NUXT_OPENAI_CHAT_MODEL` · `NUXT_OPENAI_CONCURRENCY` | Opcionales: modelo de lectura rápida, modelo de segunda lectura cuando los importes no cuadran, modelo del asistente y documentos leídos en paralelo. |
| `GOOGLE_APP_EMAIL` · `GOOGLE_APP_PASSWORD` | Correo con Gmail o Workspace (contraseña de aplicación): envío por SMTP y recepción por IMAP. |
| `NUXT_MAIL_SMTP_HOST` `…_PORT` `NUXT_MAIL_IMAP_HOST` `NUXT_MAIL_USER` `NUXT_MAIL_PASSWORD` `NUXT_MAIL_FROM` | Otro proveedor de correo en lugar de Gmail. |
| `NUXT_MAIL_INBOX_OWNERS` | Usuarios que pueden buscar facturas en todo el buzón, no solo en su alias. |
| `NUXT_MAIL_ONLY_TO` | **Modo pruebas:** solo salen correos a estas direcciones o `@dominios`; el resto se omite y queda registrado como no enviado. |
| `NUXT_CERT_SECRET` | Clave para cifrar los certificados digitales. Si falta, se usa la de sesión, y cambiar esa obliga a volver a subir el certificado. |
| `NUXT_RECURRING_DISABLED` · `NUXT_REMINDERS_DISABLED` | `true` apaga la tarea programada correspondiente. |

Sin `NUXT_OPENAI_API_KEY` la app funciona, pero sin las funciones de IA. Sin el correo configurado no sale ningún email: la verificación de cuenta se omite y los envíos quedan registrados como no enviados («Sin configurar»).

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
| `npm run test:*` | Pruebas de la importación: duplicados, fechas de archivo, lectura y vista previa. |

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
| Recordatorios de cobro a clientes con facturas vencidas | Cada 20 min, de lunes a viernes de 9 a 19 h (hora de Madrid). |
| Limpieza de escaneos no guardados y ZIP de gestoría caducados | Cada hora. |

---

## Instalación en servidor

Pasos para Plesk (Git + Node.js), que es como se despliega hoy. Al final hay una guía corta para un VPS sin panel.

**Necesitas:** Node.js ≥ 22.22 (en Plesk, Node 24), MariaDB ≥ 10.6 o MySQL ≥ 8.0 (en local se usa MariaDB 11.4), un dominio con HTTPS y acceso SSH para las tareas de mantenimiento.

> **En producción la app no lee `.env`.** `node .output/server/index.mjs` solo ve las variables del proceso: en Plesk se ponen en el panel Node.js (paso 4) y en un VPS con `node --env-file=.env`.

### 1. Base de datos

En Plesk: **Sitios web y dominios → tu dominio → Bases de datos → Añadir base de datos**.

| Campo | Valor |
|---|---|
| Nombre de la base | p. ej. `numiq`. Plesk puede añadir un prefijo (`usuario_numiq`): usa el nombre completo que aparezca en la lista. |
| Servidor | El MariaDB/MySQL local (`localhost`). |
| Usuario | Uno nuevo, solo para NUMIQ, con contraseña larga. Necesita todos los permisos sobre esa base, también `CREATE`, `ALTER`, `INDEX`, `REFERENCES` y `DROP`, porque las migraciones crean y cambian tablas. En Plesk es el rol por defecto de lectura y escritura. |
| Acceso | Solo conexiones locales. |

No importes nada: las tablas se crean solas en el primer arranque (paso 5).

Antes de arrancar, abre la base en **phpMyAdmin → Operaciones** y comprueba que el cotejamiento es `utf8mb4_unicode_ci`. La app intenta ponerlo al arrancar, pero si el usuario no tiene permiso para `ALTER DATABASE` las tablas se crearían con el juego de caracteres del servidor, que puede ser `latin1` y perder emojis y algunos caracteres.

Sin Plesk, como root de MySQL:

```sql
CREATE DATABASE numiq CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'numiq'@'localhost' IDENTIFIED BY 'una-contraseña-larga';
GRANT ALL PRIVILEGES ON numiq.* TO 'numiq'@'localhost';
FLUSH PRIVILEGES;
```

Apunta los datos para el paso 4:

```ini
DB_HOST=localhost
DB_PORT=3306
DB_USER=numiq
DB_PASSWORD=una-contraseña-larga
DB_NAME=numiq
```

- La contraseña va tal cual, sin codificar. En un archivo `.env`, si lleva `#`, espacios o comillas, enciérrala entre comillas simples (`DB_PASSWORD='a#b c'`): sin ellas el `#` corta el valor.
- Si MySQL responde «usuario o contraseña incorrectos» con la contraseña buena, el usuario solo existe como `'numiq'@'localhost'` y la conexión llega por TCP desde `127.0.0.1`. Añade `DB_SOCKET` con el socket Unix del servidor (`/var/lib/mysql/mysql.sock` en AlmaLinux/CentOS, `/run/mysqld/mysqld.sock` en Debian/Ubuntu) o crea también el usuario `'numiq'@'127.0.0.1'`.

### 2. Código y despliegue automático

1. En el dominio, **Git → Añadir repositorio**: la URL de GitHub, rama `master` y despliegue automático en la carpeta de la app (p. ej. `/httpdocs`). Plesk da una clave SSH que hay que añadir en GitHub como *deploy key*, y una URL de webhook que va en **GitHub → Settings → Webhooks** para desplegar en cada push.
2. En **Acciones de despliegue adicionales**, una sola línea:
   ```bash
   bash scripts/plesk-deploy.sh
   ```
   El script usa Node 24 de Plesk (`/opt/plesk/node/24/bin`), ejecuta `npm ci`, compila en `.output-next` y solo sustituye `.output` si el build sale bien, así que un fallo no tira la web. Después reinicia la app (`tmp/restart.txt`). Si llegan dos push seguidos, el segundo espera a que termine el primero. Cada ejecución queda en `logs/deploy.log`.
3. Pulsa **Desplegar ahora** una vez para que exista `.output` antes de configurar Node.js.

### 3. Aplicación Node.js

En el dominio, **Node.js → Habilitar Node.js**:

| Campo | Valor |
|---|---|
| Versión de Node.js | 24, la misma que usa `scripts/plesk-deploy.sh`. |
| Modo de la aplicación | `production` |
| Raíz de la aplicación | La carpeta del repositorio, p. ej. `/httpdocs`. |
| Raíz del documento | `/httpdocs/.output/public`. nginx sirve los estáticos y el resto va a Node. Así `logs/`, `storage/` y el código quedan fuera de la web. |
| Archivo de inicio | `.output/server/index.mjs` |

No hace falta pulsar «NPM install» ni «Ejecutar script»: ya lo hace el script de despliegue.

Activa también:

- **SSL/TLS → Let's Encrypt** y la redirección a HTTPS. La cookie de sesión es `Secure`: por HTTP no se puede iniciar sesión.
- En **Configuración de Apache y nginx → Directivas adicionales de nginx**, `client_max_body_size 300m;`. Las importaciones por lotes admiten ZIP de hasta 300 MB y la restauración de copias sube un ZIP completo.

### 4. Variables de entorno

En **Node.js → Variables de entorno personalizadas**. Al terminar, **Reiniciar aplicación**: los cambios no se aplican hasta reiniciar.

| Variable | Valor en producción |
|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | Los del paso 1. `DB_SOCKET` solo si hace falta. |
| `NUXT_SESSION_PASSWORD` | Nueva, distinta de la de desarrollo (64 caracteres hex con el comando de [Puesta en marcha](#puesta-en-marcha-en-local)). Si la cambias, se cierran todas las sesiones. |
| `NUXT_CERT_SECRET` | Recomendada: otra clave de 32+ caracteres que no cambie nunca. Sin ella, cambiar la de sesión obliga a volver a subir los certificados digitales. |
| `NUXT_SITE_URL` | `https://tu-dominio`, sin barra final. Se usa en los enlaces de los correos. |
| `NUXT_UPLOADS_DIR` | Ruta absoluta fuera del repositorio y de la web, p. ej. `/var/www/vhosts/tu-dominio/numiq-data/uploads`. Créala antes desde el Administrador de archivos; el usuario del dominio debe poder escribir en ella. |
| `GOOGLE_APP_EMAIL` `GOOGLE_APP_PASSWORD` | Correo de envío y recepción, o las `NUXT_MAIL_*` si es otro proveedor. |
| `NUXT_OPENAI_API_KEY` | Funciones de IA. |

El resto de variables opcionales está en [Variables de entorno](#variables-de-entorno).

### 5. Primer arranque y comprobación

1. Reinicia la aplicación. En la primera petición a `/api/*` (o 30 s después de arrancar) se aplican las migraciones y se crean las tablas.
2. Comprueba la conexión:
   ```bash
   curl -i https://tu-dominio/api/me
   ```
   - `401 Sesión no válida`: la base de datos está bien (aún no has iniciado sesión).
   - `503 Base de datos no disponible: …`: el mensaje dice la causa, por ejemplo usuario o contraseña incorrectos, la base no existe o no hay ningún MySQL en ese host/puerto.
3. En los registros de la app (**Node.js → Registros** o **Registros** del dominio) debe aparecer `[db] Migraciones aplicadas`. Si sale `[config] Falta NUXT_SESSION_PASSWORD`, falta esa variable o es demasiado corta.
4. En phpMyAdmin deberías ver las tablas y `__drizzle_migrations`, con una fila por migración.
5. Abre `https://tu-dominio/registro` y crea la primera cuenta, que será la propietaria (`owner`) de su empresa. El registro está abierto: cualquiera con la URL puede crear su propia cuenta, con datos separados.

### 6. Tareas programadas siempre activas

Recurrentes, recordatorios y limpieza viven dentro del proceso de Node. Plesk (Passenger) arranca la app con la primera visita, así que después de un despliegue o un reinicio del servidor no se ejecutan hasta que alguien entra.

Para evitarlo, crea en **Herramientas y configuración → Tareas programadas** (o en **Tareas programadas** del dominio) una tarea de tipo **Obtener una URL**, cada 5 minutos (`*/5 * * * *`), a:

```
https://tu-dominio/api/_auth/session
```

Responde `200` sin tocar la base de datos.

### 7. Copias y traslado a otro servidor

- **Copias:** la copia de seguridad de Plesk debe incluir la base de datos y la carpeta de `NUXT_UPLOADS_DIR`. Además, cada empresa puede descargar su ZIP completo desde **Ajustes**.
- **Clonar la instalación entera** (todas las tablas y archivos) por SSH. Como las variables del panel no llegan a la consola, crea un `.env` en la raíz de la app solo con `DB_*` y `NUXT_UPLOADS_DIR`. La app en marcha no lo lee; solo lo usan estos comandos:
  ```bash
  cd /var/www/vhosts/tu-dominio/httpdocs
  export PATH=/opt/plesk/node/24/bin:$PATH

  # En el origen: genera numiq-clon-completo-AAAA-MM-DD.zip
  npx tsx --env-file=.env scripts/clone-export.mjs

  # En el destino, con la base ya creada (paso 1)
  npx tsx --env-file=.env scripts/clone-import.mjs numiq-clon-completo-AAAA-MM-DD.zip
  ```
  **Cuidado:** `clone-import` borra y vuelve a crear todas las tablas de la base de destino y sobrescribe los archivos. Úsalo solo en una instalación vacía o de la que ya tengas copia. Después, reinicia la aplicación.

### Sin Plesk (VPS)

```bash
git clone <repo> /srv/numiq && cd /srv/numiq
npm ci && npm run build
cp .env.example .env    # rellénalo como en el paso 4
```

Servicio systemd (`/etc/systemd/system/numiq.service`):

```ini
[Unit]
Description=NUMIQ
After=network.target mariadb.service

[Service]
User=numiq
WorkingDirectory=/srv/numiq
Environment=HOST=127.0.0.1 PORT=3000
ExecStart=/usr/bin/node --env-file=/srv/numiq/.env .output/server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

`systemctl enable --now numiq`. Delante, nginx con HTTPS, `proxy_pass http://127.0.0.1:3000;`, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (los límites de intentos de acceso, registro y recuperación van por IP) y `client_max_body_size 300m;`. Para actualizar: `git pull && npm ci && npm run build && systemctl restart numiq`. El proceso queda siempre en marcha, así que aquí no hace falta el paso 6.

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
