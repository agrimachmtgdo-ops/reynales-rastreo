-- =============================================================================
-- Reversión: corregir la fecha de carga de un envío confirmado.
-- Las fechas de carga ya corregidas se conservan; se quitan del historial solo las
-- filas de tipo «carga» (el check anterior no las admite).
-- =============================================================================
set search_path = public, extensions;

drop function if exists public.cambiar_fecha_carga(uuid, date, text, text);
delete from public.cambios_compromiso where tipo = 'carga';
alter table public.cambios_compromiso drop constraint cambios_compromiso_tipo_check;
alter table public.cambios_compromiso add constraint cambios_compromiso_tipo_check
  check (tipo in ('reprogramado', 'cancelado'));
