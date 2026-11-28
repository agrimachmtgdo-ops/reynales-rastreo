-- Reversión de 20261217000100_lotes_balanza.sql: quita lotes, ticket de balanza y sus funciones.
-- Las toneladas cargadas (neto) se conservan tal como están. Los lotes registrados se pierden.
set search_path = public, extensions;

drop function if exists public.buscar_lote(text);
drop function if exists public.registrar_balanza(uuid, text, numeric, numeric, numeric);
drop function if exists public.quitar_lote(uuid);
drop function if exists public.guardar_lote(uuid, uuid, jsonb);
drop trigger if exists cargas_lote_suma on public.cargas_lote;
drop function if exists public.trg_kg_lotes();
drop table if exists public.cargas_lote;
drop function if exists public.kg_por_unidad(text);
drop trigger if exists asignaciones_neto_balanza on public.asignaciones;
drop function if exists public.trg_neto_balanza();
alter table public.asignaciones
  drop constraint if exists asignaciones_bruto_mayor_tara,
  drop column if exists kg_lotes,
  drop column if exists tara_kg,
  drop column if exists peso_bruto_kg,
  drop column if exists ticket_balanza;
delete from public.configuracion where clave = 'lotes_tolerancia_pct';
