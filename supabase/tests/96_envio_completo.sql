-- Un envío queda «cumplido» solo cuando se entregó completo (no con 1 camión de 5).
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

insert into auth.users (email) values ('log96@reynales.test') returning id as log \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'log';
select (now() at time zone 'America/La_Paz')::date as hoy \gset
insert into public.clientes (razon_social, pais) values ('Cliente 96', 'BO') returning id as cli \gset
select id as dest from public.ubicaciones where nombre = 'Puno' \gset
select id as fab from public.ubicaciones where tipo = 'fabrica' order by nombre limit 1 \gset
insert into public.transportistas (razon_social) values ('Trans 96') returning id as t1 \gset

-- Pedido de 290 t en 2 envíos de 145 t (5 camiones cada uno), confirmado.
select pg_temp.como(:'log');
set role authenticated;
select public.guardar_pedido(null, jsonb_build_object('cliente_id', :'cli', 'producto', 'Harina', 'toneladas', 290,
  'entrega_hasta', (:'hoy'::date + 60)::text, 'destino_id', :'dest', 'incoterm', 'CPT')) as ped \gset
select public.guardar_programa(:'ped', jsonb_build_array(
  jsonb_build_object('toneladas', 145, 'entrega', (:'hoy'::date + 10)::text),
  jsonb_build_object('toneladas', 145, 'entrega', (:'hoy'::date + 20)::text))) \g /dev/null
select public.confirmar_pedido(:'ped');
select public.confirmar_programa(:'ped') \g /dev/null
reset role;
select id as e1 from public.programa_envios where pedido_id = :'ped' and numero = 1 \gset
select id as e2 from public.programa_envios where pedido_id = :'ped' and numero = 2 \gset
update public.programa_envios set camiones_necesarios = 5 where pedido_id = :'ped';

-- Camiones de prueba (6 choferes y 6 camiones del mismo transportista).
insert into public.conductores (transportista_id, nombre, ci) select :'t1', 'Chofer 96-' || g, '96' || g from generate_series(1, 6) g;
insert into public.vehiculos (transportista_id, placa) select :'t1', '96' || g || 'XYZ' from generate_series(1, 6) g;
insert into public.misiones (cliente_id, origen_id, destino_id, envio_id) values (:'cli', :'fab', :'dest', :'e1') returning id as m1 \gset
insert into public.misiones (cliente_id, origen_id, destino_id, envio_id) values (:'cli', :'fab', :'dest', :'e2') returning id as m2 \gset

-- Agrega un camión a la misión y lo lleva hasta «entregado».
create function pg_temp.entregar(p_mision uuid, n int, p_ton numeric) returns uuid language plpgsql as $$
declare a uuid;
begin
  insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
  values (p_mision, (select transportista_id from public.conductores where nombre = 'Chofer 96-' || n),
          (select id from public.conductores where nombre = 'Chofer 96-' || n),
          (select id from public.vehiculos where placa = '96' || n || 'XYZ'), p_ton)
  returning id into a;
  perform public.aplicar_etapa(a, 'cargado', 'chofer', now());
  perform public.aplicar_etapa(a, 'en_ruta', 'chofer', now());
  perform public.aplicar_etapa(a, 'entregado', 'chofer', now());
  return a;
end $$;

-- ---------- El caso reportado: 1 camión entregado de 5, sin peso ----------
select pg_temp.entregar(:'m1', 1, null) \g /dev/null
select pg_temp.verificar(
  (select etapa from public.misiones where id = :'m1') = 'entregado'
  and (select estado from public.programa_envios where id = :'e1') = 'en_curso'
  and (select estado from public.pedidos where id = :'ped') = 'en_ejecucion',
  '1 camión entregado de 5: el envío sigue «en curso» (entrega parcial), no «cumplido»');
select pg_temp.verificar(not public.envio_cubierto(:'e1'), 'el envío no figura cubierto con 1 de 5 camiones');

-- Logística todavía puede pedir y cargar los camiones que faltan.
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.pedir_camiones(%L, %L, 4)', :'e1', :'t1')) is null,
  'con entrega parcial se pueden pedir los camiones que faltan');
reset role;

-- Llegan los otros 4: ahora sí queda cumplido.
select pg_temp.entregar(:'m1', g, null) from generate_series(2, 5) g \g /dev/null
select pg_temp.verificar(
  (select estado from public.programa_envios where id = :'e1') = 'cumplido',
  'con los 5 camiones entregados el envío queda «cumplido»');

-- ---------- Menos camiones pero con el peso completo ----------
select pg_temp.entregar(:'m2', 6, 70) \g /dev/null
select pg_temp.verificar(
  (select estado from public.programa_envios where id = :'e2') = 'en_curso',
  '1 camión con 70 t de 145 t: entrega parcial');
update public.asignaciones set toneladas_cargadas = 142 where mision_id = :'m2';
select pg_temp.verificar(
  (select estado from public.programa_envios where id = :'e2') = 'cumplido'
  and (select estado from public.pedidos where id = :'ped') = 'cumplido',
  'si el peso registrado cubre las toneladas (tolerancia 3 %), el envío y el pedido quedan cumplidos');
update public.asignaciones set toneladas_cargadas = 100 where mision_id = :'m2';
select pg_temp.verificar(
  (select estado from public.programa_envios where id = :'e2') = 'en_curso'
  and (select estado from public.pedidos where id = :'ped') = 'en_ejecucion',
  'si se corrige el peso a menos, el envío vuelve a «en curso»');

-- ---------- Bajar los camiones necesarios cierra el envío ----------
update public.programa_envios set camiones_necesarios = 1 where id = :'e2';
select pg_temp.verificar(
  (select estado from public.programa_envios where id = :'e2') = 'cumplido',
  'si logística baja los camiones necesarios a los que salieron, el envío queda cumplido');
