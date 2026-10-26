#!/usr/bin/env bash
# Despliegue de apps Node en Plesk (Git + Node.js/Passenger) sin dejar la web rota.
#
# En Plesk > Git > «Acciones de despliegue adicionales», una sola línea:
#   bash scripts/plesk-deploy.sh
# Otros usos (por SSH, desde la carpeta de la app):
#   bash scripts/plesk-deploy.sh --dry-run    # muestra lo que detecta y no toca nada
#   bash scripts/plesk-deploy.sh --rollback   # vuelve a la versión anterior y reinicia
#
# Qué hace:
#  1. Espera su turno: si llega un push mientras otro compila, nunca hay dos builds a la vez.
#  2. Copia el código (sin lo que ignora git) a una carpeta de trabajo FUERA de la app
#     (../.deploy-<carpeta>/build) y compila ahí. La web sigue sirviendo la versión actual durante
#     todo el build y Plesk puede seguir escribiendo en la carpeta. (Dentro de la app no sirve:
#     Vite encuentra el tsconfig.json de la app y el build falla.)
#  3. Si instalar o compilar falla, producción no se toca.
#  4. Si va bien, cambia la salida (p. ej. .output) por la nueva, guarda la anterior en
#     ../.deploy-<carpeta>/previous y reinicia Passenger (tmp/restart.txt).
#  5. Opcional: comprueba una URL y, si no responde, vuelve sola a la versión anterior.
#  Cada ejecución queda en logs/deploy.log.
#
# Detecta solo (sin configurar nada):
#  - Node: NODE_VERSION, .nvmrc, .node-version o "engines.node" de package.json. Elige la versión
#    más alta instalada en /opt/plesk/node que cumpla. Pon la MISMA en el panel Node.js del dominio.
#  - Gestor de paquetes por lockfile: npm, pnpm o yarn.
#  - Salida: Nuxt/Nitro → .output · Next → .next + node_modules · otros → dist.
#
# Para ajustar algo, crea plesk-deploy.conf junto a package.json (se lee con bash) con lo que necesites:
#   NODE_VERSION=24                       # versión mayor de /opt/plesk/node a usar
#   PACKAGE_MANAGER=npm                   # npm | pnpm | yarn
#   INSTALL_CMD="npm ci --include=dev"    # sustituye la instalación detectada
#   BUILD_CMD="npm run build"             # sustituye el build detectado
#   OUTPUT_PATHS=".output"                # lo que se pasa a producción (separado por espacios)
#   REQUIRED_FILES=".output/server/index.mjs"   # debe existir tras el build o no se publica
#   LINK_FILES=".env .env.production"     # archivos fuera de git que el build necesita
#   LAUNCHER=plesk-start.mjs              # arranque que carga .env (solo Nitro); "" para no crearlo
#   HEALTHCHECK_URL=https://dominio.com/  # si no responde tras reiniciar, vuelve atrás
#   RESTART_CMD="touch tmp/restart.txt"
#   BUILD_ENV_NAME=MIAPP_BUILD            # además de DEPLOY_BUILD, exporta el nº de build con este nombre
#   BUILD_NODE_OPTIONS="--max-old-space-size=4096"
#   LOCK_TIMEOUT=1800
#   DEPLOY_DIR=/ruta/de/trabajo           # por defecto ../.deploy-<carpeta>, mismo disco que la app

set -uo pipefail

# --- Carpeta de la app: la más cercana con package.json subiendo desde este script ---------------
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
while [ "$APP_DIR" != "/" ] && [ ! -f "$APP_DIR/package.json" ]; do APP_DIR=$(dirname "$APP_DIR"); done
[ -f "$APP_DIR/package.json" ] || { echo "ERROR: no encuentro package.json por encima de $0"; exit 1; }
cd "$APP_DIR" || exit 1

MODE=deploy
case "${1:-}" in
  --dry-run) MODE=dry-run ;;
  --rollback) MODE=rollback ;;
  "") ;;
  *) echo "Uso: bash $0 [--dry-run|--rollback]"; exit 2 ;;
esac

# shellcheck disable=SC1091
[ -f plesk-deploy.conf ] && . ./plesk-deploy.conf

DEPLOY_DIR=${DEPLOY_DIR:-"$(dirname "$APP_DIR")/.deploy-$(basename "$APP_DIR")"}
case "$DEPLOY_DIR/" in "$APP_DIR"/*) echo "ERROR: DEPLOY_DIR no puede estar dentro de la app ($APP_DIR)"; exit 1 ;; esac
BUILD_DIR="$DEPLOY_DIR/build"
PREV_DIR="$DEPLOY_DIR/previous"
mkdir -p logs tmp
mkdir -p "$DEPLOY_DIR" 2>/dev/null || { echo "ERROR: no puedo crear $DEPLOY_DIR; indica otra carpeta con DEPLOY_DIR en plesk-deploy.conf"; exit 1; }

# Log: recorta si pasa de ~5 MB y duplica la salida en pantalla y en el archivo.
if [ -f logs/deploy.log ] && [ "$(wc -c < logs/deploy.log)" -gt 5000000 ]; then
  tail -n 3000 logs/deploy.log > logs/deploy.log.tmp && mv logs/deploy.log.tmp logs/deploy.log
fi
[ "$MODE" = dry-run ] || exec > >(tee -a logs/deploy.log) 2>&1
log() { echo "[$(date '+%F %T')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

# --- Turno: un solo despliegue a la vez ------------------------------------------------------------
take_lock() {
  local timeout=${LOCK_TIMEOUT:-1800}
  exec 9>"$DEPLOY_DIR/deploy.lock"
  log "esperando a que termine cualquier despliegue anterior (pid $$)"
  if command -v flock >/dev/null; then
    flock -w "$timeout" 9 || fail "otro despliegue lleva más de $timeout s, cancelado"
  else # sin flock (p. ej. macOS): bloqueo con mkdir
    local waited=0
    until mkdir "$DEPLOY_DIR/deploy.lockdir" 2>/dev/null; do
      [ "$waited" -ge "$timeout" ] && fail "otro despliegue lleva más de $timeout s, cancelado"
      sleep 5; waited=$((waited + 5))
    done
    trap 'rmdir "$DEPLOY_DIR/deploy.lockdir" 2>/dev/null' EXIT
  fi
}

# --- Node -----------------------------------------------------------------------------------------
# ¿Cumple el node indicado el rango? Usa el semver que trae npm; si no está, compara la versión mínima.
node_satisfies() {
  "$1/node" -e '
    const range = process.argv[1], path = require("path");
    let semver;
    for (const p of [path.join(path.dirname(process.execPath), "../lib/node_modules/npm/node_modules/semver"), "semver"]) {
      try { semver = require(p); break } catch {}
    }
    if (semver) process.exit(semver.satisfies(process.version, range) ? 0 : 1);
    const min = ((range.match(/\d+(\.\d+){0,2}/) || ["0"])[0]).split(".").map(Number);
    const cur = process.versions.node.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((cur[i] || 0) !== (min[i] || 0)) process.exit((cur[i] || 0) > (min[i] || 0) ? 0 : 1);
  ' "$2"
}

pick_node() {
  local want="${NODE_VERSION:-}" source="NODE_VERSION" range="" bin
  if [ -z "$want" ] && [ -f .nvmrc ]; then want=$(tr -d ' \r\n' < .nvmrc); source=.nvmrc; fi
  if [ -z "$want" ] && [ -f .node-version ]; then want=$(tr -d ' \r\n' < .node-version); source=.node-version; fi
  want=${want#v}
  case "$want" in [0-9]*) ;; *) want="" ;; esac # "lts/*", "node"… → se usa engines

  local candidates=()
  if [ -d /opt/plesk/node ]; then
    while IFS= read -r bin; do candidates+=("$bin"); done < <(ls -d /opt/plesk/node/*/bin 2>/dev/null | sort -Vr)
  fi
  if [ ${#candidates[@]} -eq 0 ]; then # fuera de Plesk (pruebas en local): el node del PATH
    bin=$(dirname "$(command -v node 2>/dev/null)") || fail "no hay Node instalado"
    [ -x "$bin/node" ] || fail "no hay Node instalado"
    log "AVISO: no existe /opt/plesk/node; uso el node del PATH ($("$bin/node" -v))"
    NODE_BIN=$bin; return
  fi

  if [ -n "$want" ]; then
    NODE_BIN="/opt/plesk/node/${want%%.*}/bin"
    [ -x "$NODE_BIN/node" ] || fail "$source pide Node ${want%%.*} y no está instalado en Plesk. Instaladas: $(ls /opt/plesk/node | tr '\n' ' ')"
    return
  fi

  range=$("${candidates[0]}/node" -p 'try { require("./package.json").engines?.node || "" } catch { "" }')
  for bin in "${candidates[@]}"; do
    if [ -z "$range" ] || node_satisfies "$bin" "$range"; then NODE_BIN=$bin; return; fi
  done
  fail "ninguna versión de Node instalada en Plesk cumple engines.node \"$range\". Instaladas: $(ls /opt/plesk/node | tr '\n' ' ')"
}

# --- Proyecto -------------------------------------------------------------------------------------
pkg() { node -p "try { const p = require('./package.json'); String($1 ?? '') } catch { '' }"; }

detect_project() {
  local deps
  deps=$(pkg 'Object.keys({ ...p.dependencies, ...p.devDependencies }).join(" ")')
  PKG_NAME=$(pkg 'p.name')

  if [ -z "${PACKAGE_MANAGER:-}" ]; then
    if [ -f pnpm-lock.yaml ]; then PACKAGE_MANAGER=pnpm
    elif [ -f yarn.lock ]; then PACKAGE_MANAGER=yarn
    else PACKAGE_MANAGER=npm; fi
  fi
  # pnpm y yarn mediante corepack (Node ≤24) o npx (Node 25+ ya no trae corepack).
  local runner=""
  case "$PACKAGE_MANAGER" in
    npm) runner="npm" ;;
    pnpm|yarn) if command -v corepack >/dev/null; then runner="corepack $PACKAGE_MANAGER"; else runner="npx --yes $PACKAGE_MANAGER"; fi ;;
    *) fail "PACKAGE_MANAGER no válido: $PACKAGE_MANAGER" ;;
  esac
  if [ -z "${INSTALL_CMD:-}" ]; then
    case "$PACKAGE_MANAGER" in
      npm) if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then INSTALL_CMD="npm ci --include=dev --no-audit --no-fund"
           else INSTALL_CMD="npm install --include=dev --no-audit --no-fund"; fi ;;
      pnpm) INSTALL_CMD="$runner install --frozen-lockfile --prod=false" ;;
      yarn) if [ -f .yarnrc.yml ]; then INSTALL_CMD="$runner install --immutable"
            else INSTALL_CMD="$runner install --frozen-lockfile --production=false"; fi ;;
    esac
  fi
  if [ -z "${BUILD_CMD:-}" ] && [ -n "$(pkg 'p.scripts?.build')" ]; then BUILD_CMD="$runner run build"; fi

  local is_nitro="" is_next=""
  for d in $deps; do case "$d" in nuxt|nitropack|nitro) is_nitro=1 ;; next) is_next=1 ;; esac; done
  if [ -n "$is_nitro" ]; then
    : "${OUTPUT_PATHS:=.output}"; : "${REQUIRED_FILES:=.output/server/index.mjs}"
    START_FILE=.output/server/index.mjs; LAUNCHER=${LAUNCHER-plesk-start.mjs}; FRAMEWORK="Nuxt/Nitro"
  elif [ -n "$is_next" ]; then
    : "${OUTPUT_PATHS:=.next node_modules}"; : "${REQUIRED_FILES:=.next/BUILD_ID}"; FRAMEWORK="Next.js"
  else
    : "${OUTPUT_PATHS:=dist}"; FRAMEWORK="genérico"
  fi
  : "${REQUIRED_FILES:=$OUTPUT_PATHS}"
  : "${LINK_FILES:=.env .env.production .env.production.local}"
  : "${RESTART_CMD:=mkdir -p tmp && touch tmp/restart.txt}"
  LAUNCHER=${LAUNCHER:-}
}

# Nº de build: commits de la rama desplegada. Plesk guarda el repositorio fuera de la carpeta de la
# app (normalmente ../git/<nombre>.git); se reconoce por el "name" de package.json.
build_info() {
  local repo
  if git rev-parse --git-dir >/dev/null 2>&1; then
    DEPLOY_BUILD=$(git rev-list --count HEAD); DEPLOY_COMMIT=$(git rev-parse --short HEAD); return
  fi
  for repo in "$APP_DIR"/../git/*.git "$APP_DIR"/../../git/*.git; do
    [ -d "$repo" ] || continue
    git --git-dir="$repo" show HEAD:package.json 2>/dev/null | grep -q "\"name\": *\"$PKG_NAME\"" || continue
    DEPLOY_BUILD=$(git --git-dir="$repo" rev-list --count HEAD); DEPLOY_COMMIT=$(git --git-dir="$repo" rev-parse --short HEAD); return
  done
  DEPLOY_BUILD=$(( $(cat "$DEPLOY_DIR/build-number" 2>/dev/null || echo 0) + 1 )); DEPLOY_COMMIT=""
}

# --- Pasos ----------------------------------------------------------------------------------------
sync_sources() {
  command -v rsync >/dev/null || fail "hace falta rsync en el servidor"
  local excludes=(--exclude=/.git --exclude=/logs --exclude=/tmp --exclude=/plesk-deploy.conf)
  for p in $OUTPUT_PATHS; do excludes+=("--exclude=/$p"); done
  mkdir -p "$BUILD_DIR"
  # Lo ignorado por git no se copia ni se borra en destino (así node_modules sirve de caché).
  rsync -a --delete --filter=':- .gitignore' "${excludes[@]}" ./ "$BUILD_DIR/" || fail "no se pudo copiar el código a $BUILD_DIR"
  for f in $LINK_FILES; do [ -e "$APP_DIR/$f" ] && ln -sfn "$APP_DIR/$f" "$BUILD_DIR/$f"; done
  for p in $OUTPUT_PATHS; do [ "$p" = node_modules ] || rm -rf "${BUILD_DIR:?}/$p"; done
}

run_in_build() { (cd "$BUILD_DIR" && bash -c "$1"); }

write_launcher() {
  [ -n "$LAUNCHER" ] && [ -n "${START_FILE:-}" ] || return 0
  cat > "$LAUNCHER" <<EOF
// Generado por scripts/plesk-deploy.sh. En Plesk > Node.js, «Archivo de inicio de la aplicación»: $LAUNCHER
// Carga .env (sin pisar las variables ya definidas en el panel) y arranca la app.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('.', import.meta.url)))
if (existsSync('.env')) process.loadEnvFile('.env')
await import('./$START_FILE')
EOF
}

restart_app() { bash -c "$RESTART_CMD" || log "AVISO: el reinicio ($RESTART_CMD) devolvió error"; }

healthy() {
  [ -n "${HEALTHCHECK_URL:-}" ] || return 0
  local i
  for i in 1 2 3 4 5 6; do
    sleep 5
    if curl -fsS -o /dev/null --max-time 20 "$HEALTHCHECK_URL"; then log "responde $HEALTHCHECK_URL"; return 0; fi
    log "todavía no responde $HEALTHCHECK_URL (intento $i/6)"
  done
  return 1
}

rollback() {
  local p moved=""
  for p in $OUTPUT_PATHS; do [ -e "$PREV_DIR/$p" ] && moved=1; done
  [ -n "$moved" ] || fail "no hay versión anterior guardada en $PREV_DIR"
  rm -rf "$DEPLOY_DIR/failed"; mkdir -p "$DEPLOY_DIR/failed"
  for p in $OUTPUT_PATHS; do
    [ -e "$PREV_DIR/$p" ] || continue
    [ -e "$p" ] && { mkdir -p "$(dirname "$DEPLOY_DIR/failed/$p")"; mv "$p" "$DEPLOY_DIR/failed/$p"; }
    mv "$PREV_DIR/$p" "$p"
  done
  restart_app
  log "vuelta a la versión anterior; la retirada queda en $DEPLOY_DIR/failed"
}

# --- Main -----------------------------------------------------------------------------------------
pick_node
export PATH="$NODE_BIN:$PATH"
detect_project

if [ "$MODE" = dry-run ]; then
  build_info
  cat <<EOF
App:        $APP_DIR ($PKG_NAME, $FRAMEWORK)
Node:       $(node -v) en $NODE_BIN  (engines: $(pkg 'p.engines?.node' || true))
Instalar:   $INSTALL_CMD
Compilar:   ${BUILD_CMD:-<sin script build>}
Publica:    $OUTPUT_PATHS   (debe existir: $REQUIRED_FILES)
Enlaza:     $LINK_FILES
Arranque:   ${LAUNCHER:-${START_FILE:-?}}
Reinicio:   $RESTART_CMD
Health:     ${HEALTHCHECK_URL:-<sin comprobar>}
Trabajo:    $DEPLOY_DIR
Build nº:   $DEPLOY_BUILD ${DEPLOY_COMMIT:+($DEPLOY_COMMIT)}
EOF
  exit 0
fi

take_lock

if [ "$MODE" = rollback ]; then rollback; exit 0; fi

log "inicio · $PKG_NAME ($FRAMEWORK) · Node $(node -v) · $PACKAGE_MANAGER"
[ -f .env ] || log "AVISO: no hay .env en $APP_DIR; las variables tendrán que estar en el panel Node.js"
build_info
export DEPLOY_BUILD DEPLOY_COMMIT
[ -n "${BUILD_ENV_NAME:-}" ] && export "$BUILD_ENV_NAME=$DEPLOY_BUILD"
log "build $DEPLOY_BUILD ${DEPLOY_COMMIT:+($DEPLOY_COMMIT)}"

sync_sources
[ -n "${BUILD_NODE_OPTIONS:-}" ] && export NODE_OPTIONS="$BUILD_NODE_OPTIONS"
run_in_build "$INSTALL_CMD" || fail "la instalación falló; la web sigue con la versión anterior"
if [ -n "${BUILD_CMD:-}" ]; then
  run_in_build "$BUILD_CMD" || fail "el build falló; la web sigue con la versión anterior"
fi
for f in $REQUIRED_FILES; do
  [ -e "$BUILD_DIR/$f" ] || fail "el build no generó $f; la web sigue con la versión anterior"
done

# Publicar: la versión actual pasa a $PREV_DIR (se conserva para --rollback).
rm -rf "$PREV_DIR"; mkdir -p "$PREV_DIR"
for p in $OUTPUT_PATHS; do
  if [ -e "$p" ]; then mkdir -p "$(dirname "$PREV_DIR/$p")"; mv "$p" "$PREV_DIR/$p"; fi
  mkdir -p "$(dirname "$p")"; mv "$BUILD_DIR/$p" "$p"
done
write_launcher
restart_app

if ! healthy; then
  log "ERROR: la nueva versión no responde; vuelvo a la anterior"
  rollback
  exit 1
fi
echo "$DEPLOY_BUILD" > "$DEPLOY_DIR/build-number"
log "OK: build $DEPLOY_BUILD en producción"
