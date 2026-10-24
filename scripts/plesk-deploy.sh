#!/usr/bin/env bash
# Acción posterior al despliegue en Plesk (Git → games.viseni.com). En Plesk, una sola línea:
#   bash scripts/plesk-deploy.sh
# - Si llega un push mientras otro se está compilando, espera su turno: nunca hay dos builds a la vez.
# - Compila en .output-next y solo lo pone en producción si el build termina bien: un fallo no rompe la web.
# - Deja cada ejecución en logs/deploy.log (fuera de la raíz web) para ver qué pasó.
# - public/games (fuera de git) se sube aparte por FTP/Archivos: el build lo copia a .output/public.
set -uo pipefail
cd "$(dirname "$0")/.."
# La misma versión de Node que el panel Node.js del dominio.
export PATH="/opt/plesk/node/24/bin:$PATH"
# Las páginas se prerenderizan en el build: las vistas previas (og:image) necesitan el dominio ya aquí,
# no basta con la variable del panel Node.js, que solo llega a la app en marcha.
export NUXT_PUBLIC_SITE_URL="${NUXT_PUBLIC_SITE_URL:-https://games.viseni.com}"
# Google Analytics (ID de medición G-…): vacío, la web no carga Analytics ni muestra el aviso de cookies.
export NUXT_PUBLIC_GA_ID="${NUXT_PUBLIC_GA_ID:-G-YTQGH108KN}"
mkdir -p logs tmp
exec > >(tee -a logs/deploy.log) 2>&1
log() { echo "[$(date '+%F %T')] $*"; }

exec 9>tmp/deploy.lock
log "push recibido (pid $$), esperando a que termine cualquier build anterior"
flock -w 1800 9 || { log "ERROR: otro build lleva más de 30 min, cancelado"; exit 1; }
log "inicio"

npm ci --include=dev --no-audit --no-fund || { log "ERROR: npm ci falló, la web sigue con la versión anterior"; exit 1; }

rm -rf .output-next
NITRO_OUTPUT_DIR=.output-next npm run build || { rm -rf .output-next; log "ERROR: build falló, la web sigue con la versión anterior"; exit 1; }
[ -f .output-next/server/index.mjs ] && [ -f .output-next/public/index.html ] || { rm -rf .output-next; log "ERROR: el build no dejó nada en .output-next, la web sigue con la versión anterior"; exit 1; }

rm -rf .output-old
[ -d .output ] && mv .output .output-old
mv .output-next .output
touch tmp/restart.txt
rm -rf .output-old
log "OK: nueva versión en producción"
