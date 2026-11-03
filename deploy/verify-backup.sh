#!/bin/sh
# Run inside the PostgreSQL container, using the same role as the application.
set -eu
restore_db="byle_restore_check_$$"
dump_path=$(mktemp)
created_restore=false
cleanup() {
  if [ "$created_restore" = true ]; then
    dropdb -U "$POSTGRES_USER" --if-exists "$restore_db" >/dev/null 2>&1 || true
  fi
  rm -f "$dump_path"
}
trap cleanup EXIT INT TERM
pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$dump_path"
createdb -U "$POSTGRES_USER" "$restore_db"
created_restore=true
pg_restore -U "$POSTGRES_USER" -d "$restore_db" --no-owner --exit-on-error "$dump_path"
version=$(psql -U "$POSTGRES_USER" -d "$restore_db" -Atc 'SELECT max(version) FROM gateway_migrations')
test "$version" -ge 3
psql -U "$POSTGRES_USER" -d "$restore_db" -v ON_ERROR_STOP=1 -Atc 'SELECT count(*) FROM payments; SELECT count(*) FROM apps; SELECT count(*) FROM payment_events; SELECT count(*) FROM webhook_deliveries; SELECT count(*) FROM owner_sessions;' >/dev/null
printf 'Backup restored successfully; migration version %s and core tables verified.\n' "$version"
