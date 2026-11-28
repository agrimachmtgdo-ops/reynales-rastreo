-- =============================================================================
-- REVERTIR la migración 20261203000100_enlace_cliente.sql
-- Los enlaces creados quedan en la tabla (como estaban antes), pero ya nadie
-- puede consultarlos sin sesión. Se pierde el conteo de visitas.
-- =============================================================================
begin;
drop function if exists public.seguimiento_publico(text);
drop function if exists public.crear_enlace_seguimiento(uuid);
drop function if exists public.anular_enlace_seguimiento(uuid);
alter table public.enlaces_seguimiento
  drop column if exists visitas,
  drop column if exists primera_visita,
  drop column if exists ultima_visita;
drop index if exists public.enlaces_seguimiento_mision_idx;
commit;
