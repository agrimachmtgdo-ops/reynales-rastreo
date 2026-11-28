-- Ola 1 · Entrega 1: lotes por camión, ticket de balanza y búsqueda por lote.
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

insert into auth.users (email) values ('log98@reynales.test') returning id as log \gset
insert into auth.users (email) values ('ger98@reynales.test') returning id as ger \gset
update public.usuarios set activo = true, rol = 'despacho' where id = :'log';
update public.usuarios set activo = true, rol = 'gerencia' where id = :'ger';

insert into public.clientes (razon_social, pais) values ('Cliente 98', 'PE') returning id as cli \gset
select id as dest from public.ubicaciones where nombre = 'Puno' \gset
select id as fab from public.ubicaciones where tipo = 'fabrica' order by nombre limit 1 \gset
insert into public.productos (nombre, presentacion) values ('Harina 98', 'Sacos de 50 kg') returning id as prod \gset
insert into public.transportistas (razon_social) values ('Trans 98') returning id as t1 \gset
insert into public.conductores (transportista_id, nombre) values (:'t1', 'Chofer 98') returning id as c1 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t1', '9898ABC') returning id as v1 \gset
insert into public.misiones (cliente_id, origen_id, destino_id, producto_id, factura)
  values (:'cli', :'fab', :'dest', :'prod', 'F-98') returning id as m1 \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id)
  values (:'m1', :'t1', :'c1', :'v1') returning id as a1 \gset
insert into public.tramos (mision_id, numero, transportista_id) values (:'m1', 2, :'t1');
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, precinto)
  values (:'m1', :'t1', :'c1', :'v1', 2, 'P-1') returning id as a2 \gset

select pg_temp.verificar((select (valor #>> '{}')::numeric from public.configuracion where clave = 'lotes_tolerancia_pct') = 0.5, 'tolerancia de lotes 0,5 % por defecto');

-- Permisos: gerencia lee pero no escribe; nadie escribe la tabla directo.
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$select public.guardar_lote(%L, null, '{"lote":"L1","presentacion":"saco_50","unidades":10}'::jsonb || jsonb_build_object('producto_id', %L))$$, :'a1', :'prod')) like 'Solo el administrador o logística%', 'gerencia no registra lotes');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_balanza(%L, 'T1', null, null, 29)$$, :'a1')) is not null, 'gerencia no registra el peso');
reset role;
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$insert into public.cargas_lote (asignacion_id, producto_id, lote, presentacion, unidades, kg) values (%L, %L, 'X', 'saco_50', 1, 50)$$, :'a1', :'prod')) is not null, 'la tabla no se escribe directo (solo por funciones)');

-- Lotes: sacos calculan kg; granel exige kg; validaciones.
select public.guardar_lote(:'a1', null, jsonb_build_object('producto_id', :'prod', 'lote', ' l-2611 a ', 'presentacion', 'saco_50', 'unidades', 400, 'fecha_produccion', '2026-11-20')) as l1 \gset
select pg_temp.verificar((select lote from public.cargas_lote where id = :'l1') = 'L-2611A', 'el lote se guarda en mayúsculas y sin espacios');
select pg_temp.verificar((select kg from public.cargas_lote where id = :'l1') = 20000, '400 sacos de 50 kg = 20.000 kg');
select public.guardar_lote(:'a1', null, jsonb_build_object('producto_id', :'prod', 'lote', 'L-2612', 'presentacion', 'big_bag_1200', 'unidades', 7)) as l2 \gset
select pg_temp.verificar((select kg_lotes from public.asignaciones where id = :'a1') = 28400, 'el camión suma 28.400 kg en dos lotes');
select pg_temp.verificar(pg_temp.error_de(format($$select public.guardar_lote(%L, null, jsonb_build_object('producto_id', %L, 'lote', 'G1', 'presentacion', 'granel'))$$, :'a1', :'prod')) like 'En granel%', 'granel exige el peso');
select pg_temp.verificar(pg_temp.error_de(format($$select public.guardar_lote(%L, null, jsonb_build_object('producto_id', %L, 'lote', 'S1', 'presentacion', 'saco_40'))$$, :'a1', :'prod')) like 'Escriba cuántos%', 'sacos exigen unidades');
select pg_temp.verificar(pg_temp.error_de(format($$select public.guardar_lote(%L, null, jsonb_build_object('producto_id', %L, 'lote', 'L*1', 'presentacion', 'saco_40', 'unidades', 3))$$, :'a1', :'prod')) like 'El número de lote solo%', 'el lote rechaza caracteres raros');
select pg_temp.verificar(pg_temp.error_de(format($$select public.guardar_lote(%L, null, jsonb_build_object('producto_id', %L, 'lote', 'F1', 'presentacion', 'saco_40', 'unidades', 3, 'fecha_produccion', '2099-01-01'))$$, :'a1', :'prod')) like 'La fecha de producción%', 'la fecha de producción no puede ser futura');
select pg_temp.verificar(pg_temp.error_de(format($$select public.guardar_lote(%L, null, jsonb_build_object('producto_id', %L, 'lote', 'L-2612', 'presentacion', 'big_bag_1200', 'unidades', 1))$$, :'a1', :'prod')) like 'Ese lote ya está%', 'el mismo lote no se repite en el camión');
select pg_temp.verificar(pg_temp.error_de(format($$select public.guardar_lote(%L, null, jsonb_build_object('producto_id', %L, 'lote', 'T2', 'presentacion', 'saco_50', 'unidades', 1))$$, :'a2', :'prod')) like 'Los lotes se registran en el camión que sale de fábrica%', 'el tramo 2 no lleva lotes propios');

-- Corregir y quitar: la suma se recalcula y queda en el historial.
select public.guardar_lote(:'a1', :'l2', jsonb_build_object('producto_id', :'prod', 'lote', 'L-2612', 'presentacion', 'big_bag_1200', 'unidades', 8)) \g /dev/null
select pg_temp.verificar((select kg_lotes from public.asignaciones where id = :'a1') = 29600, 'al corregir a 8 big bags la suma es 29.600 kg');
select public.guardar_lote(:'a1', null, jsonb_build_object('producto_id', :'prod', 'lote', 'ERR', 'presentacion', 'granel', 'kg', 100)) as l3 \gset
select public.quitar_lote(:'l3');
select pg_temp.verificar((select kg_lotes from public.asignaciones where id = :'a1') = 29600, 'al quitar el lote se descuenta');
select pg_temp.verificar((select count(*) from public.eventos where asignacion_id = :'a1' and detalle ->> 'accion' in ('lote_agregado', 'lote_corregido', 'lote_quitado')) = 5, 'cada cambio de lote queda en el historial');

-- Balanza: bruto y tara dan el neto; solo neto también vale.
select public.registrar_balanza(:'a1', ' TK-555 ', 45650, 16050, null) \g /dev/null
select pg_temp.verificar((select toneladas_cargadas from public.asignaciones where id = :'a1') = 29.60, 'neto = (45.650 − 16.050) / 1000 = 29,60 t');
select pg_temp.verificar((select ticket_balanza from public.asignaciones where id = :'a1') = 'TK-555', 'se guarda el número de ticket');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_balanza(%L, null, 10000, 12000, null)$$, :'a1')) like 'El peso bruto debe%', 'bruto mayor que tara');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_balanza(%L, null, 10000, null, null)$$, :'a1')) like 'Escriba el peso bruto y la tara%', 'bruto sin tara no se acepta');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_balanza(%L, null, null, null, null)$$, :'a2')) like 'El peso de balanza es del camión%', 'el tramo 2 no tiene balanza');
reset role;
-- Un peso escrito solo como neto (como hasta hoy) sigue funcionando.
update public.asignaciones set toneladas_cargadas = 29.4 where id = :'a1';
select pg_temp.verificar((select toneladas_cargadas from public.asignaciones where id = :'a1') = 29.4, 'el neto escrito a mano se conserva');

-- Búsqueda por lote: sale del camión, la misión y el cliente.
select public.aplicar_etapa(:'a1', 'cargado', 'chofer', now()) \g /dev/null
select public.aplicar_etapa(:'a1', 'en_ruta', 'chofer', now()) \g /dev/null
select pg_temp.como(:'ger');
set role authenticated;
select public.buscar_lote('l-26') as r \gset
select pg_temp.verificar(jsonb_array_length(:'r'::jsonb) = 2, 'buscar «l-26» encuentra los dos lotes');
select pg_temp.verificar((:'r'::jsonb -> 0 ->> 'cliente') = 'Cliente 98' and (:'r'::jsonb -> 0 ->> 'placa') = '9898ABC', 'la búsqueda muestra cliente y placa');
select pg_temp.verificar((:'r'::jsonb -> 0 ->> 'salida') is not null, 'la búsqueda muestra la hora de salida');
select pg_temp.verificar(jsonb_array_length(public.buscar_lote('Z')) = 0, 'menos de 2 caracteres no busca');
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.verificar(pg_temp.error_de($$select public.buscar_lote('L-26')$$) is not null, 'un visitante sin sesión no busca lotes');
reset role;

select 'ok - 98_lotes_balanza';
