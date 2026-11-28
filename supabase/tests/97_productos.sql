-- Catálogo de productos: permisos, enlace automático texto ↔ producto y herencia desde el pedido.
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

insert into auth.users (email) values ('adm97@reynales.test') returning id as adm \gset
insert into auth.users (email) values ('ger97@reynales.test') returning id as ger \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'adm';
update public.usuarios set activo = true, rol = 'gerencia' where id = :'ger';
select (now() at time zone 'America/La_Paz')::date as hoy \gset
insert into public.clientes (razon_social, pais) values ('Cliente 97', 'BO') returning id as cli \gset
select id as dest from public.ubicaciones where nombre = 'Puno' \gset
select id as fab from public.ubicaciones where tipo = 'fabrica' order by nombre limit 1 \gset

select pg_temp.verificar(exists (select 1 from public.productos where nombre = 'Harina Integral'), 'la migración crea «Harina Integral»');

-- Permisos: gerencia lee pero no crea; el administrador crea y edita; nadie borra.
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar((select count(*) from public.productos) >= 1, 'gerencia lee el catálogo');
select pg_temp.verificar(pg_temp.error_de($$insert into public.productos (nombre) values ('Aceite 97')$$) is not null, 'gerencia no crea productos');
reset role;
select pg_temp.como(:'adm');
set role authenticated;
insert into public.productos (nombre, codigo, presentacion, partida_arancelaria)
  values ('Torta de soya 97', 'TS97', 'Granel', '2304.00.00') returning id as prod \gset
select pg_temp.verificar(pg_temp.error_de($$insert into public.productos (nombre) values ('torta de soya 97 ')$$) is not null, 'no se repite el nombre (sin importar mayúsculas)');
select pg_temp.verificar(pg_temp.error_de($$insert into public.productos (nombre, partida_arancelaria) values ('X97', 'abc')$$) is not null, 'la partida arancelaria solo acepta dígitos y puntos');
delete from public.productos where id = :'prod';
select pg_temp.verificar(exists (select 1 from public.productos where id = :'prod'), 'un producto no se borra (se desactiva)');

-- Pedido con el nombre escrito: se enlaza solo con el producto.
select public.guardar_pedido(null, jsonb_build_object('cliente_id', :'cli', 'producto', 'torta de soya 97', 'toneladas', 145,
  'entrega_hasta', (:'hoy'::date + 60)::text, 'destino_id', :'dest', 'incoterm', 'CPT')) as ped \gset
reset role;
select pg_temp.verificar((select producto_id from public.pedidos where id = :'ped') = :'prod', 'el pedido queda enlazado al producto por su nombre');
select pg_temp.verificar((select producto from public.pedidos where id = :'ped') = 'Torta de soya 97', 'el texto del pedido toma el nombre del catálogo');

-- Un nombre que no está en el catálogo se guarda como texto, sin enlace.
insert into public.misiones (cliente_id, origen_id, destino_id, tipo_carga) values (:'cli', :'fab', :'dest', 'Producto libre 97') returning id as mlibre \gset
select pg_temp.verificar((select producto_id from public.misiones where id = :'mlibre') is null, 'un texto fuera del catálogo queda sin enlace');

-- Misión con producto_id: el texto se completa.
insert into public.misiones (cliente_id, origen_id, destino_id, producto_id) values (:'cli', :'fab', :'dest', :'prod') returning id as mprod \gset
select pg_temp.verificar((select tipo_carga from public.misiones where id = :'mprod') = 'Torta de soya 97', 'la misión con producto completa el tipo de carga');

-- La misión del envío hereda el producto del pedido.
select pg_temp.como(:'adm');
set role authenticated;
select public.guardar_programa(:'ped', jsonb_build_array(jsonb_build_object('toneladas', 145, 'entrega', (:'hoy'::date + 10)::text))) \g /dev/null
select public.confirmar_pedido(:'ped');
select public.confirmar_programa(:'ped') \g /dev/null
reset role;
select id as e1 from public.programa_envios where pedido_id = :'ped' and numero = 1 \gset
insert into public.misiones (cliente_id, origen_id, destino_id, envio_id) values (:'cli', :'fab', :'dest', :'e1') returning id as menvio \gset
select pg_temp.verificar((select producto_id from public.misiones where id = :'menvio') = :'prod', 'la misión del envío hereda el producto del pedido');

-- Al renombrar el producto, lo nuevo usa el nombre nuevo; lo guardado no cambia.
update public.productos set nombre = 'Torta de soya hipro 97' where id = :'prod';
select pg_temp.verificar((select tipo_carga from public.misiones where id = :'mprod') = 'Torta de soya 97', 'renombrar no cambia los textos ya guardados');
select pg_temp.verificar(pg_temp.error_de(format('update public.misiones set producto_id = %L where id = %L', gen_random_uuid(), :'mlibre')) is not null, 'no acepta un producto inexistente');

-- Cambiar el producto escribiendo otro nombre del catálogo cambia también el enlace.
update public.pedidos set producto = 'Harina Integral' where id = :'ped';
select pg_temp.verificar((select producto_id from public.pedidos where id = :'ped') = (select id from public.productos where nombre = 'Harina Integral'), 'al cambiar el texto del pedido cambia el enlace');
update public.misiones set tipo_carga = 'Otro libre 97' where id = :'mprod';
select pg_temp.verificar((select producto_id from public.misiones where id = :'mprod') is null, 'al cambiar el tipo de carga a un texto libre se quita el enlace');
-- Un producto desactivado ya no se enlaza por nombre.
update public.productos set activo = false where nombre = 'Harina Integral';
insert into public.misiones (cliente_id, origen_id, destino_id, tipo_carga) values (:'cli', :'fab', :'dest', 'Harina Integral') returning id as minact \gset
select pg_temp.verificar((select producto_id from public.misiones where id = :'minact') is null, 'un producto inactivo no se ofrece ni se enlaza');
update public.productos set activo = true where nombre = 'Harina Integral';

select 'ok - 97_productos' ;
