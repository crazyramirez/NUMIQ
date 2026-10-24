#!/usr/bin/env bash
# Acción posterior al despliegue en Plesk (Git → numiq.viseni.com). En Plesk, una sola línea:
#   bash scripts/plesk-deploy.sh
# - Si llega un push mientras otro se está compilando, espera su turno: nunca hay dos builds a la vez.
# - Compila en .output-next y solo lo pone en producción si el build termina bien: un fallo no rompe la web.
# - Deja cada ejecución en logs/deploy.log (fuera de la raíz web) para ver qué pasó.
# - La configuración va en el .env de esta carpeta (fuera de git): la app lo lee al arrancar.
set -uo pipefail
cd "$(dirname "$0")/.."
# La misma versión de Node que el panel Node.js del dominio.
export PATH="/opt/plesk/node/24/bin:$PATH"
mkdir -p logs tmp
exec > >(tee -a logs/deploy.log) 2>&1
log() { echo "[$(date '+%F %T')] $*"; }

exec 9>tmp/deploy.lock
log "push recibido (pid $$), esperando a que termine cualquier build anterior"
flock -w 1800 9 || { log "ERROR: otro build lleva más de 30 min, cancelado"; exit 1; }
log "inicio"
[ -f .env ] || log "AVISO: no hay .env en $(pwd): la app no sabrá a qué base de datos conectar"

npm ci --include=dev --no-audit --no-fund || { log "ERROR: npm ci falló, la web sigue con la versión anterior"; exit 1; }

rm -rf .output-next
NITRO_OUTPUT_DIR=.output-next npm run build || { rm -rf .output-next; log "ERROR: build falló, la web sigue con la versión anterior"; exit 1; }
[ -f .output-next/server/index.mjs ] && [ -f .output-next/server/app.mjs ] && [ -d .output-next/public/_nuxt ] || { rm -rf .output-next; log "ERROR: el build no dejó nada en .output-next, la web sigue con la versión anterior"; exit 1; }

rm -rf .output-old
[ -d .output ] && mv .output .output-old
mv .output-next .output
touch tmp/restart.txt
rm -rf .output-old
log "OK: nueva versión en producción"