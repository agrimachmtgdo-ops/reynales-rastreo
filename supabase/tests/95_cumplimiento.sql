-- Fase C4: cumplimiento de entregas (OTIF) y de transportistas.
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

-- ---------- Personas ----------
insert into auth.users (email) values ('admin95@reynales.test') returning id as adm \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'adm';
insert into auth.users (email) values ('log95@reynales.test') returning id as log \gset
update public.usuarios set activo = true, rol = 'despacho' where id = :'log';
insert into auth.users (email) values ('ger95@reynales.test') returning id as ger \gset
update public.usuarios set activo = true, rol = 'gerencia' where id = :'ger';
insert into auth.users (email) values ('com95@reynales.test') returning id as com \gset
insert into auth.users (email) values ('otro95@reynales.test') returning id as com2 \gset
select pg_temp.como(:'adm');
set role authenticated;
select public.registrar_personal('com95@reynales.test', 'Comercial 95', 'comercial') \g /dev/null
select public.registrar_personal('otro95@reynales.test', 'Otro comercial 95', 'comercial') \g /dev/null
reset role;

select (now() at time zone 'America/La_Paz')::date as hoy \gset
insert into public.clientes (razon_social, pais, comercial_id) values ('Cliente 95 Propio', 'PE', :'com') returning id as cli1 \gset
insert into public.clientes (razon_social, pais, comercial_id) values ('Cliente 95 Ajeno', 'BO', :'com2') returning id as cli2 \gset
select id as puno from public.ubicaciones where nombre = 'Puno' \gset
select id as fab from public.ubicaciones where tipo = 'fabrica' order by nombre limit 1 \gset
insert into public.transportistas (razon_social) values ('Trans 95 A') returning id as t1 \gset
insert into public.transportistas (razon_social) values ('Trans 95 B') returning id as t2 \gset
insert into public.conductores (transportista_id, nombre, ci, telefono) values (:'t1', 'Chofer 95', '9501', '+59170009501') returning id as c1 \gset
insert into public.conductores (transportista_id, nombre, ci, telefono) values (:'t2', 'Chofer 96', '9502', '+59170009502') returning id as c2 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t1', '9501AAA') returning id as v1 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t2', '9502AAA') returning id as v2 \gset

-- ---------- Pedido A (CPT, hito entrega): 8 envíos de 29 t ----------
select pg_temp.como(:'com');
set role authenticated;
select public.guardar_pedido(null, jsonb_build_object('cliente_id', :'cli1', 'orden_compra', 'OC-95', 'producto', 'Maní',
  'toneladas', 232, 'entrega_hasta', (:'hoy'::date + 60)::text, 'destino_id', :'puno', 'incoterm', 'CPT')) as pa \gset
select public.guardar_programa(:'pa', (select jsonb_agg(jsonb_build_object('toneladas', 29, 'entrega', (:'hoy'::date + 30)::text)) from generate_series(1, 8))) \g /dev/null
select public.confirmar_pedido(:'pa');
select public.confirmar_programa(:'pa') \g /dev/null
reset role;
-- Fechas comprometidas en el pasado (o futuro) para cada caso.
update public.programa_envios set entrega_comprometida = :'hoy'::date - (case numero when 1 then 10 when 2 then 9 when 3 then 8
    when 4 then 7 when 5 then 3 when 6 then 6 when 7 then 5 else -5 end),
  entrega_vigente = :'hoy'::date - (case numero when 1 then 10 when 2 then 9 when 3 then 8
    when 4 then 7 when 5 then 3 when 6 then 6 when 7 then 5 else -5 end)
 where pedido_id = :'pa';
select id as e1 from public.programa_envios where pedido_id = :'pa' and numero = 1 \gset
select id as e2 from public.programa_envios where pedido_id = :'pa' and numero = 2 \gset
select id as e3 from public.programa_envios where pedido_id = :'pa' and numero = 3 \gset
select id as e4 from public.programa_envios where pedido_id = :'pa' and numero = 4 \gset
select id as e5 from public.programa_envios where pedido_id = :'pa' and numero = 5 \gset
select id as e6 from public.programa_envios where pedido_id = :'pa' and numero = 6 \gset
select id as e7 from public.programa_envios where pedido_id = :'pa' and numero = 7 \gset
select id as e8 from public.programa_envios where pedido_id = :'pa' and numero = 8 \gset

-- E2: logística la mueve 2 días por transporte (no mueve el compromiso).
-- E3: el cliente pide 2 días más y 25 t (sí mueve el compromiso).
-- E6: cancelado por producción. E7: cancelado por el cliente.
select pg_temp.como(:'log');
set role authenticated;
select public.reprogramar_envio(:'e2', (:'hoy'::date - 7), 29, 'transporte', null);
select public.reprogramar_envio(:'e3', (:'hoy'::date - 6), 25, 'cliente', null);
select public.cancelar_envio(:'e6', 'produccion', null);
select public.cancelar_envio(:'e7', 'cliente', null);
reset role;

-- Despacho: misión con un camión por envío; entrega en la hora indicada.
create function pg_temp.despachar(p_envio uuid, p_cliente uuid, p_destino uuid, p_origen uuid, p_trans uuid, p_cond uuid,
                                  p_veh uuid, p_ton numeric, p_sale timestamptz, p_llega timestamptz) returns uuid
language plpgsql as $$
declare m uuid; a uuid;
begin
  insert into public.misiones (cliente_id, origen_id, destino_id, envio_id) values (p_cliente, p_origen, p_destino, p_envio) returning id into m;
  insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
  values (m, p_trans, p_cond, p_veh, p_ton) returning id into a;
  perform public.aplicar_etapa(a, 'cargado', 'chofer', p_sale - interval '1 hour');
  perform public.aplicar_etapa(a, 'en_ruta', 'geocerca', p_sale);
  if p_llega is not null then perform public.aplicar_etapa(a, 'entregado', 'chofer', p_llega); end if;
  return m;
end $$;
-- E1 a tiempo y completo; E2 entregado 2 días tarde (sobre su compromiso); E3 a tiempo según el
-- compromiso movido por el cliente, con 25 t; E4 a tiempo pero con 25 t de 29 (incompleto).
select pg_temp.despachar(:'e1', :'cli1', :'puno', :'fab', :'t1', :'c1', :'v1', 29, ((:'hoy'::date - 12) + time '08:00') at time zone 'America/La_Paz', ((:'hoy'::date - 10) + time '15:00') at time zone 'America/La_Paz') \g /dev/null
select pg_temp.despachar(:'e2', :'cli1', :'puno', :'fab', :'t1', :'c1', :'v1', 29.5, ((:'hoy'::date - 9) + time '08:00') at time zone 'America/La_Paz', ((:'hoy'::date - 7) + time '15:00') at time zone 'America/La_Paz') \g /dev/null
select pg_temp.despachar(:'e3', :'cli1', :'puno', :'fab', :'t1', :'c1', :'v1', 25.2, ((:'hoy'::date - 8) + time '08:00') at time zone 'America/La_Paz', ((:'hoy'::date - 6) + time '15:00') at time zone 'America/La_Paz') \g /dev/null
select pg_temp.despachar(:'e4', :'cli1', :'puno', :'fab', :'t1', :'c1', :'v1', 25, ((:'hoy'::date - 9) + time '08:00') at time zone 'America/La_Paz', ((:'hoy'::date - 7) + time '15:00') at time zone 'America/La_Paz') \g /dev/null

-- ---------- Pedido B (FCA, hito carga) del otro comercial ----------
select pg_temp.como(:'com2');
set role authenticated;
select public.guardar_pedido(null, jsonb_build_object('cliente_id', :'cli2', 'orden_compra', 'OC-96', 'producto', 'Maní',
  'toneladas', 29, 'entrega_hasta', (:'hoy'::date + 60)::text, 'destino_id', :'puno', 'incoterm', 'FCA', 'hito', 'carga')) as pb \gset
select public.guardar_programa(:'pb', jsonb_build_array(jsonb_build_object('toneladas', 29, 'entrega', (:'hoy'::date + 30)::text))) \g /dev/null
select public.confirmar_pedido(:'pb');
select public.confirmar_programa(:'pb') \g /dev/null
reset role;
update public.programa_envios set entrega_comprometida = :'hoy'::date - 4, entrega_vigente = :'hoy'::date - 4 where pedido_id = :'pb';
select id as e9 from public.programa_envios where pedido_id = :'pb' \gset
-- Sale de fábrica el día comprometido; todavía no llega (el hito es la carga).
select pg_temp.despachar(:'e9', :'cli2', :'puno', :'fab', :'t2', :'c2', :'v2', 28.8, ((:'hoy'::date - 4) + time '10:00') at time zone 'America/La_Paz', null) \g /dev/null

-- ---------- Reporte como gerencia ----------
select pg_temp.como(:'ger');
set role authenticated;
select public.reporte_cumplimiento(:'hoy'::date - 30, :'hoy'::date + 30) as rep \gset
reset role;
create temp table filas as
  select (x ->> 'numero')::int as numero, x ->> 'pedido_codigo' as pedido, x ->> 'medicion' as medicion,
         (x ->> 'a_tiempo')::boolean as a_tiempo, (x ->> 'completo')::boolean as completo, (x ->> 'otif')::boolean as otif,
         (x ->> 'dias_atraso')::int as atraso, x ->> 'causa' as causa, (x ->> 'toneladas_comprometidas')::numeric as tcomp,
         (x ->> 'envio_id')::uuid as envio_id
    from jsonb_array_elements((:'rep'::jsonb) -> 'envios') x;

select pg_temp.verificar((select count(*) from filas) = 7,
  'se miden 7 envíos: sin el cancelado por el cliente ni el que aún no vence');
select pg_temp.verificar(not exists (select 1 from filas where envio_id in (:'e7', :'e8')),
  'el cancelado por el cliente y el futuro no se miden');
select pg_temp.verificar((select medicion = 'medido' and a_tiempo and completo and otif and atraso = 0 from filas where envio_id = :'e1'),
  'E1: entregado a tiempo y completo = OTIF');
select pg_temp.verificar((select a_tiempo = false and completo and otif = false and atraso = 2 and causa = 'transporte' from filas where envio_id = :'e2'),
  'E2: atraso propio de 2 días, con su causa, no es OTIF');
select pg_temp.verificar((select a_tiempo and completo and otif and tcomp = 25 from filas where envio_id = :'e3'),
  'E3: el cambio del cliente mueve fecha y toneladas comprometidas, y cumple');
select pg_temp.verificar((select a_tiempo and completo = false and otif = false from filas where envio_id = :'e4'),
  'E4: 25 t de 29 está fuera del ±3 %: no es completo');
select pg_temp.verificar((select medicion = 'vencido' and a_tiempo = false and otif = false and atraso = 3 from filas where envio_id = :'e5'),
  'E5: vencido sin entregar cuenta como no a tiempo, con días de atraso');
select pg_temp.verificar((select medicion = 'cancelado' and otif = false and causa = 'produccion' from filas where envio_id = :'e6'),
  'E6: cancelado por producción cuenta como falla');
select pg_temp.verificar((select medicion = 'medido' and a_tiempo and completo and otif from filas where envio_id = :'e9'),
  'E9 (FCA, hito carga): se mide por la salida de fábrica, aunque no haya llegado');
select pg_temp.verificar(((:'rep'::jsonb) -> 'ajustes' ->> 'tolerancia_pct')::numeric = 3
  and ((:'rep'::jsonb) -> 'ajustes' ->> 'meta_pct')::numeric = 95, 'el reporte trae los ajustes vigentes');

-- Filtros
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar(jsonb_array_length(public.reporte_cumplimiento(:'hoy'::date - 30, :'hoy'::date + 30, :'cli2') -> 'envios') = 1,
  'filtra por cliente');
select pg_temp.verificar(jsonb_array_length(public.reporte_cumplimiento(:'hoy'::date - 30, :'hoy'::date + 30, null, 'FCA') -> 'envios') = 1,
  'filtra por Incoterm');
select pg_temp.verificar(jsonb_array_length(public.reporte_cumplimiento(:'hoy'::date - 9, :'hoy'::date - 7) -> 'envios') = 2,
  'filtra por fecha comprometida');
select pg_temp.verificar(pg_temp.error_de(format('select public.reporte_cumplimiento(%L, %L)', :'hoy', (:'hoy'::date - 1)::text)) like 'Elija un período%',
  'rechaza un período inválido');
reset role;

-- Tolerancia de un día: E2 sigue tarde (2 días); con 2 días pasaría a tiempo.
update public.configuracion set valor = '2' where clave = 'otif_tolerancia_dias';
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar(
  (select (x ->> 'a_tiempo')::boolean from jsonb_array_elements(public.reporte_cumplimiento(:'hoy'::date - 30, :'hoy'::date + 30) -> 'envios') x
    where (x ->> 'envio_id')::uuid = :'e2'),
  'la tolerancia de días se aplica');
reset role;
update public.configuracion set valor = '0' where clave = 'otif_tolerancia_dias';

-- ---------- Permisos ----------
select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  (select bool_and(x ->> 'cliente' = 'Cliente 95 Propio') and count(*) = 6
     from jsonb_array_elements(public.reporte_cumplimiento(:'hoy'::date - 30, :'hoy'::date + 30) -> 'envios') x),
  'el comercial ve solo los envíos de sus clientes');
select pg_temp.verificar(pg_temp.error_de(format('select public.reporte_transportistas(%L, %L)', (:'hoy'::date - 30)::text, :'hoy'))
  like 'Solo administración, gerencia y logística%', 'el comercial no ve el cumplimiento de transportistas');
select pg_temp.verificar(pg_temp.error_de('select public.fijar_ajustes_cumplimiento(1, 3, 95, 60)') like 'Solo el administrador%',
  'solo el administrador cambia los ajustes');
reset role;
select pg_temp.como(:'adm');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de('select public.fijar_ajustes_cumplimiento(0, 30, 95, 60)') like 'La tolerancia de toneladas%',
  'los ajustes tienen rangos válidos');
select public.fijar_ajustes_cumplimiento(1, 5, 90, 30);
select pg_temp.verificar(public.ajustes_cumplimiento() = '{"tolerancia_dias": 1, "tolerancia_pct": 5, "meta_pct": 90, "tolerancia_min": 30}'::jsonb,
  'el administrador cambia los ajustes');
select public.fijar_ajustes_cumplimiento(0, 3, 95, 60);
reset role;
set role anon;
select pg_temp.verificar(pg_temp.error_de(format('select public.reporte_cumplimiento(%L, %L)', (:'hoy'::date - 30)::text, :'hoy'))
  like 'permission denied%', 'el público no ejecuta el reporte');
reset role;

-- ---------- Transportistas ----------
-- E8 (futuro) con pedidos de camiones: Trans A confirma 2 de 3, Trans B rechaza 1.
update public.programa_envios set fecha_carga_planificada = :'hoy'::date + 2, presentacion = ((:'hoy'::date + 2) + time '07:00') at time zone 'America/La_Paz'
 where id = :'e8';
select pg_temp.como(:'log');
set role authenticated;
select public.pedir_camiones(:'e8', :'t1', 3) as s1 \gset
select public.pedir_camiones(:'e8', :'t2', 1) as s2 \gset
select public.responder_solicitud(:'s1', 2);
select public.responder_solicitud(:'s2', 0);
select public.crear_mision_envio(:'e8', :'fab') \g /dev/null
reset role;
insert into public.conductores (transportista_id, nombre, ci, telefono) values (:'t1', 'Chofer 97', '9503', '+59170009503') returning id as c3 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t1', '9503AAA') returning id as v3 \gset
select pg_temp.como(:'log');
set role authenticated;
select public.agregar_camion_solicitud(:'s1', :'c1', :'v1') \g /dev/null
select public.agregar_camion_solicitud(:'s1', :'c3', :'v3') \g /dev/null
reset role;
select id as a1 from public.asignaciones where solicitud_id = :'s1' and vehiculo_id = :'v1' \gset
select id as a2 from public.asignaciones where solicitud_id = :'s1' and vehiculo_id = :'v3' \gset
-- Un camión llega 90 min después de la presentación (tarde con 60 min de tolerancia); el otro no se presenta.
update public.solicitudes_camiones set presentacion = now() - interval '3 hours' where id = :'s1';
select pg_temp.como(:'log');
set role authenticated;
select public.registrar_llegada(:'a1', now() - interval '90 minutes');
select public.registrar_ausencia(:'a2', 'Avería');
select public.reporte_transportistas(:'hoy'::date - 30, :'hoy'::date + 30) as rt \gset
reset role;
create temp table trans as
  select x ->> 'transportista' as nombre, (x ->> 'pedidos')::int as pedidos, (x ->> 'respondidos')::int as respondidos,
         (x ->> 'confirmados')::int as confirmados, (x ->> 'asignados')::int as asignados, (x ->> 'llegaron')::int as llegaron,
         (x ->> 'ausencias')::int as ausencias, (x ->> 'con_hora')::int as con_hora, (x ->> 'puntuales')::int as puntuales,
         x -> 'detalle_ausencias' as detalle
    from jsonb_array_elements((:'rt'::jsonb) -> 'transportistas') x;
select pg_temp.verificar((select pedidos = 3 and respondidos = 3 and confirmados = 2 from trans where nombre = 'Trans 95 A'),
  'Trans A: confirmó 2 de 3 camiones pedidos');
select pg_temp.verificar((select pedidos = 1 and confirmados = 0 and asignados = 0 from trans where nombre = 'Trans 95 B'),
  'Trans B: rechazó su único camión');
select pg_temp.verificar((select asignados = 2 and llegaron = 1 and ausencias = 1 from trans where nombre = 'Trans 95 A'),
  'Trans A: un camión llegó y otro no se presentó');
select pg_temp.verificar((select con_hora = 1 and puntuales = 0 from trans where nombre = 'Trans 95 A'),
  'llegar 90 min tarde no es puntual con 60 min de tolerancia');
select pg_temp.verificar((select detalle -> 0 ->> 'causa' = 'Avería' and detalle -> 0 ->> 'placa' = '9503AAA' from trans where nombre = 'Trans 95 A'),
  'la ausencia trae placa y causa');
update public.configuracion set valor = '120' where clave = 'puntualidad_tolerancia_min';
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar(
  (select (x ->> 'puntuales')::int = 1 from jsonb_array_elements(public.reporte_transportistas(:'hoy'::date - 30, :'hoy'::date + 30) -> 'transportistas') x
    where x ->> 'transportista' = 'Trans 95 A'),
  'gerencia ve transportistas y la tolerancia de llegada se aplica');
reset role;
update public.configuracion set valor = '60' where clave = 'puntualidad_tolerancia_min';

\echo '✔ cumplimiento: todas las pruebas pasaron'
