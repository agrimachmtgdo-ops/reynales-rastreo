-- Fase C2: pedidos, programa de envíos, confirmación, reprogramación con causa y permisos.
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

-- ---------- Crear en borrador ----------
select pg_temp.como(:'com');
set role authenticated;
select public.guardar_pedido(null,
  jsonb_build_object('cliente_id', :'cli', 'orden_compra', 'OC-100', 'producto', 'Maní pelado', 'destino_id', :'puno', 'incoterm', 'cpt'),
  '[{"toneladas": 28, "entrega": "2026-12-10"}, {"toneladas": 28, "entrega": "2026-12-17", "carga": "2026-12-14"}]'::jsonb) as ped \gset
reset role;
select pg_temp.verificar(
  (select estado = 'borrador' and incoterm = 'CPT' and hito = 'entrega' and comercial_id = :'com' from public.pedidos where id = :'ped'),
  'el comercial crea un pedido en borrador; hereda el comercial del cliente y el hito «entrega»');
select pg_temp.verificar((select count(*) from public.programa_envios where pedido_id = :'ped') = 2, 'con su programa de 2 envíos');
select pg_temp.verificar((select code from (select codigo as code from public.pedidos where id = :'ped') x) like 'PED-%', 'el pedido recibe un código PED-');

select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_pedido(null, jsonb_build_object('cliente_id', %L, 'orden_compra', 'oc-100', 'producto', 'X', 'destino_id', %L, 'incoterm', 'CPT'), '[{"toneladas": 1, "entrega": "2026-12-10"}]')$$, :'cli', :'puno'))
    like 'Ese cliente ya tiene un pedido con la orden de compra%',
  'la misma orden de compra del mismo cliente no se carga dos veces');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_pedido(null, jsonb_build_object('cliente_id', %L, 'producto', 'X', 'destino_id', %L, 'incoterm', 'EXW'), '[]')$$, :'cli', :'puno'))
    like 'Agregue al menos un envío%',
  'un pedido sin envíos se rechaza');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_pedido(null, jsonb_build_object('cliente_id', %L, 'producto', 'X', 'destino_id', %L, 'incoterm', 'EXW'), '[{"toneladas": 5, "entrega": "2026-12-01", "carga": "2026-12-05"}]')$$, :'cli', :'puno'))
    like 'Envío 1: la fecha de carga no puede ser posterior%',
  'la carga no puede ser después de la entrega');
select public.guardar_pedido(null,
  jsonb_build_object('cliente_id', :'libre', 'producto', 'Maní', 'destino_id', :'puno', 'incoterm', 'EXW'),
  '[{"toneladas": 10, "entrega": "2026-12-20"}]'::jsonb) as ped_libre \gset
reset role;
select pg_temp.verificar((select hito = 'carga' from public.pedidos where id = :'ped_libre'),
  'con EXW el cumplimiento se mide al cargar; un cliente sin comercial lo puede atender cualquier comercial');

-- ---------- Permisos ----------
select pg_temp.como(:'otro');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.confirmar_pedido(%L)$$, :'ped')) like 'Solo el administrador o el comercial de este cliente%',
  'otro comercial no puede tocar los pedidos de un cliente ajeno');
select pg_temp.verificar((select count(*) from public.pedidos where id = :'ped') = 1, 'pero sí los ve');
reset role;
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.confirmar_pedido(%L)$$, :'ped')) is not null,
  'logística ve los pedidos pero no los confirma ni edita');
select pg_temp.verificar(
  pg_temp.error_de(format($$update public.pedidos set producto = 'X' where id = %L$$, :'ped')) is null
  and (select producto from public.pedidos where id = :'ped') = 'Maní pelado',
  'nadie escribe directo en la tabla: solo por las funciones que dejan rastro');
reset role;

-- ---------- Editar el borrador y confirmar ----------
select pg_temp.como(:'com');
set role authenticated;
select public.guardar_pedido(:'ped',
  jsonb_build_object('cliente_id', :'cli', 'orden_compra', 'OC-100', 'producto', 'Maní pelado', 'destino_id', :'puno', 'incoterm', 'CPT'),
  '[{"toneladas": 30, "entrega": "2026-12-10"}, {"toneladas": 26, "entrega": "2026-12-17"}, {"toneladas": 20, "entrega": "2026-12-24"}]'::jsonb) \g /dev/null
select public.confirmar_pedido(:'ped');
reset role;
select pg_temp.verificar(
  (select count(*) from public.programa_envios where pedido_id = :'ped' and entrega_comprometida = entrega_vigente) = 3
  and (select estado from public.pedidos where id = :'ped') = 'confirmado',
  'al confirmar, la fecha de cada envío queda como compromiso');
select id as e1 from public.programa_envios where pedido_id = :'ped' and numero = 1 \gset
select id as e2 from public.programa_envios where pedido_id = :'ped' and numero = 2 \gset
select id as e3 from public.programa_envios where pedido_id = :'ped' and numero = 3 \gset
select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_pedido(%L, jsonb_build_object('cliente_id', %L, 'producto', 'X', 'destino_id', %L, 'incoterm', 'CPT'), '[{"toneladas": 1, "entrega": "2026-12-10"}]')$$, :'ped', :'cli', :'puno'))
    like 'El pedido ya está confirmado%',
  'un pedido confirmado ya no se edita libremente');

-- ---------- Reprogramar con causa ----------
select public.reprogramar_envio(:'e1', '2026-12-13', null, 'produccion', 'Falta de producto');
select public.reprogramar_envio(:'e2', '2026-12-20', 24, 'cliente', 'El cliente pidió una semana más');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.reprogramar_envio(%L, '2026-12-30', null, 'otra', '')$$, :'e3')) like 'Con la causa «Otra»%',
  'con causa «Otra» la nota es obligatoria');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.reprogramar_envio(%L, '2026-12-24', null, 'cliente')$$, :'e3')) like 'No hay cambios%',
  'un cambio sin cambios se rechaza');
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
select pg_temp.como(:'com');
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
  'el administrador cancela el pedido y queda registrado por cada envío pendiente');
select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_pedido(null, jsonb_build_object('cliente_id', %L, 'orden_compra', 'OC-100', 'producto', 'Maní', 'destino_id', %L, 'incoterm', 'CPT'), '[{"toneladas": 28, "entrega": "2026-12-10"}]')$$, :'cli', :'puno')) is null,
  'una orden de compra cancelada se puede volver a cargar');
reset role;

select pg_temp.verificar(not has_function_privilege('anon', 'public.guardar_pedido(uuid, jsonb, jsonb)', 'execute'),
  'un visitante sin sesión no puede cargar pedidos');
