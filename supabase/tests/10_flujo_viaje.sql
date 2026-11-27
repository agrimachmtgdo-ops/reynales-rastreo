-- Prueba de punta a punta: despacho crea misión e invitación, el chofer activa,
-- acepta la política, inicia el viaje, envía posiciones y entrega.
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
grant execute on function pg_temp.verificar(boolean, text) to authenticated, anon;

select extract(epoch from now())::bigint as t0 \gset

-- ---------- Usuarios ----------
insert into auth.users (email) values ('admin@reynales.test') returning id as admin_id \gset
insert into auth.users (email) values ('despacho@reynales.test') returning id as despacho_id \gset
insert into auth.users (email) values ('gerencia@reynales.test') returning id as gerencia_id \gset
insert into auth.users (is_anonymous) values (true) returning id as chofer_id \gset
insert into auth.users (is_anonymous) values (true) returning id as extrano_id \gset

select pg_temp.verificar((select count(*) = 3 from public.usuarios where not activo), 'el registro con correo crea fichas inactivas');
select pg_temp.verificar(not exists (select 1 from public.usuarios where id = :'chofer_id'), 'la sesión anónima del chofer no crea ficha de personal');
update public.usuarios set activo = true, rol = 'administrador' where id = :'admin_id';
update public.usuarios set activo = true, rol = 'despacho' where id = :'despacho_id';
update public.usuarios set activo = true, rol = 'gerencia' where id = :'gerencia_id';

-- ---------- Visitante sin sesión ----------
set role anon;
do $$ begin
  perform 1 from public.clientes;
  raise exception 'FALLÓ: anon pudo leer clientes';
exception when insufficient_privilege then raise notice 'ok - anon no puede leer tablas';
end $$;
reset role;

-- ---------- Despacho crea la misión ----------
select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id', 'role', 'authenticated')::text, false) \g /dev/null
set role authenticated;

insert into public.misiones (cliente_id, origen_id, destino_id, factura, guia, dex, tonelaje_objetivo, telefono_coordinador)
select (select id from public.clientes limit 1),
       (select id from public.ubicaciones where tipo = 'fabrica'),
       (select id from public.ubicaciones where nombre = 'Puno'),
       'F-001', 'G-001', 'DEX-001', 30, '+59170000001'
returning id as mision_id, codigo as mision_codigo \gset
select pg_temp.verificar(:'mision_codigo' ~ '^MSN-[A-Z0-9]{8}$', 'código de misión con formato MSN-XXXXXXXX');

insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
select :'mision_id', t.id, c.id, v.id, 29.5
  from public.transportistas t join public.conductores c on c.transportista_id = t.id
  join public.vehiculos v on v.transportista_id = t.id limit 1
returning id as asig_id \gset

select codigo as codigo from public.crear_invitacion(:'asig_id') \gset
select pg_temp.verificar(length(:'codigo') = 8, 'despacho genera código de invitación de 8 caracteres');
reset role;

-- ---------- Gerencia solo lee ----------
select set_config('request.jwt.claims', json_build_object('sub', :'gerencia_id')::text, false) \g /dev/null
set role authenticated;
select pg_temp.verificar((select count(*) = 1 from public.misiones), 'gerencia puede leer misiones');
do $$ begin
  insert into public.clientes (razon_social) values ('No debería');
  raise exception 'FALLÓ: gerencia pudo crear un cliente';
exception when insufficient_privilege then raise notice 'ok - gerencia no puede crear registros';
end $$;
do $$ begin
  perform public.crear_invitacion((select id from public.asignaciones limit 1));
  raise exception 'FALLÓ: gerencia pudo crear invitación';
exception when insufficient_privilege then raise notice 'ok - gerencia no puede invitar choferes';
end $$;
reset role;

-- ---------- Chofer activa el código ----------
select set_config('request.jwt.claims', json_build_object('sub', :'chofer_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
select pg_temp.verificar((select count(*) = 0 from public.asignaciones), 'el chofer no ve tablas directamente');
do $$ begin
  perform 1 from public.posiciones_2026_12;
  raise exception 'FALLÓ: una partición de posiciones quedó expuesta';
exception when insufficient_privilege then raise notice 'ok - las particiones de posiciones no se exponen';
end $$;
select public.activar_invitacion(lower(:'codigo'), 'android-chofer-1') as viaje \gset
select pg_temp.verificar((:'viaje'::jsonb ->> 'requiere_consentimiento')::boolean, 'tras activar se pide consentimiento');
select pg_temp.verificar((:'viaje'::jsonb ->> 'placa') = '1234ABC', 'el resumen incluye la placa');

do $$ begin
  perform public.marcar_etapa_chofer((select (public.mi_viaje() ->> 'asignacion_id')::uuid), 'cargado');
  raise exception 'FALLÓ: inició viaje sin consentimiento';
exception when raise_exception then
  if sqlerrm like 'FALLÓ%' then raise; end if;
  raise notice 'ok - no puede iniciar sin aceptar la política';
end $$;

select public.aceptar_politica(:'asig_id', '2026-11-v1') \g /dev/null
select pg_temp.verificar(not (public.mi_viaje() ->> 'requiere_consentimiento')::boolean, 'consentimiento registrado');

-- Antes de "Iniciar viaje" no se guarda ubicación.
select pg_temp.verificar(
  (public.registrar_posiciones(:'asig_id', jsonb_build_array(jsonb_build_array((:t0 - 3600), -1980500, -6395600, 0, 10, 0))) ->> 'nuevas')::int = 0,
  'sin iniciar viaje no se guardan posiciones');

select public.marcar_etapa_chofer(:'asig_id', 'cargado') \g /dev/null
reset role;

-- ---------- Otro teléfono intenta usar el mismo código ----------
select set_config('request.jwt.claims', json_build_object('sub', :'extrano_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
select set_config('prueba.codigo', :'codigo', false) \g /dev/null
do $$ begin
  perform public.activar_invitacion(current_setting('prueba.codigo'), 'android-otro');
  raise exception 'FALLÓ: el código se activó en otro teléfono';
exception when raise_exception then
  if sqlerrm like 'FALLÓ%' then raise; end if;
  raise notice 'ok - un código sirve para un solo teléfono (%)', sqlerrm;
end $$;
select pg_temp.verificar(
  (select count(*) = 0 from public.invitaciones_chofer), 'otro teléfono tampoco ve invitaciones');
select pg_temp.verificar(public.mi_viaje() is null, 'otro teléfono no tiene viaje');
reset role;
select pg_temp.verificar(
  (select dispositivo_id = 'android-chofer-1' and usado_por = :'chofer_id' from public.invitaciones_chofer where codigo = :'codigo'),
  'el código sigue ligado al primer teléfono');

-- ---------- Chofer envía un lote que cruza la frontera ----------
select set_config('request.jwt.claims', json_build_object('sub', :'chofer_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
select public.registrar_posiciones(:'asig_id', jsonb_build_array(
  jsonb_build_array((:t0 - 3000), -1980500, -6395600,  5, 10, 0),  -- dentro de la fábrica
  jsonb_build_array((:t0 - 2400), -1975000, -6390000, 60, 10, 0),  -- salió: en_ruta
  jsonb_build_array((:t0 - 1800), -1656700, -6903800,  8, 15, 0),  -- Desaguadero: en_frontera
  jsonb_build_array((:t0 - 1200), -1655000, -6907000, 30, 12, 0),  -- lado peruano, fuera de la geocerca
  jsonb_build_array((:t0 - 600),  9999999, -6907000, 30, 12, 0),  -- latitud inválida: se descarta
  jsonb_build_array(1, 2, 3)                                                                                 -- mal formado: se descarta
)) as r \gset
select pg_temp.verificar((:'r'::jsonb ->> 'nuevas')::int = 4, 'se guardan 4 posiciones válidas y se descartan 2');
select pg_temp.verificar((:'r'::jsonb ->> 'etapa') = 'cruzo_frontera', 'geocercas: fábrica → en ruta → frontera → cruzó');
select pg_temp.verificar((:'r'::jsonb ->> 'modo_peru')::boolean, 'la app pasa a modo Perú');

select pg_temp.verificar(
  (public.registrar_posiciones(:'asig_id', jsonb_build_array(
     jsonb_build_array((:t0 - 1200), -1655000, -6907000, 30, 12, 0))) ->> 'nuevas')::int = 0,
  'un lote reenviado no duplica posiciones');

select public.registrar_posiciones(:'asig_id', jsonb_build_array(
  jsonb_build_array((:t0 - 300), -1600000, -6950000, 50, 5, 1))) \g /dev/null
reset role;

select pg_temp.verificar((select etapa = 'cruzo_frontera' from public.misiones where id = :'mision_id'), 'la etapa de la misión sigue al camión');
select pg_temp.verificar((select count(*) = 3 from public.eventos where asignacion_id = :'asig_id' and origen = 'geocerca'), 'tres cambios de etapa por geocerca registrados');
select pg_temp.verificar((select count(*) = 1 from public.eventos where tipo = 'incidencia' and detalle ->> 'motivo' = 'ubicacion_simulada'), 'ubicación simulada registrada como incidencia');
select pg_temp.verificar((select ultima_senal > now() - interval '6 min' and ultima_lat < -15.9 from public.asignaciones where id = :'asig_id'), 'última posición actualizada para el mapa');

-- ---------- Despacho ve el recorrido ----------
select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id')::text, false) \g /dev/null
set role authenticated;
select pg_temp.verificar((select count(*) = 5 from public.recorrido_asignacion(:'asig_id')), 'despacho obtiene el recorrido');
reset role;

-- ---------- Entrega y cierre del acceso ----------
select set_config('request.jwt.claims', json_build_object('sub', :'chofer_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
select public.marcar_etapa_chofer(:'asig_id', 'entregado') \g /dev/null
select pg_temp.verificar(public.mi_viaje() is null, 'tras entregar, el chofer ya no tiene viaje activo');
select pg_temp.verificar(
  not (public.registrar_posiciones(:'asig_id', jsonb_build_array(
     jsonb_build_array(:t0, -1584000, -7002000, 0, 5, 0))) ->> 'rastrear')::boolean,
  'tras entregar, el servidor pide apagar el GPS');
reset role;
select pg_temp.verificar((select etapa = 'entregado' from public.misiones where id = :'mision_id'), 'misión entregada');
select pg_temp.verificar((select count(*) = 5 from public.posiciones where asignacion_id = :'asig_id'), 'no se guardan posiciones después de entregar');
