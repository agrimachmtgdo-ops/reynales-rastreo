-- =============================================================================
-- Reversión de 20261208000100_destino_chile.sql
-- Devuelve las 5 funciones a «internacional = Perú» y los países a BO y PE.
-- No borra datos: si ya hay clientes o ubicaciones en Chile, se detiene y avisa.
-- =============================================================================
begin;
set search_path = public, extensions;

do $$
begin
  if exists (select 1 from public.clientes where pais = 'CL')
     or exists (select 1 from public.ubicaciones where pais = 'CL') then
    raise exception 'Hay clientes o ubicaciones en Chile (CL). Cámbielos o desactívelos antes de revertir.';
  end if;
end $$;

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
  $a$if destino.pais <> 'BO' and a.etapa = 'en_ruta' then$a$,
  $a$if destino.pais = 'PE' and a.etapa = 'en_ruta' then$a$);
select pg_temp.cambiar_en_funcion('public.trg_documentos_carga()'::regprocedure,
  $a$where m.id = new.mision_id and u.pais <> 'BO') then$a$,
  $a$where m.id = new.mision_id and u.pais = 'PE') then$a$);
select pg_temp.cambiar_en_funcion('public.trg_documentos_salida()'::regprocedure,
  $a$where m.id = new.mision_id and d.pais <> 'BO') then$a$,
  $a$where m.id = new.mision_id and d.pais = 'PE') then$a$);
select pg_temp.cambiar_en_funcion('public.reporte_entregas(date, date, uuid, text, uuid)'::regprocedure,
  $a$and (el.pais = 'BO' or coalesce('dex' = any(dc.tipos), false)),$a$,
  $a$and (el.pais <> 'PE' or coalesce('dex' = any(dc.tipos), false)),$a$);
select pg_temp.cambiar_en_funcion('public.seguimiento_publico(text)'::regprocedure,
  $a$case m.destino_pais when 'PE' then 'America/Lima' when 'CL' then 'America/Santiago' else 'America/La_Paz' end$a$,
  $a$case when m.destino_pais = 'PE' then 'America/Lima' else 'America/La_Paz' end$a$);

alter table public.clientes drop constraint clientes_pais_check;
alter table public.clientes add constraint clientes_pais_check check (pais in ('BO', 'PE'));
alter table public.ubicaciones drop constraint ubicaciones_pais_check;
alter table public.ubicaciones add constraint ubicaciones_pais_check check (pais in ('BO', 'PE'));
commit;
