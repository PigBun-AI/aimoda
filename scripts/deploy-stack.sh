#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET_ENV=${1:-}

if [[ -z "$TARGET_ENV" ]]; then
  echo "Usage: $0 <dev|prod>" >&2
  exit 1
fi

case "$TARGET_ENV" in
  dev|prod) ;;
  *)
    echo "Unsupported target: $TARGET_ENV" >&2
    exit 1
    ;;
esac

ENV_FILE="$ROOT_DIR/env/${TARGET_ENV}.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

PROJECT_NAME=$(grep -E ^COMPOSE_PROJECT_NAME= "$ENV_FILE" | cut -d= -f2-)
if [[ -z "$PROJECT_NAME" ]]; then
  echo "COMPOSE_PROJECT_NAME is missing in $ENV_FILE" >&2
  exit 1
fi

cd "$ROOT_DIR"
echo "Deploying $TARGET_ENV stack ($PROJECT_NAME) from $ROOT_DIR"

docker compose --env-file "$ENV_FILE" -p "$PROJECT_NAME" up -d --build --remove-orphans

# nginx resolves Compose service hostnames at process start. When frontend/api are
# recreated during deploy, their container IPs can change while nginx keeps the
# stale upstream target, causing intermittent 502s on the web root. Restart nginx
# after the stack update so it re-resolves current service addresses.
if docker compose --env-file "$ENV_FILE" -p "$PROJECT_NAME" ps nginx >/dev/null 2>&1; then
  echo
  echo "Restarting nginx to refresh upstream service resolution..."
  docker compose --env-file "$ENV_FILE" -p "$PROJECT_NAME" restart nginx
fi

echo
echo "Running containers:"
docker compose --env-file "$ENV_FILE" -p "$PROJECT_NAME" ps
