#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET_ENV=${1:-}

if [[ -z "$TARGET_ENV" ]]; then
  echo "Usage: $0 <dev|prod>" >&2
  exit 1
fi

ENV_FILE="$ROOT_DIR/env/${TARGET_ENV}.env"
PROJECT_NAME=$(grep -E ^COMPOSE_PROJECT_NAME= "$ENV_FILE" | cut -d= -f2-)

cd "$ROOT_DIR"
docker compose --env-file "$ENV_FILE" -p "$PROJECT_NAME" restart
