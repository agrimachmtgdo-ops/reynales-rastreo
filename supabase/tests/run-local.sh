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
"${PSQL[@]}" -d "$DB" -f tests/50_reporte_entregas.sql
"${PSQL[@]}" -d "$DB" -f tests/60_destino_chile.sql
echo "→ ida y vuelta de la reversión de Chile (se detiene si hay datos CL)"
"${PSQL[@]}" -d "$DB" -c "delete from public.documentos where mision_id in (select m.id from public.misiones m join public.ubicaciones u on u.id = m.destino_id where u.pais = 'CL')" -c "delete from public.misiones where destino_id in (select id from public.ubicaciones where pais = 'CL')" -c "delete from public.ubicaciones where pais = 'CL'" -c "delete from public.clientes where pais = 'CL'" >/dev/null
"${PSQL[@]}" -d "$DB" -f revertir/20261208000100_destino_chile.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261208000100_destino_chile.sql
"${PSQL[@]}" -d "$DB" -f tests/70_roles_comercial.sql
echo "→ ida y vuelta de la reversión de roles"
"${PSQL[@]}" -d "$DB" -f revertir/20261209000100_roles_comercial.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261209000100_roles_comercial.sql
"${PSQL[@]}" -d "$DB" -f tests/80_pedidos.sql
echo "→ ida y vuelta de la reversión de pedidos"
"${PSQL[@]}" -d "$DB" -f revertir/20261210000100_pedidos.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261210000100_pedidos.sql
echo "✔ Todas las pruebas pasaron"
