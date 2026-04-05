#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET_ENV=${1:-}

if [[ -z "$TARGET_ENV" ]]; then
  echo "Usage: $0 <dev|prod>" >&2
  exit 1
fi

ENV_FILE="$ROOT_DIR/env/${TARGET_ENV}.env"
LEGACY_ENV_FILE="$ROOT_DIR/env/server.${TARGET_ENV}.env"
if [[ ! -f "$ENV_FILE" && -f "$LEGACY_ENV_FILE" ]]; then
  ENV_FILE="$LEGACY_ENV_FILE"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

PROJECT_NAME=$(grep -E ^COMPOSE_PROJECT_NAME= "$ENV_FILE" | cut -d= -f2-)

cd "$ROOT_DIR"
docker compose --env-file "$ENV_FILE" -p "$PROJECT_NAME" restart
