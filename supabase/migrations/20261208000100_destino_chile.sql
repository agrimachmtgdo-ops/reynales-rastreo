-- =============================================================================
-- Fase C0: Chile como destino (envíos FOB Arica)
--
--  * clientes.pais y ubicaciones.pais aceptan 'CL' además de 'BO' y 'PE'.
--  * Las 5 funciones que trataban «internacional» como «Perú» pasan a tratarlo
--    como «destino fuera de Bolivia»:
--      - evaluar_geocercas: cruce de frontera sin parada.
--      - trg_documentos_carga: DEX obligatorio al salir de fábrica.
--      - trg_documentos_salida: CRT y MIC/DTA en el tramo 2 o 3.
--      - reporte_entregas: documentos completos.
--      - seguimiento_publico: hora de Santiago para destinos en Chile.
--
-- Cómo: se toma la definición vigente de cada función (pg_get_functiondef), se
-- cambia SOLO la condición indicada y se vuelve a crear. Si el texto esperado no
-- aparece exactamente una vez, la migración se detiene sin cambiar nada.
-- No agrega valores a ningún enum, no borra ni modifica datos.
-- Reversión: supabase/revertir/20261208000100_destino_chile.sql
-- =============================================================================
set search_path = public, extensions;

alter table public.clientes drop constraint clientes_pais_check;
alter table public.clientes add constraint clientes_pais_check check (pais in ('BO', 'PE', 'CL'));
alter table public.ubicaciones drop constraint ubicaciones_pais_check;
alter table public.ubicaciones add constraint ubicaciones_pais_check check (pais in ('BO', 'PE', 'CL'));

create function pg_temp.cambiar_en_funcion(p_funcion regprocedure, p_antes text, p_despues text)
returns void language plpgsql as $$
declare
  def text := pg_get_functiondef(p_funcion);
  veces int := (length(def) - length(replace(def, p_antes, ''))) / length(p_antes);
begin
  if veces <> 1 then
    raise exception 'En % se esperaba 1 vez «%» y hay %', p_funcion, p_antes, veces;
  end if;
  execute replace(def, p_antes, p_despues);
end $$;

select pg_temp.cambiar_en_funcion('public.evaluar_geocercas(uuid, extensions.geography, timestamptz, integer)'::regprocedure,
  $a$if destino.pais = 'PE' and a.etapa = 'en_ruta' then$a$,
  $a$if destino.pais <> 'BO' and a.etapa = 'en_ruta' then$a$);

select pg_temp.cambiar_en_funcion('public.trg_documentos_carga()'::regprocedure,
  $a$where m.id = new.mision_id and u.pais = 'PE') then$a$,
  $a$where m.id = new.mision_id and u.pais <> 'BO') then$a$);

select pg_temp.cambiar_en_funcion('public.trg_documentos_salida()'::regprocedure,
  $a$where m.id = new.mision_id and d.pais = 'PE') then$a$,
  $a$where m.id = new.mision_id and d.pais <> 'BO') then$a$);

select pg_temp.cambiar_en_funcion('public.reporte_entregas(date, date, uuid, text, uuid)'::regprocedure,
  $a$and (el.pais <> 'PE' or coalesce('dex' = any(dc.tipos), false)),$a$,
  $a$and (el.pais = 'BO' or coalesce('dex' = any(dc.tipos), false)),$a$);

select pg_temp.cambiar_en_funcion('public.seguimiento_publico(text)'::regprocedure,
  $a$case when m.destino_pais = 'PE' then 'America/Lima' else 'America/La_Paz' end$a$,
  $a$case m.destino_pais when 'PE' then 'America/Lima' when 'CL' then 'America/Santiago' else 'America/La_Paz' end$a$);
