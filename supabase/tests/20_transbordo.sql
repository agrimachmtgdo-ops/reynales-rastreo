-- Transbordo: 2 camiones llevan la carga de fábrica a El Alto y otros 2 la llevan a Perú.
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
create function pg_temp.punto(lat double precision, lon double precision) returns extensions.geography
language sql as $$ select extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography $$;
-- ¿Falla la instrucción? Devuelve el mensaje de error (o null si no falla).
create function pg_temp.error_de(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on function pg_temp.verificar(boolean, text), pg_temp.error_de(text) to authenticated, anon;

insert into auth.users (email) values ('despacho2@reynales.test') returning id as despacho_id \gset
update public.usuarios set activo = true, rol = 'despacho' where id = :'despacho_id';
select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id', 'role', 'authenticated')::text, false) \g /dev/null
set role authenticated;

-- ---------- Catálogos del segundo transportista ----------
insert into public.transportistas (razon_social, telefono) values ('Transbordos El Alto', '+59172000000') returning id as t2 \gset
insert into public.conductores (transportista_id, nombre, telefono) values (:'t2', 'Chofer C', '+59172000001') returning id as cond_c \gset
insert into public.conductores (transportista_id, nombre, telefono) values (:'t2', 'Chofer D', '+59172000002') returning id as cond_d \gset
insert into public.vehiculos (transportista_id, placa) values (:'t2', '2222CCC') returning id as veh_c \gset
insert into public.vehiculos (transportista_id, placa) values (:'t2', '3333DDD') returning id as veh_d \gset

-- ---------- Misión con transbordo ----------
insert into public.misiones (cliente_id, origen_id, destino_id, factura, tonelaje_objetivo)
select (select id from public.clientes limit 1),
       (select id from public.ubicaciones where tipo = 'fabrica'),
       (select id from public.ubicaciones where nombre = 'Puno'),
       'F-TRB', 29
returning id as mision_id \gset

select pg_temp.verificar(
  pg_temp.error_de(format('insert into public.tramos (mision_id, numero) values (%L, 3)', :'mision_id')) like 'Los tramos se agregan en orden%',
  'los tramos se agregan en orden (no se puede crear el 3 antes del 2)');
insert into public.tramos (mision_id, numero, transportista_id, lugar_inicio)
values (:'mision_id', 2, :'t2', 'El Alto, Senkata');
select pg_temp.verificar(public.ultimo_tramo(:'mision_id') = 2, 'la misión tiene 2 tramos');

-- Tramo 1: un camión se divide... aquí dos camiones de fábrica (15 + 14 TN = 29 TN).
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
select :'mision_id', t.id, c.id, v.id, 15
  from public.transportistas t join public.conductores c on c.transportista_id = t.id
  join public.vehiculos v on v.transportista_id = t.id
 where t.razon_social = 'Transportes de prueba' limit 1
returning id as asig_a \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
select :'mision_id', transportista_id, conductor_id, vehiculo_id, 14 from public.asignaciones where id = :'asig_a'
returning id as asig_b \gset

-- Tramo 2: dos camiones con toneladas declaradas.
select pg_temp.verificar(
  pg_temp.error_de(format('insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, toneladas_cargadas) values (%L, %L, %L, %L, 2, 20)',
    :'mision_id', :'t2', :'cond_c', :'veh_c')) like 'En el tramo 2 anote las toneladas declaradas%',
  'en el tramo 2 no se registra peso de balanza, solo toneladas declaradas');
select pg_temp.verificar(
  pg_temp.error_de(format('update public.asignaciones set toneladas_declaradas = 1 where id = %L', :'asig_a')) like 'Las toneladas declaradas son solo%',
  'el tramo 1 no lleva toneladas declaradas');
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, toneladas_declaradas)
values (:'mision_id', :'t2', :'cond_c', :'veh_c', 2, 20) returning id as asig_c \gset
select pg_temp.verificar(
  pg_temp.error_de(format('insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, toneladas_declaradas) values (%L, %L, %L, %L, 2, 9.2)',
    :'mision_id', :'t2', :'cond_d', :'veh_d')) like '%superan en más de 0,5 % las 29.00 TN pesadas en fábrica%',
  'las toneladas declaradas no pueden superar en más de 0,5 % las pesadas (20 + 9,2 > 29 × 1,005)');
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, toneladas_declaradas)
values (:'mision_id', :'t2', :'cond_d', :'veh_d', 2, 9) returning id as asig_d \gset
select pg_temp.verificar(
  pg_temp.error_de(format('insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo) values (%L, %L, %L, %L, 3)',
    :'mision_id', :'t2', :'cond_d', :'veh_d')) like 'La misión no tiene tramo 3%',
  'no se puede asignar un camión a un tramo que no existe');
reset role;

-- ---------- Tramo 1 en viaje ----------
select public.aplicar_etapa(:'asig_a', 'cargado', 'despacho', now() - interval '5 hours') \g /dev/null
select pg_temp.verificar((select etapa = 'programado' from public.misiones where id = :'mision_id'),
  'con un camión de fábrica aún sin cargar, la misión sigue «Programado» (como antes)');
select public.aplicar_etapa(:'asig_b', 'cargado', 'despacho', now() - interval '5 hours') \g /dev/null
select public.aplicar_etapa(:'asig_a', 'en_ruta', 'despacho', now() - interval '4 hours') \g /dev/null
select public.aplicar_etapa(:'asig_b', 'en_ruta', 'despacho', now() - interval '4 hours') \g /dev/null
select pg_temp.verificar((select etapa = 'en_ruta' from public.misiones where id = :'mision_id'), 'tramo 1 en ruta: misión «En ruta»');

-- El chofer A ve como destino el transbordo (sin frontera); el chofer C, el destino final.
select pg_temp.verificar(
  (select r ->> 'destino' = 'Transbordo: El Alto, Senkata' and (r ->> 'transbordo')::boolean and r ->> 'destino_pais' = 'BO'
     from public.resumen_viaje(:'asig_a') r),
  'la app del tramo 1 muestra como destino el transbordo y no ofrece «frontera»');
select pg_temp.verificar(
  (select r ->> 'origen' = 'El Alto, Senkata' and not (r ->> 'transbordo')::boolean and r ->> 'destino' like 'Puno%' and r ->> 'destino_pais' = 'PE'
     from public.resumen_viaje(:'asig_c') r),
  'la app del tramo 2 sale del transbordo hacia el destino final');

-- A llega a El Alto (posición de hace 30 min) y entrega en transbordo.
insert into public.posiciones (asignacion_id, capturado_en, punto)
values (:'asig_a', now() - interval '30 minutes', pg_temp.punto(-16.5410, -68.2050)),
       (:'asig_b', now() - interval '30 minutes', pg_temp.punto(-16.5420, -68.2060));
update public.asignaciones set ultima_lat = -16.5410, ultima_lon = -68.2050, ultima_senal = now() - interval '30 minutes' where id = :'asig_a';
select public.aplicar_etapa(:'asig_a', 'entregado', 'despacho', now() - interval '20 minutes') \g /dev/null
select pg_temp.verificar((select punto_inicio is not null from public.tramos where mision_id = :'mision_id' and numero = 2),
  'al entregar en transbordo se guarda el punto de inicio del tramo 2');
select public.aplicar_etapa(:'asig_b', 'entregado', 'despacho', now() - interval '19 minutes') \g /dev/null
select pg_temp.verificar((select etapa = 'en_ruta' from public.misiones where id = :'mision_id'),
  'con todo el tramo 1 entregado en transbordo la misión sigue «En ruta» (no «Entregado»)');

-- ---------- Lo que ve el cliente durante el transbordo ----------
select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id', 'role', 'authenticated')::text, false) \g /dev/null
set role authenticated;
select public.crear_enlace_seguimiento(:'mision_id') as token \gset
reset role;
set role anon;
select public.seguimiento_publico(:'token') as seg \gset
reset role;
select pg_temp.verificar(
  jsonb_array_length(:'seg'::jsonb -> 'camiones') = 2
  and (select bool_and(c ->> 'etapa' = 'en_ruta' and (c ->> 'espera')::boolean and (c ->> 'parado')::boolean and c ->> 'nombre' like 'Camión %')
         from jsonb_array_elements(:'seg'::jsonb -> 'camiones') c),
  'el cliente ve los camiones en espera como «En ruta» y detenidos, sin placa');
select pg_temp.verificar(
  not exists (select 1 from jsonb_array_elements(:'seg'::jsonb -> 'hitos') h where h ->> 'etapa' = 'entregado')
  and position('ransbordo' in :'seg') = 0 and position('Senkata' in :'seg') = 0,
  'el cliente no ve la entrega en transbordo ni la palabra transbordo');
select pg_temp.verificar((:'seg'::jsonb ->> 'toneladas_fabrica')::numeric = 29, 'el cliente ve las 29 TN pesadas en fábrica');

-- ---------- Tramo 2 ----------
select public.aplicar_etapa(:'asig_c', 'cargado', 'despacho', now() - interval '10 minutes') \g /dev/null
select pg_temp.verificar((select etapa = 'en_ruta' from public.misiones where id = :'mision_id'),
  'cuando el tramo 2 empieza a cargar, la misión no vuelve atrás de «En ruta»');
set role anon;
select public.seguimiento_publico(:'token') as seg \gset
reset role;
select pg_temp.verificar(
  jsonb_array_length(:'seg'::jsonb -> 'camiones') = 2
  and exists (select 1 from jsonb_array_elements(:'seg'::jsonb -> 'camiones') c where c ->> 'etapa' = 'cargado' and (c ->> 'toneladas')::numeric = 20)
  and (:'seg'::jsonb ->> 'toneladas_fabrica')::numeric = 29,
  'al salir el tramo 2 el cliente ve solo sus camiones y el total de fábrica sin duplicar');

-- D sale con 8 TN declaradas: faltan 1 TN (3,4 %) → alerta para despacho.
update public.asignaciones set toneladas_declaradas = 8 where id = :'asig_d';
select pg_temp.verificar(not exists (select 1 from public.eventos where detalle ->> 'motivo' = 'diferencia_peso_transbordo'),
  'sin alerta de peso mientras falta cargar un camión del tramo');
select public.aplicar_etapa(:'asig_d', 'cargado', 'despacho', now() - interval '9 minutes') \g /dev/null
select pg_temp.verificar(
  (select count(*) = 1 from public.eventos where detalle ->> 'motivo' = 'diferencia_peso_transbordo'
      and (detalle ->> 'fabrica')::numeric = 29 and (detalle ->> 'declaradas')::numeric = 28),
  'si el tramo 2 sale con más de 0,5 % de diferencia de peso se registra una alerta');

-- Geocercas del tramo 2: el origen es el punto de transbordo, no la fábrica.
select pg_temp.verificar(public.evaluar_geocercas(:'asig_c', pg_temp.punto(-16.5415, -68.2055), now() - interval '8 minutes', 10) = 'cargado',
  'en el punto de transbordo el camión del tramo 2 sigue «Cargado»');
select pg_temp.verificar(not exists (select 1 from public.eventos where asignacion_id = :'asig_c' and detalle ->> 'motivo' = 'inicio_lejos_de_origen'),
  'el tramo 2 no da la alerta de «inicio lejos de la fábrica»');
insert into public.posiciones (asignacion_id, capturado_en, punto) values (:'asig_c', now() - interval '8 minutes', pg_temp.punto(-16.5415, -68.2055));
select public.evaluar_geocercas(:'asig_c', pg_temp.punto(-16.60, -68.60), now() - interval '6 minutes', 10) \g /dev/null
select pg_temp.verificar(public.evaluar_geocercas(:'asig_c', pg_temp.punto(-16.61, -68.65), now() - interval '5 minutes', 10) = 'en_ruta',
  'al alejarse del transbordo (2 puntos) el tramo 2 pasa a «En ruta»');

-- Entrega final.
select public.aplicar_etapa(:'asig_c', 'entregado', 'despacho') \g /dev/null
select pg_temp.verificar((select etapa = 'en_ruta' from public.misiones where id = :'mision_id'),
  'con un camión del tramo final aún en viaje, la misión sigue «En ruta»');
select public.aplicar_etapa(:'asig_d', 'entregado', 'despacho') \g /dev/null
select pg_temp.verificar((select etapa = 'entregado' from public.misiones where id = :'mision_id'),
  'la misión se entrega cuando entrega el último tramo');
set role anon;
select public.seguimiento_publico(:'token') as seg \gset
reset role;
select pg_temp.verificar(
  exists (select 1 from jsonb_array_elements(:'seg'::jsonb -> 'hitos') h where h ->> 'etapa' = 'entregado')
  and (select bool_and(c ->> 'etapa' = 'entregado') from jsonb_array_elements(:'seg'::jsonb -> 'camiones') c),
  'el cliente ve la entrega final');

-- ---------- Reglas al agregar tramos ----------
select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id', 'role', 'authenticated')::text, false) \g /dev/null
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('insert into public.tramos (mision_id, numero) values (%L, 3)', :'mision_id')) like 'La misión ya está cerrada%',
  'no se agrega un transbordo a una misión entregada');
select pg_temp.verificar(
  pg_temp.error_de(format('delete from public.tramos where mision_id = %L', :'mision_id')) like 'No se puede quitar el tramo 2%',
  'no se puede quitar un tramo que tiene camiones');
reset role;
