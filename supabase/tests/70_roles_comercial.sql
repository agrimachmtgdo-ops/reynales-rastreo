-- Fase C1: área comercial, comercial por cliente y pantalla de usuarios.
-- Lo más importante: cada perfil actual conserva exactamente sus permisos.
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
insert into auth.users (email) values ('admin7@reynales.test') returning id as adm \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'adm';
insert into auth.users (email) values ('logistica7@reynales.test') returning id as log \gset
update public.usuarios set activo = true, rol = 'despacho' where id = :'log';
insert into auth.users (email) values ('gerencia7@reynales.test') returning id as ger \gset
update public.usuarios set activo = true, rol = 'gerencia' where id = :'ger';
insert into auth.users (email) values ('comercial7@reynales.test') returning id as com \gset
insert into auth.users (email) values ('nuevo7@reynales.test') returning id as nuevo \gset

-- ---------- Registrar y perfilar como administrador ----------
select pg_temp.como(:'adm');
set role authenticated;
select public.registrar_personal('Comercial7@Reynales.test', 'Carla Comercial', 'comercial') \g /dev/null
reset role;
select pg_temp.verificar(
  (select rol = 'gerencia' and area = 'comercial' and activo from public.usuarios where id = :'com'),
  'registrar un comercial lo deja activo, con rol gerencia (solo lectura) y área comercial');
select pg_temp.verificar(
  pg_temp.error_de(format($$update public.usuarios set area = 'comercial' where id = %L$$, :'log')) like '%usuarios_comercial_solo_lectura%',
  'un comercial nunca puede tener rol despacho o administrador (no editaría misiones por accidente)');

select pg_temp.como(:'adm');
set role authenticated;
select pg_temp.verificar(
  (select count(*) from public.listar_personal() where correo like '%7@reynales.test') = 5,
  'el administrador ve la lista de usuarios con su correo');
select pg_temp.verificar(
  (select perfil from public.listar_personal() where id = :'log') = 'logistica',
  'el rol despacho se muestra como «logística»');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_personal(%L, 'Yo', 'gerencia', true)$$, :'adm')) like 'No puede quitarse%',
  'el administrador no puede quitarse su propio perfil');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_personal(%L, 'Yo', 'administrador', false)$$, :'adm')) like 'No puede quitarse%',
  'el administrador no puede desactivarse a sí mismo');
select pg_temp.verificar(
  pg_temp.error_de($$select public.registrar_personal('noexiste@x.test', 'X', 'gerencia')$$) like 'No existe una cuenta%',
  'registrar un correo sin cuenta explica cómo crearla');
select pg_temp.verificar(
  pg_temp.error_de(format($$select public.guardar_personal(%L, 'X', 'jefe', true)$$, :'nuevo')) like 'Elija un perfil%',
  'un perfil inventado se rechaza');
reset role;

-- ---------- Cada perfil actual conserva sus permisos ----------
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(public.puede_editar() and public.perfil_actual() = 'logistica', 'logística sigue pudiendo editar todo lo de hoy');
select pg_temp.verificar(
  pg_temp.error_de($$select public.listar_personal()$$) like 'Solo un administrador%', 'logística no ve la lista de usuarios');
reset role;
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar(not public.puede_editar() and public.es_personal(), 'gerencia sigue en solo lectura');
select pg_temp.verificar(
  pg_temp.error_de($$insert into public.clientes (razon_social) values ('No debe')$$) is not null,
  'gerencia sigue sin poder crear clientes');
reset role;
select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(not public.puede_editar() and public.es_comercial() and public.perfil_actual() = 'comercial',
  'el comercial no edita misiones ni camiones, pero es comercial');
select pg_temp.verificar(
  pg_temp.error_de($$insert into public.clientes (razon_social, pais) values ('Cliente de Carla', 'PE')$$) is null,
  'el comercial puede crear clientes');
update public.clientes set contacto = 'Juan' where razon_social = 'Cliente de Carla';
select pg_temp.verificar(
  (select contacto from public.clientes where razon_social = 'Cliente de Carla') = 'Juan',
  'el comercial puede editar clientes');
update public.misiones set notas = 'cambio-no-permitido';
reset role;
select pg_temp.verificar(
  exists (select 1 from public.misiones) and not exists (select 1 from public.misiones where notas = 'cambio-no-permitido'),
  'el comercial no puede modificar misiones (la base ignora el cambio)');
select pg_temp.como(:'com');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$update public.clientes set comercial_id = %L where razon_social = 'Cliente de Carla'$$, :'com')) like 'Solo un administrador asigna%',
  'el comercial no puede asignarse clientes');
reset role;

-- ---------- Comercial por cliente ----------
select pg_temp.como(:'adm');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format($$update public.clientes set comercial_id = %L where razon_social = 'Cliente de Carla'$$, :'com')) is null,
  'el administrador asigna el comercial de un cliente');
select pg_temp.verificar(
  pg_temp.error_de(format($$update public.clientes set comercial_id = %L where razon_social = 'Cliente de Carla'$$, :'log')) like 'Elija un usuario activo del área comercial%',
  'solo se asigna a usuarios del área comercial');
select pg_temp.verificar((select count(*) from public.comerciales()) = 1, 'la lista de comerciales para elegir');
select public.guardar_personal(:'com', 'Carla Comercial', 'gerencia', true) \g /dev/null
reset role;
select pg_temp.verificar(
  (select comercial_id is null from public.clientes where razon_social = 'Cliente de Carla'),
  'si deja de ser comercial, sus clientes quedan sin asignar');

-- ---------- Visitantes y operadores ----------
select pg_temp.verificar(not has_function_privilege('anon', 'public.listar_personal()', 'execute'),
  'un visitante sin sesión no puede llamar a la lista de usuarios');
select pg_temp.verificar(not has_function_privilege('anon', 'public.registrar_personal(text, text, text)', 'execute'),
  'un visitante sin sesión no puede registrar personal');
