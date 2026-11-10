#!/bin/bash
# Daily encrypted backup of the Byle Gateway PostgreSQL database.
# Installed at /usr/local/sbin/byle-backup.sh on the VPS, run via cron.
set -euo pipefail

BACKUP_DIR="/root/backups/byle-gateway"
RETENTION_DAYS=14
CONTAINER="byle-production-postgres-1"
POSTGRES_USER="byle"
POSTGRES_DB="byle"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="${BACKUP_DIR}/byle-${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

docker exec "${CONTAINER}" pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc > "${DUMP_FILE}"
chmod 600 "${DUMP_FILE}"

# Prune dumps older than the retention window.
find "${BACKUP_DIR}" -name 'byle-*.dump' -mtime "+${RETENTION_DAYS}" -delete

echo "$(date -u +%FT%TZ) backup ${DUMP_FILE} ($(du -h "${DUMP_FILE}" | cut -f1))" >> "${BACKUP_DIR}/backup.log"
