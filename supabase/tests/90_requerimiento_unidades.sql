-- Fase C3: requerimiento de unidades. Pedido de camiones por transportista con tarifa,
-- respuesta, misión del envío, camiones, llegada / ausencia, estados automáticos y permisos.
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
insert into auth.users (email) values ('admin9@reynales.test') returning id as adm \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'adm';
insert into auth.users (email) values ('log9@reynales.test') returning id as log \gset
update public.usuarios set activo = true, rol = 'despacho' where id = :'log';
insert into auth.users (email) values ('ger9@reynales.test') returning id as ger \gset
update public.usuarios set activo = true, rol = 'gerencia' where id = :'ger';
insert into auth.users (email) values ('com9@reynales.test') returning id as com \gset
select pg_temp.como(:'adm');
set role authenticated;
select public.registrar_personal('com9@reynales.test', 'Comercial Nueve', 'comercial') \g /dev/null
reset role;

insert into public.clientes (razon_social, pais, comercial_id) values ('Cliente de Nueve', 'PE', :'com') returning id as cli \gset
select id as puno from public.ubicaciones where nombre = 'Puno' \gset
select id as fab from public.ubicaciones where tipo = 'fabrica' order by nombre limit 1 \gset
insert into public.transportistas (razon_social) values ('Trans Uno') returning id as t1 \gset
insert into public.transportistas (razon_social) values ('Trans Dos') returning id as t2 \gset
insert into public.conductores (transportista_id, nombre, ci, telefono) values (:'t1', 'Chofer A', '9001', '+59170000001') returning id as c1 \gset
insert into public.conductores (transportista_id, nombre, ci, telefono) values (:'t1', 'Chofer B', '9002', '+59170000002') returning id as c2 \gset
insert into public.conductores (transportista_id, nombre, ci, telefono) values (:'t2', 'Chofer C', '9003', '+59170000003') returning id as c3 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t1', '9001AAA') returning id as v1 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t1', '9002AAA') returning id as v2 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t2', '9003AAA') returning id as v3 \gset

-- Pedido de 58 t con dos envíos de 29 t (uno de un camión cada uno… el primero pide 2).
select pg_temp.como(:'com');
set role authenticated;
select public.guardar_pedido(null, jsonb_build_object('cliente_id', :'cli', 'orden_compra', 'OC-900', 'producto', 'Maní',
  'toneladas', 58, 'entrega_hasta', '2026-12-31', 'destino_id', :'puno', 'incoterm', 'CPT')) as ped \gset
select public.guardar_programa(:'ped', '[{"toneladas": 29, "entrega": "2026-12-10", "carga": "2026-12-07"}, {"toneladas": 29, "entrega": "2026-12-17", "carga": "2026-12-14"}]'::jsonb) \g /dev/null
reset role;
select id as e1 from public.programa_envios where pedido_id = :'ped' and numero = 1 \gset
select id as e2 from public.programa_envios where pedido_id = :'ped' and numero = 2 \gset

-- ---------- Parámetro ----------
select pg_temp.verificar(public.dias_anticipacion_camiones() = 4, 'los días de anticipación empiezan en 4');
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de('select public.fijar_dias_anticipacion(5)') like 'Solo el administrador%',
  'logística no cambia los días de anticipación');
reset role;
select pg_temp.como(:'adm');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de('select public.fijar_dias_anticipacion(0)') like 'Los días de anticipación deben%',
  'los días de anticipación tienen un rango válido');
select public.fijar_dias_anticipacion(5);
reset role;
select pg_temp.verificar(public.dias_anticipacion_camiones() = 5, 'el administrador cambia los días de anticipación');

-- ---------- Pedir camiones ----------
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.pedir_camiones(%L, %L, 2)', :'e1', :'t1')) like 'El envío aún es planificado%',
  'no se piden camiones para un envío planificado');
reset role;
select pg_temp.como(:'com');
set role authenticated;
select public.confirmar_pedido(:'ped');
select public.confirmar_programa(:'ped') \g /dev/null
select pg_temp.verificar(
  pg_temp.error_de(format('select public.pedir_camiones(%L, %L, 2)', :'e1', :'t1')) like 'Solo el administrador o logística%',
  'el comercial no pide camiones');
reset role;

select pg_temp.como(:'log');
set role authenticated;
select public.guardar_requerimiento(:'e1', 2, '2026-12-07 07:00-04');
select public.pedir_camiones(:'e1', :'t1', 2, null, 1500, 'viaje', 'BOB', 'Salen temprano') as s1 \gset
select pg_temp.verificar(
  pg_temp.error_de(format('select public.pedir_camiones(%L, %L, 1)', :'e1', :'t1')) like 'Ese transportista ya tiene un pedido abierto%',
  'no se duplica el pedido abierto al mismo transportista');
select public.pedir_camiones(:'e1', :'t2', 1, '2026-12-07 09:00-04', 60, 'tonelada', 'USD') as s2 \gset
reset role;
select pg_temp.verificar(
  (select presentacion = '2026-12-07 07:00-04'::timestamptz and estado = 'pedido' and tarifa = 1500 from public.solicitudes_camiones where id = :'s1')
  and (select presentacion = '2026-12-07 09:00-04'::timestamptz from public.solicitudes_camiones where id = :'s2'),
  'la solicitud toma la hora de presentación del envío o la propia de esa línea');

-- ---------- Respuesta ----------
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.responder_solicitud(%L, 3)', :'s1')) like 'Los camiones confirmados deben estar%',
  'no se confirman más camiones de los pedidos');
select public.responder_solicitud(:'s1', 2);
select public.responder_solicitud(:'s2', 0, null, 'Sin camiones esa semana');
reset role;
select pg_temp.verificar(
  (select estado from public.solicitudes_camiones where id = :'s1') = 'confirmado'
  and (select estado from public.solicitudes_camiones where id = :'s2') = 'rechazado',
  'el transportista confirma o rechaza (0 camiones)');

-- ---------- Misión y camiones ----------
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.agregar_camion_solicitud(%L, %L, %L)', :'s1', :'c1', :'v1')) like 'Primero cree la misión%',
  'los camiones van a la misión del envío');
select public.crear_mision_envio(:'e1', :'fab') as m1 \gset
select pg_temp.verificar(public.crear_mision_envio(:'e1', :'fab') = :'m1', 'el envío tiene una sola misión viva');
reset role;
select pg_temp.verificar(
  (select cliente_id = :'cli' and destino_id = :'puno' and tonelaje_objetivo = 29 and tipo_carga = 'Maní' and envio_id = :'e1'
          and entrega_comprometida = '2026-12-10 23:59-04'::timestamptz and notas like 'Pedido PED-% (OC OC-900) · envío 1 · CPT'
     from public.misiones where id = :'m1'),
  'la misión hereda cliente, destino, producto, toneladas y fecha comprometida del envío');

select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.agregar_camion_solicitud(%L, %L, %L)', :'s1', :'c3', :'v1')) like 'El chofer no pertenece%',
  'el chofer debe ser del transportista de la solicitud');
select public.agregar_camion_solicitud(:'s1', :'c1', :'v1') as a1 \gset
select pg_temp.verificar(
  pg_temp.error_de(format('select public.agregar_camion_solicitud(%L, %L, %L)', :'s1', :'c1', :'v1')) like 'Ese chofer o ese camión ya está%',
  'no se repite el camión en el envío');
select public.agregar_camion_solicitud(:'s1', :'c2', :'v2') as a2 \gset
select pg_temp.verificar(
  pg_temp.error_de(format('select public.agregar_camion_solicitud(%L, %L, %L)', :'s1', :'c2', :'v2')) like 'Ya están cargados los 2 camiones%',
  'no se cargan más camiones de los confirmados');
select pg_temp.verificar(
  pg_temp.error_de(format('select public.responder_solicitud(%L, 1)', :'s1')) like 'Ya hay 2 camiones%',
  'no se baja la confirmación por debajo de los camiones asignados');
reset role;
select pg_temp.verificar(
  (select count(*) = 2 and bool_and(transportista_id = :'t1' and tramo = 1 and solicitud_id = :'s1')
     from public.asignaciones where mision_id = :'m1'),
  'las placas y choferes quedan como camiones de la misión ligados a su solicitud');

-- ---------- Costo y resumen ----------
select pg_temp.verificar(public.costo_solicitud(:'s1') = 3000, 'el costo por viaje es tarifa × camiones confirmados');
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar((select count(*) from public.solicitudes_camiones) = 0, 'gerencia no ve las tarifas de los transportistas');
select pg_temp.verificar(
  (select camiones_necesarios = 2 and camiones_pedidos = 2 and camiones_confirmados = 2 and camiones_asignados = 2
          and mision_id = :'m1' and costo = '{"BOB": 3000}'::jsonb
     from public.resumen_programa('2026-12-01', '2026-12-31') where envio_id = :'e1'),
  'gerencia ve el resumen del envío con el costo total, sin tarifa');
select pg_temp.verificar(
  (select camiones_necesarios = 1 and camiones_pedidos = 0 from public.resumen_programa('2026-12-01', '2026-12-31') where envio_id = :'e2'),
  'sin requerimiento, los camiones necesarios se estiman por toneladas');
select pg_temp.verificar((select count(*) = 1 from public.resumen_programa(null, null, :'e2')), 'el resumen se puede pedir para un solo envío');
reset role;
select pg_temp.verificar(
  pg_temp.error_de($$select * from public.resumen_programa('2026-12-01', '2026-12-31')$$) like 'Sin permiso%'
  or not has_function_privilege('anon', 'public.resumen_programa(date, date, uuid)', 'execute'),
  'un visitante sin sesión no ve el programa');

-- ---------- Llegada y ausencia ----------
select pg_temp.como(:'log');
set role authenticated;
select public.registrar_llegada(:'a1', '2026-11-28 07:10-04');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.registrar_ausencia(%L, 'No vino')$$, :'a1')) like 'Solo se marca%',
  'un camión que llegó no se marca como ausente');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.registrar_ausencia(%L, '')$$, :'a2')) like 'Escriba la causa%',
  'la ausencia exige causa');
select public.registrar_ausencia(:'a2', 'Avería en ruta');
reset role;
select pg_temp.verificar(
  (select etapa = 'cancelado' and ausencia_causa = 'Avería en ruta' from public.asignaciones where id = :'a2')
  and (select llegada_fabrica is not null from public.asignaciones where id = :'a1'),
  'la llegada queda registrada; el camión ausente queda anulado con su causa');
select pg_temp.como(:'log');
set role authenticated;
select public.agregar_camion_solicitud(:'s1', :'c2', :'v2') as a3 \gset
reset role;
select pg_temp.verificar(
  (select camiones_asignados = 2 and camiones_en_fabrica = 1 and camiones_ausentes = 1
     from public.resumen_programa('2026-12-01', '2026-12-31') where envio_id = :'e1'),
  'tras una ausencia se puede cargar un reemplazo; el resumen cuenta llegadas y ausencias');

-- ---------- Estados automáticos ----------
select pg_temp.como(:'log');
set role authenticated;
select public.cambiar_etapa_manual(:'a1', 'cargado', null) \g /dev/null
select public.cambiar_etapa_manual(:'a3', 'cargado', null) \g /dev/null
select public.cambiar_etapa_manual(:'a1', 'en_ruta', null) \g /dev/null
select public.cambiar_etapa_manual(:'a3', 'en_ruta', null) \g /dev/null
reset role;
select pg_temp.verificar(
  (select estado from public.programa_envios where id = :'e1') = 'en_curso'
  and (select estado from public.pedidos where id = :'ped') = 'en_ejecucion',
  'cuando la misión sale, el envío pasa a «en curso» y el pedido a «en ejecución»');
select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.cancelar_pedido(%L, 'x')$$, :'ped')) like 'El pedido tiene envíos en curso%',
  'no se cancela un pedido con un envío en camino');
-- Reprogramar por pedido del cliente mueve la fecha comprometida de la misión.
select public.reprogramar_envio(:'e1', '2026-12-12', null, 'cliente', null);
reset role;
select pg_temp.verificar(
  (select entrega_comprometida = '2026-12-12 23:59-04'::timestamptz from public.misiones where id = :'m1'),
  'si el cliente mueve la fecha, la misión toma la nueva fecha comprometida');

select pg_temp.como(:'log');
set role authenticated;
select public.cambiar_etapa_manual(:'a1', 'entregado', null) \g /dev/null
select public.cambiar_etapa_manual(:'a3', 'entregado', null) \g /dev/null
reset role;
select pg_temp.verificar(
  (select estado from public.programa_envios where id = :'e1') = 'cumplido'
  and (select estado from public.pedidos where id = :'ped') = 'en_ejecucion',
  'misión entregada → envío cumplido; el pedido sigue en ejecución mientras falte un envío');

-- Segundo envío: un camión, se cancela el camión → la misión se cancela y el envío vuelve a pendiente.
select pg_temp.como(:'log');
set role authenticated;
select public.pedir_camiones(:'e2', :'t2', 1, null, null) as s3 \gset
select public.responder_solicitud(:'s3', 1, 900);
select public.crear_mision_envio(:'e2', :'fab') as m2 \gset
select public.agregar_camion_solicitud(:'s3', :'c3', :'v3') as a4 \gset
select pg_temp.verificar(
  pg_temp.error_de(format('select public.anular_solicitud(%L)', :'s3')) like 'Tiene camiones asignados%',
  'no se anula un pedido de camiones con camiones asignados');
reset role;
select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.cancelar_envio(%L, 'cliente', null)$$, :'e2')) like 'El envío ya tiene camiones asignados%',
  'no se cancela un envío con camiones asignados');
reset role;
select pg_temp.como(:'log');
set role authenticated;
select public.cambiar_etapa_manual(:'a4', 'cargado', null) \g /dev/null
select public.cambiar_etapa_manual(:'a4', 'cancelado', 'Se suspendió') \g /dev/null
reset role;
select pg_temp.verificar(
  (select etapa from public.misiones where id = :'m2') = 'cancelado'
  and (select estado from public.programa_envios where id = :'e2') = 'pendiente'
  and public.mision_de_envio(:'e2') is null,
  'si la misión se cancela, el envío vuelve a pendiente y admite una misión nueva');

select pg_temp.como(:'log');
set role authenticated;
select public.crear_mision_envio(:'e2', :'fab') as m3 \gset
select public.agregar_camion_solicitud(:'s3', :'c3', :'v3') as a5 \gset
select public.cambiar_etapa_manual(:'a5', 'cargado', null) \g /dev/null
select public.cambiar_etapa_manual(:'a5', 'entregado', null) \g /dev/null
reset role;
select pg_temp.verificar(
  :'m3' <> :'m2'
  and (select estado from public.programa_envios where id = :'e2') = 'cumplido'
  and (select estado from public.pedidos where id = :'ped') = 'cumplido',
  'con todos los envíos entregados y lo pedido cubierto, el pedido queda cumplido');
select pg_temp.verificar(public.costo_solicitud(:'s3') = 900, 'la tarifa se puede registrar con la respuesta');

select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.pedir_camiones(%L, %L, 1)', :'e2', :'t1')) like 'El envío está cerrado%',
  'no se piden camiones para un envío cumplido');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.registrar_embarque(%L, '2026-12-20')$$, :'e2')) like 'La fecha de embarque se registra solo en envíos FOB%',
  'la fecha de embarque es solo para FOB');
reset role;

-- Si una entrega se revierte a mano, el envío y el pedido vuelven atrás.
select pg_temp.como(:'log');
set role authenticated;
select public.cambiar_etapa_manual(:'a5', 'en_ruta', 'Corrección') \g /dev/null
reset role;
select pg_temp.verificar(
  (select estado from public.programa_envios where id = :'e2') = 'en_curso'
  and (select estado from public.pedidos where id = :'ped') = 'en_ejecucion',
  'corregir la etapa de la misión corrige el estado del envío y del pedido');

-- ---------- FOB: embarque ----------
select pg_temp.como(:'com');
set role authenticated;
select public.guardar_pedido(null, jsonb_build_object('cliente_id', :'cli', 'orden_compra', 'OC-901', 'producto', 'Maní',
  'toneladas', 29, 'entrega_hasta', '2026-12-31', 'destino_id', :'puno', 'incoterm', 'FOB')) as pfob \gset
select public.guardar_programa(:'pfob', '[{"toneladas": 29, "entrega": "2026-12-20"}]'::jsonb) \g /dev/null
select public.confirmar_pedido(:'pfob');
select public.confirmar_programa(:'pfob') \g /dev/null
reset role;
select id as efob from public.programa_envios where pedido_id = :'pfob' \gset
select pg_temp.como(:'log');
set role authenticated;
select public.registrar_embarque(:'efob', '2026-12-22');
select public.pedir_camiones(:'efob', :'t1', 1) as s4 \gset
reset role;
select pg_temp.verificar((select embarque_fecha = '2026-12-22' from public.programa_envios where id = :'efob'),
  'logística registra la fecha de embarque que informa el agente de carga');
select pg_temp.como(:'com');
set role authenticated;
select public.cancelar_envio(:'efob', 'cliente', null);
reset role;
select pg_temp.verificar((select estado from public.solicitudes_camiones where id = :'s4') = 'anulado',
  'al cancelar un envío sin camiones, sus pedidos de camiones se anulan');

select pg_temp.verificar(not has_function_privilege('anon', 'public.pedir_camiones(uuid, uuid, integer, timestamptz, numeric, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.agregar_camion_solicitud(uuid, uuid, uuid)', 'execute'),
  'un visitante sin sesión no pide ni asigna camiones');
