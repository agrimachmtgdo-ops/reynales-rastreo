-- Fase C0: Chile como destino. País CL aceptado y reglas de «destino fuera de Bolivia».
\set QUIET on
\pset tuples_only on
\pset format unaligned

create function pg_temp.verificar(condicion boolean, mensaje text) returns void language plpgsql as $$
begin
  if not coalesce(condicion, false) then
    raise exception 'FALLÓ: %', mensaje;
  end if;
  raise notice 'ok - %', mensaje;
end $$;
create function pg_temp.error_de(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.def(f regprocedure) returns text language sql as $$ select pg_get_functiondef(f) $$;

-- ---------- Países ----------
insert into public.clientes (razon_social, pais) values ('Importadora Arica SpA', 'CL') returning id as cli_cl \gset
insert into public.ubicaciones (nombre, ciudad, pais, tipo, lat, lon, radio_m)
values ('Puerto de Arica', 'Arica', 'CL', 'destino', -18.4747, -70.3197, 2000) returning id as arica \gset
insert into public.ubicaciones (nombre, ciudad, pais, tipo, lat, lon, radio_m)
values ('Paso fronterizo Tambo Quemado', 'Tambo Quemado', 'BO', 'frontera', -18.2947, -69.0469, 1500);
select pg_temp.verificar((select pais from public.clientes where id = :'cli_cl') = 'CL', 'se puede registrar un cliente de Chile');
select pg_temp.verificar((select pais from public.ubicaciones where id = :'arica') = 'CL', 'se puede registrar un destino en Chile');
select pg_temp.verificar(
  pg_temp.error_de($$insert into public.clientes (razon_social, pais) values ('X', 'AR')$$) is not null,
  'un país no previsto sigue rechazado');

-- ---------- DEX obligatorio al salir de fábrica hacia Chile ----------
select t.id as t1, c.id as c1, v.id as v1
  from public.transportistas t join public.conductores c on c.transportista_id = t.id
  join public.vehiculos v on v.transportista_id = t.id
 where t.razon_social = 'Transportes de prueba' limit 1 \gset
insert into public.misiones (cliente_id, origen_id, destino_id, factura)
values (:'cli_cl', (select id from public.ubicaciones where tipo = 'fabrica' limit 1), :'arica', 'CL-1')
returning id as mcl \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
values (:'mcl', :'t1', :'c1', :'v1', 27) returning id as acl \gset
insert into storage.objects (bucket_id, name) values ('documentos', :'mcl' || '/f.pdf');
insert into public.documentos (mision_id, tipo, ruta_archivo) values (:'mcl', 'factura', :'mcl' || '/f.pdf');
select public.aplicar_etapa(:'acl', 'cargado', 'despacho') \g /dev/null
select pg_temp.verificar(
  exists (select 1 from public.eventos where asignacion_id = :'acl' and detalle ->> 'motivo' = 'sin_documentos_carga'
            and detalle -> 'faltan' = '["dex"]'::jsonb),
  'a Chile también se exige el DEX al salir de fábrica');

-- ---------- Las reglas quedaron como «fuera de Bolivia» ----------
select pg_temp.verificar(
  pg_temp.def('public.evaluar_geocercas(uuid, extensions.geography, timestamptz, integer)') like '%destino.pais <> ''BO'' and a.etapa = ''en_ruta''%',
  'el cruce de frontera sin parada vale para cualquier destino fuera de Bolivia');
select pg_temp.verificar(
  pg_temp.def('public.trg_documentos_salida()') like '%d.pais <> ''BO''%',
  'CRT y MIC/DTA en el tramo 2 para cualquier destino fuera de Bolivia');
select pg_temp.verificar(
  pg_temp.def('public.reporte_entregas(date, date, uuid, text, uuid)') like '%el.pais = ''BO'' or%',
  'el reporte pide DEX a todo destino fuera de Bolivia');
select pg_temp.verificar(
  pg_temp.def('public.seguimiento_publico(text)') like '%when ''CL'' then ''America/Santiago''%'
  and pg_temp.def('public.seguimiento_publico(text)') like '%when ''PE'' then ''America/Lima''%',
  'el cliente en Chile ve hora de Santiago; Perú sigue con hora de Lima');
select pg_temp.verificar(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%= ''PE''%'
                 and p.proname <> 'seguimiento_publico'),
  'ninguna función sigue tratando «internacional» como «solo Perú»');
select pg_temp.verificar(
  (select prosecdef from pg_proc where proname = 'trg_documentos_carga'),
  'las funciones conservan security definer');
select pg_temp.verificar(
  not has_function_privilege('anon', 'public.reporte_entregas(date, date, uuid, text, uuid)', 'execute'),
  'los permisos de ejecución se conservan');
