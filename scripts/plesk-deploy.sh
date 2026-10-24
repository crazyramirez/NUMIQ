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

# Nº de build de la versión que se ve junto al logo: commits de la rama desplegada. Plesk guarda el repositorio
# fuera de esta carpeta (../git/*.git); si no aparece, sigue el contador del último despliegue.
build_number() {
  local repo
  git rev-list --count HEAD 2>/dev/null && return
  for repo in ../git/*.git; do
    [ -d "$repo" ] || continue
    git --git-dir="$repo" show HEAD:package.json 2>/dev/null | grep -q '"name": "numiq"' || continue
    git --git-dir="$repo" rev-list --count HEAD 2>/dev/null && return
  done
  echo $(( $(cat logs/build-number 2>/dev/null || echo 0) + 1 ))
}
NUMIQ_BUILD=$(build_number | tail -n 1)
export NUMIQ_BUILD
log "build $NUMIQ_BUILD"

rm -rf .output-next
NITRO_OUTPUT_DIR=.output-next npm run build || { rm -rf .output-next; log "ERROR: build falló, la web sigue con la versión anterior"; exit 1; }
[ -f .output-next/server/index.mjs ] && [ -f .output-next/server/app.mjs ] && [ -d .output-next/public/_nuxt ] || { rm -rf .output-next; log "ERROR: el build no dejó nada en .output-next, la web sigue con la versión anterior"; exit 1; }

rm -rf .output-old
[ -d .output ] && mv .output .output-old
mv .output-next .output
touch tmp/restart.txt
rm -rf .output-old
echo "$NUMIQ_BUILD" > logs/build-number
log "OK: nueva versión (build $NUMIQ_BUILD) en producción"