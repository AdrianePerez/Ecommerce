#!/usr/bin/env bash
# Aplica as migrações num Postgres local descartável e roda os testes SQL.
# Uso: PGHOST=/caminho/socket PGPORT=5433 ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists dualshop_test" -c "create database dualshop_test"
$P -d dualshop_test -f supabase/tests/local_stubs.sql
for f in supabase/migrations/*.sql; do $P -d dualshop_test -f "$f"; done
for t in supabase/tests/*.test.sql; do echo "== $t"; $P -d dualshop_test -f "$t"; done
