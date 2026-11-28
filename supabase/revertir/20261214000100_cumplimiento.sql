-- Reversión de la fase C4 (cumplimiento). Borra solo lo que agregó la migración:
-- cinco funciones de lectura/ajuste y cuatro claves de configuración. No toca otros datos.
set search_path = public, extensions;

drop function if exists public.reporte_transportistas(date, date);
drop function if exists public.reporte_cumplimiento(date, date, uuid, text);
drop function if exists public.solo_clientes_propios();
drop function if exists public.fijar_ajustes_cumplimiento(integer, numeric, numeric, integer);
drop function if exists public.ajustes_cumplimiento();

delete from public.configuracion
 where clave in ('otif_tolerancia_dias', 'otif_tolerancia_pct', 'otif_meta_pct', 'puntualidad_tolerancia_min');
