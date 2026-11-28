#!/usr/bin/env bash
# Prueba las migraciones en un PostgreSQL local con PostGIS (sin Supabase).
# Uso: bash supabase/tests/run-local.sh   (requiere psql y permisos de superusuario)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-reynales_prueba}
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f tests/00_simular_supabase.sql
for f in migrations/*.sql; do
  echo "→ $f"
  "${PSQL[@]}" -d "$DB" -f "$f"
done
echo "→ seed.sql"
"${PSQL[@]}" -d "$DB" -f seed.sql
echo "→ pruebas"
"${PSQL[@]}" -d "$DB" -f tests/10_flujo_viaje.sql
"${PSQL[@]}" -d "$DB" -f tests/20_transbordo.sql
"${PSQL[@]}" -d "$DB" -f tests/30_operador_transbordo.sql
"${PSQL[@]}" -d "$DB" -f tests/40_documentos_mision.sql
echo "✔ Todas las pruebas pasaron"
