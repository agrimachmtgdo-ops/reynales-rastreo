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
  # El envío completo (C3b) se aplica más abajo, junto con sus pruebas.
  [[ "$f" == *20261215000100_envio_completo.sql ]] && continue
  # El catálogo de productos se aplica al final, junto con sus pruebas.
  [[ "$f" == *20261216000100_productos.sql ]] && continue
  [[ "$f" == *20261217000100_lotes_balanza.sql ]] && continue
  [[ "$f" == *20261218000100_inspeccion_precinto.sql ]] && continue
  [[ "$f" == *20261219000100_requisitos_documentos.sql ]] && continue
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
echo "→ ida y vuelta de la reversión de pedido y programa (con datos)"
"${PSQL[@]}" -d "$DB" -f revertir/20261211000100_pedido_programa.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261211000100_pedido_programa.sql
echo "→ ida y vuelta de la reversión de pedidos"
"${PSQL[@]}" -d "$DB" -f revertir/20261213000100_fecha_carga.sql
"${PSQL[@]}" -d "$DB" -f revertir/20261212000100_requerimiento_unidades.sql
"${PSQL[@]}" -d "$DB" -f revertir/20261211000100_pedido_programa.sql
"${PSQL[@]}" -d "$DB" -f revertir/20261210000100_pedidos.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261210000100_pedidos.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261211000100_pedido_programa.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261212000100_requerimiento_unidades.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261213000100_fecha_carga.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261215000100_envio_completo.sql
"${PSQL[@]}" -d "$DB" -f tests/90_requerimiento_unidades.sql
echo "→ ida y vuelta de la reversión de la fecha de carga (con datos)"
"${PSQL[@]}" -d "$DB" -f revertir/20261213000100_fecha_carga.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261213000100_fecha_carga.sql
echo "→ ida y vuelta de la reversión del requerimiento de unidades (con datos)"
"${PSQL[@]}" -d "$DB" -f revertir/20261215000100_envio_completo.sql
"${PSQL[@]}" -d "$DB" -f revertir/20261212000100_requerimiento_unidades.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261212000100_requerimiento_unidades.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261215000100_envio_completo.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261214000100_cumplimiento.sql
"${PSQL[@]}" -d "$DB" -f tests/95_cumplimiento.sql
echo "→ ida y vuelta de la reversión del cumplimiento"
"${PSQL[@]}" -d "$DB" -f revertir/20261214000100_cumplimiento.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261214000100_cumplimiento.sql
"${PSQL[@]}" -d "$DB" -f tests/96_envio_completo.sql
echo "→ ida y vuelta de la reversión del envío completo"
"${PSQL[@]}" -d "$DB" -f revertir/20261215000100_envio_completo.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261215000100_envio_completo.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261216000100_productos.sql
"${PSQL[@]}" -d "$DB" -f tests/97_productos.sql
echo "→ ida y vuelta de la reversión del catálogo de productos (con datos)"
"${PSQL[@]}" -d "$DB" -f revertir/20261216000100_productos.sql
"${PSQL[@]}" -d "$DB" -c "select 1 from public.misiones where tipo_carga = 'Torta de soya 97'" | grep -q 1
"${PSQL[@]}" -d "$DB" -f migrations/20261216000100_productos.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261217000100_lotes_balanza.sql
"${PSQL[@]}" -d "$DB" -f tests/98_lotes_balanza.sql
echo "→ ida y vuelta de la reversión de lotes y balanza (con datos)"
"${PSQL[@]}" -d "$DB" -f revertir/20261217000100_lotes_balanza.sql
"${PSQL[@]}" -d "$DB" -c "select 1 from public.asignaciones where toneladas_cargadas = 29.4" | grep -q 1
"${PSQL[@]}" -d "$DB" -f migrations/20261217000100_lotes_balanza.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261218000100_inspeccion_precinto.sql
"${PSQL[@]}" -d "$DB" -f tests/99_inspeccion_precinto.sql
echo "→ ida y vuelta de la reversión de inspección y precinto (con datos)"
"${PSQL[@]}" -d "$DB" -c "update public.usuarios set area = null where area = 'almacen'" >/dev/null
"${PSQL[@]}" -d "$DB" -f revertir/20261218000100_inspeccion_precinto.sql
"${PSQL[@]}" -d "$DB" -c "select 1 from public.asignaciones where precinto = 'P-77'" | grep -q 1
"${PSQL[@]}" -d "$DB" -tA -c "select count(*) from pg_proc where proname in ('guardar_lote','quitar_lote','registrar_balanza') and prosrc like '%puede_editar()%'" | grep -qx 3
"${PSQL[@]}" -d "$DB" -f migrations/20261218000100_inspeccion_precinto.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261219000100_requisitos_documentos.sql
"${PSQL[@]}" -d "$DB" -f tests/100_requisitos_documentos.sql
echo "→ ida y vuelta de la reversión de requisitos de documentos (se detiene si hay documentos nuevos)"
if "${PSQL[@]}" -d "$DB" -f revertir/20261219000100_requisitos_documentos.sql 2>/dev/null; then echo "FALLÓ: la reversión debía detenerse"; exit 1; fi
"${PSQL[@]}" -d "$DB" -c "update public.documentos set etiqueta = 'lista_empaque' where etiqueta not in ('lista_empaque')" >/dev/null
"${PSQL[@]}" -d "$DB" -f revertir/20261219000100_requisitos_documentos.sql
"${PSQL[@]}" -d "$DB" -f migrations/20261219000100_requisitos_documentos.sql
echo "✔ Todas las pruebas pasaron"
