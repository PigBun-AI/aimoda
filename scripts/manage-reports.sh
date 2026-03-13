#!/bin/sh
set -eu

PROJECT_NAME=${PROJECT_NAME:-fashion-report}
REPORTS_VOLUME=${PROJECT_NAME}_reports
DB_VOLUME=${PROJECT_NAME}_db

case "${1:-}" in
  import)
    docker run --rm -v "${REPORTS_VOLUME}:/reports" -v "$(pwd)/reports:/src:ro" alpine sh -c 'mkdir -p /reports && cp -r /src/. /reports/'
    ;;
  export)
    mkdir -p exported-reports
    docker run --rm -v "${REPORTS_VOLUME}:/reports" -v "$(pwd)/exported-reports:/dst" alpine sh -c 'cp -r /reports/. /dst/'
    ;;
  backup)
    ts=$(date +%Y%m%d-%H%M%S)
    mkdir -p "backups/${ts}"
    docker run --rm -v "${DB_VOLUME}:/data" -v "$(pwd)/backups/${ts}:/backup" alpine sh -c 'cp /data/fashion-report.db /backup/ || true'
    docker run --rm -v "${REPORTS_VOLUME}:/reports" -v "$(pwd)/backups/${ts}:/backup" alpine sh -c 'mkdir -p /backup/reports && cp -r /reports/. /backup/reports/'
    echo "Created backup at backups/${ts}"
    ;;
  list)
    docker run --rm -v "${REPORTS_VOLUME}:/reports" alpine ls -la /reports
    ;;
  *)
    echo 'Usage: manage-reports.sh {import|export|backup|list}' >&2
    exit 1
    ;;
esac
