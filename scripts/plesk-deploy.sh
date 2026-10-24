#!/usr/bin/env bash
# Acción posterior al despliegue en Plesk (Git → viseni.com). En Plesk, una sola línea:
#   bash scripts/plesk-deploy.sh
# - Si llega un push mientras otro se está compilando, espera su turno: nunca hay dos builds a la vez.
# - Compila en .output-next y solo lo pone en producción si el build termina bien: un fallo no rompe la web.
# - Deja cada ejecución en logs/deploy.log (fuera de la raíz web) para ver qué pasó.
# - Plesk lo lanza con cada aviso de GitHub (también los de las Actions), no solo con los push: si el
#   código es el mismo que ya está en producción, no se vuelve a compilar.
# Todo entre llaves: bash lo lee entero antes de empezar, así un push que reescribe este archivo no
# cambia el que ya está en marcha o esperando turno.
{
set -uo pipefail
cd "$(dirname "$0")/.."
# El Node.js más nuevo que tenga Plesk instalado (25, 24 o 22)
for v in 25 24 22; do
  [ -x "/opt/plesk/node/$v/bin/node" ] && { export PATH="/opt/plesk/node/$v/bin:$PATH"; break; }
done
mkdir -p logs tmp
exec > >(tee -a logs/deploy.log) 2>&1
# Con zona horaria: el Devlog de Administración lee aquí cuándo llegó cada push
log() { echo "[$(date '+%F %T %z')] $*"; }

for cmd in node npm flock; do
  command -v "$cmd" >/dev/null || { log "ERROR: falta '$cmd'. En Plesk: Node.js 22, 24 o 25 instalado y acceso SSH /bin/bash (no chroot)"; exit 1; }
done

exec 9>tmp/deploy.lock
log "push recibido (pid $$, $(git rev-parse --short HEAD 2>/dev/null || echo '?')), esperando a que termine cualquier build anterior"
flock -w 1800 9 || { log "ERROR: otro build lleva más de 30 min, cancelado"; exit 1; }

# Huella de lo que entra en el build (lo del repositorio; nunca node_modules, storage ni la música)
src_hash() {
  find app server shared public scripts package.json package-lock.json nuxt.config.ts tsconfig.json server.mjs drizzle.config.ts \
    -type f -print0 2>/dev/null | sort -z | xargs -0 sha1sum | sha1sum | cut -c1-40
}
hash=$(src_hash)
if [ -f .output/server/index.mjs ] && [ "$hash" = "$(cat tmp/deployed.sha1 2>/dev/null)" ]; then
  log "sin cambios desde la última versión, no se compila"
  exit 0
fi
log "inicio (node $(node -v))"

npm ci --include=dev --no-audit --no-fund || { log "ERROR: npm ci falló, la web sigue con la versión anterior"; exit 1; }

# yt-dlp, ffmpeg y fpcalc en ./bin: solo descarga lo que falte (el primer despliegue tarda más)
npm run setup:bin || log "AVISO: setup:bin falló, se sigue con los binarios que haya en ./bin"

# Número de versión (junto al logo): cada despliegue que llega a producción suma uno
version="v$(( $(grep -c 'OK: nueva versión en producción' logs/deploy.log 2>/dev/null || true) + 1 ))"
log "compilando $version"

rm -rf .output-next
NITRO_OUTPUT_DIR=.output-next APP_VERSION="$version" npm run build || { rm -rf .output-next; log "ERROR: build falló, la web sigue con la versión anterior"; exit 1; }
[ -f .output-next/server/index.mjs ] && [ -f .output-next/public/sw.js ] \
  || { rm -rf .output-next; log "ERROR: el build no generó .output-next completo, la web sigue con la versión anterior"; exit 1; }

rm -rf .output-old
[ -d .output ] && { mv .output .output-old || { log "ERROR: no se pudo apartar .output"; exit 1; }; }
mv .output-next .output || { [ -d .output-old ] && mv .output-old .output; log "ERROR: no se pudo activar la versión nueva, restaurada la anterior"; exit 1; }
touch tmp/restart.txt
rm -rf .output-old
echo "$hash" > tmp/deployed.sha1
log "OK: nueva versión en producción ($version)"
exit
}
