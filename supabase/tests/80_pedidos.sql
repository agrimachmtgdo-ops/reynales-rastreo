-- Fases C2 y C2b: el pedido (cantidad y plazo) y su programa de envíos son cosas distintas;
-- programa planificado → confirmado, reprogramación con causa, tope de toneladas y permisos.
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
insert into auth.users (email) values ('admin8@reynales.test') returning id as adm \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'adm';
insert into auth.users (email) values ('com8@reynales.test') returning id as com \gset
insert into auth.users (email) values ('otro8@reynales.test') returning id as otro \gset
insert into auth.users (email) values ('log8@reynales.test') returning id as log \gset
update public.usuarios set activo = true, rol = 'despacho' where id = :'log';
select pg_temp.como(:'adm');
set role authenticated;
select public.registrar_personal('com8@reynales.test', 'Comercial Ocho', 'comercial') \g /dev/null
select public.registrar_personal('otro8@reynales.test', 'Otro Comercial', 'comercial') \g /dev/null
reset role;
insert into public.clientes (razon_social, pais, comercial_id) values ('Cliente de Ocho', 'PE', :'com') returning id as cli \gset
insert into public.clientes (razon_social, pais) values ('Cliente sin comercial', 'BO') returning id as libre \gset
select id as puno from public.ubicaciones where nombre = 'Puno' \gset

-- ---------- Pedido sin envíos ----------
select pg_temp.como(:'com');
set role authenticated;
select public.guardar_pedido(null,
  jsonb_build_object('cliente_id', :'cli', 'orden_compra', 'OC-100', 'producto', 'Maní pelado', 'toneladas', 145,
                     'entrega_hasta', '2026-12-31', 'destino_id', :'puno', 'incoterm', 'cpt')) as ped \gset
reset role;
select pg_temp.verificar(
  (select estado = 'borrador' and incoterm = 'CPT' and hito = 'entrega' and comercial_id = :'com' and toneladas = 145
     from public.pedidos where id = :'ped'),
  'el comercial registra el pedido con sus toneladas y plazo, sin envíos; hereda el comercial del cliente');
select pg_temp.verificar((select count(*) from public.programa_envios where pedido_id = :'ped') = 0, 'el pedido nace sin programa');
select pg_temp.verificar((select codigo from public.pedidos where id = :'ped') like 'PED-%', 'el pedido recibe un código PED-');

select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_pedido(null, jsonb_build_object('cliente_id', %L, 'orden_compra', 'oc-100', 'producto', 'X', 'toneladas', 1, 'entrega_hasta', '2026-12-10', 'destino_id', %L, 'incoterm', 'CPT'))$$, :'cli', :'puno'))
    like 'Ese cliente ya tiene un pedido con la orden de compra%',
  'la misma orden de compra del mismo cliente no se carga dos veces');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_pedido(null, jsonb_build_object('cliente_id', %L, 'producto', 'X', 'entrega_hasta', '2026-12-10', 'destino_id', %L, 'incoterm', 'EXW'))$$, :'cli', :'puno'))
    like 'Escriba las toneladas%',
  'un pedido sin toneladas se rechaza');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_pedido(null, jsonb_build_object('cliente_id', %L, 'producto', 'X', 'toneladas', 5, 'entrega_desde', '2026-12-20', 'entrega_hasta', '2026-12-10', 'destino_id', %L, 'incoterm', 'EXW'))$$, :'cli', :'puno'))
    like 'La fecha «desde» no puede%',
  'el plazo «desde» no puede ser posterior a la fecha límite');
select public.guardar_pedido(null,
  jsonb_build_object('cliente_id', :'libre', 'producto', 'Maní', 'toneladas', 10, 'entrega_hasta', '2026-12-20', 'destino_id', :'puno', 'incoterm', 'EXW')) as ped_libre \gset
reset role;
select pg_temp.verificar((select hito = 'carga' from public.pedidos where id = :'ped_libre'),
  'con EXW el cumplimiento se mide al cargar; un cliente sin comercial lo puede atender cualquier comercial');

-- ---------- Programa planificado ----------
select pg_temp.como(:'com');
set role authenticated;
select public.guardar_programa(:'ped', '[{"toneladas": 29, "entrega": "2026-12-10"}, {"toneladas": 29, "entrega": "2026-12-12", "carga": "2026-12-09"}]');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_programa(%L, '[{"toneladas": 5, "entrega": "2026-12-01", "carga": "2026-12-05"}]')$$, :'ped'))
    like 'Envío 1: la fecha de carga no puede ser posterior%',
  'la carga no puede ser después de la entrega');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_programa(%L, '[{"toneladas": 100, "entrega": "2026-12-10"}, {"toneladas": 50, "entrega": "2026-12-12"}]')$$, :'ped'))
    like 'El programa suma 150%',
  'no se programa más de lo pedido + 3 %');
reset role;
select pg_temp.verificar(
  (select count(*) from public.programa_envios where pedido_id = :'ped' and estado = 'planificado' and entrega_comprometida is null) = 2,
  'el programa queda planificado (sin compromiso) y un error no borra lo guardado');

-- ---------- Permisos ----------
select pg_temp.como(:'otro');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.confirmar_pedido(%L)$$, :'ped')) like 'Solo el administrador o el comercial de este cliente%',
  'otro comercial no puede tocar los pedidos de un cliente ajeno');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_programa(%L, '[]')$$, :'ped')) like 'Solo el administrador, el comercial del cliente o logística%',
  'ni su programa');
select pg_temp.verificar((select count(*) from public.pedidos where id = :'ped') = 1, 'pero sí los ve');
reset role;
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.confirmar_pedido(%L)$$, :'ped')) is not null,
  'logística no confirma ni edita el pedido');
select public.guardar_programa(:'ped', '[{"toneladas": 29, "entrega": "2026-12-10"}, {"toneladas": 29, "entrega": "2026-12-12"}, {"toneladas": 29, "entrega": "2026-12-14"}]');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.confirmar_programa(%L)$$, :'ped')) like 'Primero confirme el pedido%',
  'logística sí arma el programa, pero no se confirma antes que el pedido');
select pg_temp.verificar(
  pg_temp.error_de(format($$update public.pedidos set producto = 'X' where id = %L$$, :'ped')) is null
  and (select producto from public.pedidos where id = :'ped') = 'Maní pelado',
  'nadie escribe directo en la tabla: solo por las funciones que dejan rastro');
reset role;

-- ---------- Confirmar pedido y programa ----------
select pg_temp.como(:'com');
set role authenticated;
select public.confirmar_pedido(:'ped');
reset role;
select pg_temp.verificar(
  (select estado from public.pedidos where id = :'ped') = 'confirmado'
  and (select count(*) from public.programa_envios where pedido_id = :'ped' and estado = 'planificado') = 3,
  'confirmar el pedido acepta la orden; el programa sigue planificado');
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(public.confirmar_programa(:'ped') = 3, 'logística confirma el programa (3 envíos)');
select public.guardar_programa(:'ped', '[{"toneladas": 29, "entrega": "2026-12-16"}, {"toneladas": 29, "entrega": "2026-12-18"}]');
reset role;
select pg_temp.verificar(
  (select count(*) from public.programa_envios where pedido_id = :'ped' and estado = 'pendiente' and entrega_comprometida = entrega_vigente) = 3
  and (select count(*) from public.programa_envios where pedido_id = :'ped' and estado = 'planificado' and numero in (4, 5)) = 2,
  'al confirmar el programa la fecha queda como compromiso; los envíos agregados después siguen planificados (4 y 5)');
select id as e1 from public.programa_envios where pedido_id = :'ped' and numero = 1 \gset
select id as e2 from public.programa_envios where pedido_id = :'ped' and numero = 2 \gset
select id as e3 from public.programa_envios where pedido_id = :'ped' and numero = 3 \gset
select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_pedido(%L, jsonb_build_object('cliente_id', %L, 'producto', 'X', 'toneladas', 1, 'entrega_hasta', '2026-12-10', 'destino_id', %L, 'incoterm', 'CPT'))$$, :'ped', :'cli', :'puno'))
    like 'El pedido ya está confirmado%',
  'un pedido confirmado ya no se edita libremente');

-- ---------- Reprogramar con causa ----------
select public.reprogramar_envio(:'e1', '2026-12-13', null, 'produccion', 'Falta de producto');
select public.reprogramar_envio(:'e2', '2026-12-20', 24, 'cliente', 'El cliente pidió una semana más');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.reprogramar_envio(%L, '2026-12-30', null, 'otra', '')$$, :'e3')) like 'Con la causa «Otra»%',
  'con causa «Otra» la nota es obligatoria');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.reprogramar_envio(%L, '2026-12-14', null, 'cliente')$$, :'e3')) like 'No hay cambios%',
  'un cambio sin cambios se rechaza');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.reprogramar_envio(%L, '2026-12-14', 80, 'cliente')$$, :'e3')) like 'Con 80 t el programa superaría%',
  'reprogramar tampoco supera lo pedido');
reset role;
select pg_temp.verificar(
  (select entrega_comprometida = '2026-12-10' and entrega_vigente = '2026-12-13' from public.programa_envios where id = :'e1'),
  'causa interna: la fecha planificada cambia, pero el compromiso sigue siendo el original');
select pg_temp.verificar(
  (select entrega_comprometida = '2026-12-20' and entrega_vigente = '2026-12-20' and toneladas = 24 from public.programa_envios where id = :'e2'),
  'causa cliente: el compromiso también cambia (no cuenta como incumplimiento)');
select pg_temp.verificar(
  (select count(*) from public.cambios_compromiso c join public.programa_envios e on e.id = c.envio_id where e.pedido_id = :'ped') = 2
  and (select usuario_id = :'com' and causa = 'produccion' and not mueve_compromiso from public.cambios_compromiso where envio_id = :'e1'),
  'cada cambio queda en el historial con quién, cuándo y por qué');

-- ---------- Cancelar ----------
select pg_temp.como(:'log');
set role authenticated;
select public.cancelar_envio(:'e3', 'cliente', 'Ya no lo necesita');
reset role;
select pg_temp.verificar(
  (select estado from public.programa_envios where id = :'e3') = 'cancelado'
  and (select estado from public.pedidos where id = :'ped') = 'confirmado',
  'cancelar un envío deja el resto del pedido vivo');
select pg_temp.como(:'adm');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.cancelar_pedido(%L, '')$$, :'ped')) like 'Escriba el motivo%',
  'cancelar un pedido exige el motivo');
select public.cancelar_pedido(:'ped', 'El cliente anuló la orden');
reset role;
select pg_temp.verificar(
  (select estado from public.pedidos where id = :'ped') = 'cancelado'
  and (select count(*) from public.programa_envios where pedido_id = :'ped' and estado <> 'cancelado') = 0
  and (select count(*) from public.cambios_compromiso c join public.programa_envios e on e.id = c.envio_id where e.pedido_id = :'ped') = 5,
  'el administrador cancela el pedido; quedan registrados los envíos confirmados (los planificados solo se anulan)');
select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.crear_pedido_con_programa(jsonb_build_object('cliente_id', %L, 'orden_compra', 'OC-100', 'producto', 'Maní', 'toneladas', 56, 'entrega_hasta', '2026-12-20', 'destino_id', %L, 'incoterm', 'CPT', 'origen', 'excel'), '[{"toneladas": 28, "entrega": "2026-12-10"}, {"toneladas": 28, "entrega": "2026-12-17"}]')$$, :'cli', :'puno')) is null,
  'una orden de compra cancelada se puede volver a cargar (importación: pedido + programa planificado)');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.crear_pedido_con_programa(jsonb_build_object('cliente_id', %L, 'orden_compra', 'OC-200', 'producto', 'Maní', 'toneladas', 10, 'entrega_hasta', '2026-12-20', 'destino_id', %L, 'incoterm', 'CPT'), '[{"toneladas": 28, "entrega": "2026-12-10"}]')$$, :'cli', :'puno')) like 'El programa suma%'
  and not exists (select 1 from public.pedidos where orden_compra = 'OC-200'),
  'si el programa importado falla, tampoco queda el pedido a medias');
reset role;

select pg_temp.verificar(not has_function_privilege('anon', 'public.guardar_pedido(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.guardar_programa(uuid, jsonb)', 'execute'),
  'un visitante sin sesión no puede cargar pedidos ni programas');
