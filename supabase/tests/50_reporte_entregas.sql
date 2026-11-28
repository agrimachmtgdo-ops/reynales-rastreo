-- Reporte de entregas: tiempos por tramo, espera en transbordo y frontera,
-- señal GPS, puntualidad, filtros y permisos.
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
create function pg_temp.como(usuario uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', 'authenticated')::text, false)
$$;
grant execute on function pg_temp.verificar(boolean, text), pg_temp.error_de(text), pg_temp.como(uuid) to authenticated, anon;

-- ---------- Datos ----------
insert into auth.users (email) values ('gerencia5@reynales.test') returning id as ger_id \gset
update public.usuarios set activo = true, rol = 'gerencia' where id = :'ger_id';
insert into auth.users (email) values ('operador5@elalto.test') returning id as op_id \gset
insert into auth.users (email) values ('admin5@reynales.test') returning id as admin_id \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'admin_id';
insert into public.transportistas (razon_social) values ('Tramo Dos SRL') returning id as t2 \gset
insert into public.conductores (transportista_id, nombre) values (:'t2', 'Chofer Dos') returning id as c2 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t2', '2222BBB') returning id as v2 \gset
select pg_temp.como(:'admin_id');
set role authenticated;
select public.registrar_operador('operador5@elalto.test', 'Op Cinco', :'t2') \g /dev/null
reset role;
select t.id as t1, c.id as c1, v.id as v1
  from public.transportistas t join public.conductores c on c.transportista_id = t.id
  join public.vehiculos v on v.transportista_id = t.id
 where t.razon_social = 'Transportes de prueba' limit 1 \gset

-- A: Perú con transbordo, entregada hace 2 horas.
insert into public.misiones (cliente_id, origen_id, destino_id, factura)
select (select id from public.clientes limit 1), (select id from public.ubicaciones where tipo = 'fabrica'),
       (select id from public.ubicaciones where nombre = 'Puno'), 'REP-A'
returning id as ma \gset
insert into public.tramos (mision_id, numero, transportista_id, lugar_inicio) values (:'ma', 2, :'t2', 'El Alto');
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
values (:'ma', :'t1', :'c1', :'v1', 28) returning id as a1 \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, toneladas_declaradas, precinto)
values (:'ma', :'t2', :'c2', :'v2', 2, 28, 'P-1') returning id as a2 \gset
select public.aplicar_etapa(:'a1', 'cargado', 'chofer', now() - interval '48 hours') \g /dev/null
select public.aplicar_etapa(:'a1', 'en_ruta', 'geocerca', now() - interval '47 hours') \g /dev/null
select public.aplicar_etapa(:'a1', 'entregado', 'sistema', now() - interval '30 hours') \g /dev/null
select public.aplicar_etapa(:'a2', 'cargado', 'chofer', now() - interval '28 hours') \g /dev/null
select public.aplicar_etapa(:'a2', 'en_ruta', 'geocerca', now() - interval '26 hours') \g /dev/null
select public.aplicar_etapa(:'a2', 'en_frontera', 'geocerca', now() - interval '10 hours') \g /dev/null
select public.aplicar_etapa(:'a2', 'cruzo_frontera', 'geocerca', now() - interval '8 hours') \g /dev/null
select public.aplicar_etapa(:'a2', 'entregado', 'chofer', now() - interval '2 hours') \g /dev/null
-- Posiciones del camión 2 cada 10 min, con un corte de señal de 3 horas.
insert into public.posiciones (asignacion_id, capturado_en, punto)
select :'a2', g, extensions.st_setsrid(extensions.st_makepoint(-68.1, -16.5), 4326)::extensions.geography
  from generate_series(now() - interval '28 hours' + interval '10 minutes', now() - interval '2 hours' - interval '10 minutes', interval '10 minutes') g
 where not (g > now() - interval '20 hours' and g < now() - interval '17 hours');

-- B: Bolivia sin transbordo, entregada hace 1 hora, con 5 horas de retraso.
insert into public.misiones (cliente_id, origen_id, destino_id, factura, entrega_comprometida)
select (select id from public.clientes limit 1), (select id from public.ubicaciones where tipo = 'fabrica'),
       (select id from public.ubicaciones where nombre = 'La Paz'), 'REP-B', now() - interval '6 hours'
returning id as mb \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
values (:'mb', :'t1', :'c1', :'v1', 20) returning id as b1 \gset
insert into storage.objects (bucket_id, name) values ('documentos', :'mb' || '/f.pdf');
insert into public.documentos (mision_id, tipo, ruta_archivo) values (:'mb', 'factura', :'mb' || '/f.pdf');
select public.aplicar_etapa(:'b1', 'cargado', 'despacho', now() - interval '20 hours') \g /dev/null
select public.aplicar_etapa(:'b1', 'entregado', 'despacho', now() - interval '1 hour') \g /dev/null

-- C: todavía en ruta (no entra al reporte).
insert into public.misiones (cliente_id, origen_id, destino_id)
select (select id from public.clientes limit 1), (select id from public.ubicaciones where tipo = 'fabrica'),
       (select id from public.ubicaciones where nombre = 'La Paz')
returning id as mc \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
values (:'mc', :'t1', :'c1', :'v1', 10) returning id as c1a \gset
select public.aplicar_etapa(:'c1a', 'cargado', 'despacho', now() - interval '3 hours') \g /dev/null

-- ---------- Reporte como gerencia ----------
select pg_temp.como(:'ger_id');
set role authenticated;
select public.reporte_entregas(current_date - 3, current_date + 1)::text as rep \gset
reset role;
select set_config('e2e.rep', :'rep', false) \g /dev/null
create temp view r as select x from jsonb_array_elements(current_setting('e2e.rep')::jsonb) x;
create temp view ra as select x from r where x ->> 'codigo' = (select codigo from public.misiones where id = :'ma');
create temp view rb as select x from r where x ->> 'codigo' = (select codigo from public.misiones where id = :'mb');

select pg_temp.verificar((select count(*) from r where x ->> 'factura' like 'REP-%') = 2, 'entran las 2 misiones entregadas y no la que sigue en ruta');
select pg_temp.verificar(
  (select round(extract(epoch from ((x ->> 'entrega')::timestamptz - (x ->> 'salida')::timestamptz)) / 3600) from ra) = 46,
  'viaje total: de la salida de fábrica a la entrega en destino (46 h)');
select pg_temp.verificar((select (x ->> 'transbordo')::boolean from ra), 'marca que tuvo transbordo');
select pg_temp.verificar(
  (select round(extract(epoch from ((x ->> 'salida_transbordo')::timestamptz - (x ->> 'llegada_transbordo')::timestamptz)) / 3600) from ra) = 4,
  'espera en El Alto: de «Recibí la carga» a la salida del tramo 2 (4 h)');
select pg_temp.verificar(
  (select round(extract(epoch from ((x ->> 'cruza_frontera')::timestamptz - (x ->> 'llega_frontera')::timestamptz)) / 3600) from ra) = 2,
  'espera en frontera (2 h)');
select pg_temp.verificar((select (x ->> 'toneladas')::numeric from ra) = 28, 'toneladas: lo pesado en fábrica (no se suma el tramo 2)');
select pg_temp.verificar(
  (select (c ->> 'minutos_sin_senal')::numeric between 170 and 200
     from ra, jsonb_array_elements(x -> 'camiones') c where (c ->> 'tramo')::int = 2),
  'el corte de 3 horas de señal del camión 2 se mide');
select pg_temp.verificar(
  (select (c ->> 'minutos_sin_senal')::numeric = (c ->> 'minutos_viaje')::numeric
     from ra, jsonb_array_elements(x -> 'camiones') c where (c ->> 'tramo')::int = 1),
  'un camión sin ninguna posición cuenta todo el viaje como sin señal');
select pg_temp.verificar(
  (select (c ->> 'etapas_chofer')::int = 2 and (c ->> 'etapas_sistema')::int = 3
     from ra, jsonb_array_elements(x -> 'camiones') c where (c ->> 'tramo')::int = 2),
  'cuenta las etapas que marcó el chofer y las que detectó el sistema');
select pg_temp.verificar((select x -> 'motivos' ? 'sin_documentos_carga' and (x ->> 'incidencias')::int >= 1 from ra),
  'incluye las incidencias (salió sin factura en el sistema)');
select pg_temp.verificar((select not (x ->> 'docs_completos')::boolean from ra), 'A: documentos incompletos');
select pg_temp.verificar((select (x ->> 'docs_completos')::boolean from rb), 'B (Bolivia): con factura está completa');
select pg_temp.verificar(
  (select (x ->> 'entrega')::timestamptz - (x ->> 'entrega_comprometida')::timestamptz from rb) between interval '4 hours 59 minutes' and interval '5 hours 1 minute',
  'trae la entrega comprometida para medir el retraso (5 h)');

-- ---------- Filtros ----------
select pg_temp.como(:'ger_id');
set role authenticated;
select pg_temp.verificar(
  (select count(*) from jsonb_array_elements(public.reporte_entregas(current_date - 3, current_date + 1, null, 'PE')) x
    where x ->> 'factura' like 'REP-%') = 1,
  'filtro por país: solo Perú');
select pg_temp.verificar(
  (select count(*) from jsonb_array_elements(public.reporte_entregas(current_date - 3, current_date + 1, null, null, :'t2')) x
    where x ->> 'factura' like 'REP-%') = 1,
  'filtro por transportista: solo las misiones donde participó');
select pg_temp.verificar(
  jsonb_array_length(public.reporte_entregas(current_date - 30, current_date - 10)) = 0,
  'filtro por fecha de entrega: fuera del período no aparece');
select pg_temp.verificar(
  pg_temp.error_de('select public.reporte_entregas(current_date, current_date - 1)') like 'Elija un período válido%',
  'un período al revés se rechaza');
reset role;

-- ---------- Permisos y solo lectura ----------
select pg_temp.como(:'op_id');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de('select public.reporte_entregas(current_date - 3, current_date)') like 'Solo el personal%',
  'el operador de transbordo no ve el reporte');
reset role;
select pg_temp.verificar(not has_function_privilege('anon', 'public.reporte_entregas(date, date, uuid, text, uuid)', 'execute'),
  'un visitante sin sesión no puede llamarlo');
select pg_temp.verificar(
  (select provolatile = 's' from pg_proc where proname = 'reporte_entregas'),
  'la función es de solo lectura (stable)');
