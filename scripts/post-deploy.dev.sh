#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ROOT_DIR:-}" || -z "${ENV_FILE:-}" || -z "${PROJECT_NAME:-}" ]]; then
  echo "ROOT_DIR / ENV_FILE / PROJECT_NAME must be provided by deploy-stack.sh" >&2
  exit 1
fi

echo "Backfilling report covers on dev..."
docker compose --env-file "$ENV_FILE" -p "$PROJECT_NAME" exec -T api \
  python scripts/backfill_report_covers.py --force

echo "Dev report cover backfill completed."
