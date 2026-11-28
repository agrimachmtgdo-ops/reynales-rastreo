-- Reversión de 20261219000100_requisitos_documentos.sql: quita los requisitos por cliente y destino
-- y vuelve a las alertas fijas (factura; DEX fuera de Bolivia; CRT y MIC/DTA en el transbordo).
-- Se detiene si ya hay documentos con las etiquetas nuevas (fitosanitario, análisis, etc.):
-- no se borran ni se cambian documentos.
set search_path = public, extensions;

do $$
begin
  if exists (select 1 from public.documentos where etiqueta is not null and etiqueta <> 'lista_empaque') then
    raise exception 'Hay documentos con los tipos nuevos (fitosanitario, análisis, ticket, guía firmada, booking o BL). No se puede revertir sin perderlos.';
  end if;
end $$;

create or replace function public.trg_documentos_carga()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  requeridos public.tipo_documento[] := array['factura']::public.tipo_documento[];
  faltan text[];
begin
  if coalesce(new.tramo, 1) <> 1 or old.etapa <> 'programado'
     or new.etapa not in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera') then
    return new;
  end if;
  if exists (select 1 from public.eventos e join public.asignaciones a on a.id = e.asignacion_id
              where a.mision_id = new.mision_id and e.tipo = 'incidencia'
                and e.detalle ->> 'motivo' = 'sin_documentos_carga') then
    return new;
  end if;
  if exists (select 1 from public.misiones m join public.ubicaciones u on u.id = m.destino_id
              where m.id = new.mision_id and u.pais <> 'BO') then
    requeridos := requeridos || 'dex'::public.tipo_documento;
  end if;
  select array_agg(t) into faltan
    from unnest(requeridos) t
   where not exists (select 1 from public.documentos d
                      where d.mision_id = new.mision_id and d.tipo = t and d.reemplazado_por is null);
  if faltan is not null then
    insert into public.eventos (asignacion_id, tipo, origen, detalle)
    values (new.id, 'incidencia', 'sistema',
            jsonb_build_object('motivo', 'sin_documentos_carga', 'faltan', to_jsonb(faltan)));
  end if;
  return new;
end $$;

create or replace function public.trg_documentos_salida()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  faltan text[];
begin
  if new.tramo > 1 and old.etapa in ('programado', 'cargado')
     and new.etapa in ('en_ruta', 'en_frontera', 'cruzo_frontera')
     and exists (select 1 from public.misiones m join public.ubicaciones d on d.id = m.destino_id
                  where m.id = new.mision_id and d.pais <> 'BO') then
    select array_agg(t) into faltan
      from unnest(array['crt', 'mic_dta']::public.tipo_documento[]) t
     where not exists (select 1 from public.documentos d
                        where d.mision_id = new.mision_id and d.tipo = t and d.reemplazado_por is null
                          and (d.asignacion_id = new.id or d.asignacion_id is null));
    if faltan is not null then
      insert into public.eventos (asignacion_id, tipo, origen, detalle)
      values (new.id, 'incidencia', 'sistema',
              jsonb_build_object('motivo', 'sin_documentos_transbordo', 'faltan', to_jsonb(faltan)));
    end if;
  end if;
  return new;
end $$;

drop function if exists public.guardar_requisito_general(text, text, text, boolean);
drop function if exists public.fijar_requisito_cliente(uuid, text, text);
drop function if exists public.expediente_mision(uuid);
drop function if exists public.expediente_calcular(uuid);
drop function if exists public.requisitos_de_mision(uuid);
drop table if exists public.requisitos_documentos;
drop function if exists public.documento_por_camion(text);
drop function if exists public.momento_documento(text);
drop function if exists public.clave_documento(public.tipo_documento, text);

alter table public.documentos drop constraint documentos_etiqueta_valida;
alter table public.documentos add constraint documentos_etiqueta_valida
  check (etiqueta is null or (etiqueta = 'lista_empaque' and tipo = 'otro'));
