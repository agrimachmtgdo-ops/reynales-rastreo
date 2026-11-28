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
-- Para la prueba, el viaje se inició hace 10 horas (las posiciones de abajo son de ese lapso).
update public.eventos set ocurrido_en = to_timestamp(:t0 - 36000)
 where asignacion_id = :'asig_id' and etapa_nueva = 'cargado';

-- ---------- Otro teléfono intenta usar el mismo código ----------
select set_config('request.jwt.claims', json_build_object('sub', :'extrano_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
select set_config('prueba.codigo', :'codigo', false) \g /dev/null
select pg_temp.verificar(public.activar_invitacion(:'codigo', 'android-otro') is null,
  'un código sirve para un solo teléfono (respuesta genérica, sin revelar que existe)');
do $$ begin
  perform public.activar_invitacion('ZZZZ9999', 'desconocido');
  raise exception 'FALLÓ: aceptó un teléfono sin identificador';
exception when raise_exception then
  if sqlerrm like 'FALLÓ%' then raise; end if;
  raise notice 'ok - se rechaza el identificador de teléfono «desconocido»';
end $$;
select public.activar_invitacion('ZZZZ999' || n, 'android-otro') from generate_series(1, 4) n \g /dev/null
select pg_temp.verificar((public.estado_activacion('android-otro') ->> 'bloqueado')::boolean,
  'tras 5 intentos fallidos el teléfono queda bloqueado una hora');
do $$ begin
  perform public.activar_invitacion(current_setting('prueba.codigo'), 'android-otro');
  raise exception 'FALLÓ: siguió probando códigos';
exception when raise_exception then
  if sqlerrm like 'FALLÓ%' then raise; end if;
  if sqlerrm not like 'Demasiados intentos%' then raise; end if;
  raise notice 'ok - el sexto intento se rechaza (%)', sqlerrm;
end $$;
select pg_temp.verificar(
  (select count(*) = 0 from public.invitaciones_chofer), 'otro teléfono tampoco ve invitaciones');
select pg_temp.verificar(public.mi_viaje() is null, 'otro teléfono no tiene viaje');
reset role;
select pg_temp.verificar(
  (select dispositivo_id = 'android-chofer-1' and usado_por = :'chofer_id' from public.invitaciones_chofer where codigo = :'codigo'),
  'el código sigue ligado al primer teléfono');
select pg_temp.verificar(
  (select count(*) = 1 from public.eventos where asignacion_id = :'asig_id' and detalle ->> 'motivo' = 'activacion'),
  'despacho ve en los eventos que el código se activó');
select set_config('request.jwt.claims', json_build_object('sub', :'gerencia_id')::text, false) \g /dev/null
set role authenticated;
select pg_temp.verificar((select count(*) = 0 from public.invitaciones_chofer), 'gerencia no ve los códigos de invitación');
reset role;

-- ---------- Chofer envía un lote que cruza la frontera ----------
select set_config('request.jwt.claims', json_build_object('sub', :'chofer_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
select public.registrar_posiciones(:'asig_id', jsonb_build_array(
  jsonb_build_array((:t0 - 30000), -1980500, -6395600,  5, 10, 0),  -- dentro de la fábrica
  jsonb_build_array((:t0 - 29400), -1975000, -6390000, 60, 10, 0),  -- salió: en_ruta
  jsonb_build_array((:t0 - 1800), -1656700, -6903800,  8, 15, 0),  -- Desaguadero: en_frontera
  jsonb_build_array((:t0 - 1200), -1655000, -6907000, 30, 12, 0),  -- lado peruano, fuera de la geocerca (candidato a cruce)
  jsonb_build_array((:t0 - 900),  -1653000, -6910000, 40, 10, 0),  -- 5 min después sigue en Perú: se confirma el cruce
  jsonb_build_array((:t0 - 600),  9999999, -6907000, 30, 12, 0),  -- latitud inválida: se descarta
  jsonb_build_array(1, 2, 3),                                                                                -- mal formado: se descarta
  jsonb_build_array('x', -1600000, -6950000, 30, 12, 0),                                                     -- texto en vez de número: se descarta sin rechazar el lote
  jsonb_build_array((:t0 - 40000), -1980500, -6395600, 0, 10, 0)                                             -- antes de "Iniciar viaje": se descarta (privacidad)
)) as r \gset
select pg_temp.verificar((:'r'::jsonb ->> 'nuevas')::int = 5, 'se guardan 5 posiciones válidas');
select pg_temp.verificar((:'r'::jsonb ->> 'descartadas')::int = 4, 'se informan 4 descartadas (inválida, mal formadas y previa al viaje)');
select pg_temp.verificar((:'r'::jsonb ->> 'etapa') = 'cruzo_frontera', 'geocercas: fábrica → en ruta → frontera → cruzó');
select pg_temp.verificar((:'r'::jsonb ->> 'modo_peru')::boolean, 'la app pasa a modo Perú');

select pg_temp.verificar(
  (public.registrar_posiciones(:'asig_id', jsonb_build_array(
     jsonb_build_array((:t0 - 1200), -1655000, -6907000, 30, 12, 0))) ->> 'nuevas')::int = 0,
  'un lote reenviado no duplica posiciones');

-- Un salto imposible (260 km en 50 s) se guarda como evidencia pero no mueve el mapa.
select public.registrar_posiciones(:'asig_id', jsonb_build_array(
  jsonb_build_array((:t0 - 850), -1640900, -7153750, 60, 10, 0))) \g /dev/null
select public.registrar_posiciones(:'asig_id', jsonb_build_array(
  jsonb_build_array((:t0 - 300), -1600000, -6950000, 50, 5, 1))) \g /dev/null
reset role;

select pg_temp.verificar((select etapa = 'cruzo_frontera' from public.misiones where id = :'mision_id'), 'la etapa de la misión sigue al camión');
select pg_temp.verificar((select count(*) = 3 from public.eventos where asignacion_id = :'asig_id' and origen = 'geocerca'), 'tres cambios de etapa por geocerca registrados');
select pg_temp.verificar((select count(*) = 1 from public.eventos where tipo = 'incidencia' and detalle ->> 'motivo' = 'ubicacion_simulada'), 'ubicación simulada registrada como incidencia');
select pg_temp.verificar((select count(*) = 1 from public.eventos where tipo = 'incidencia' and detalle ->> 'motivo' = 'salto_ubicacion'), 'salto imposible registrado como incidencia');
select pg_temp.verificar((select ultima_senal = to_timestamp(:t0 - 900) and ultima_lat < -16.3 from public.asignaciones where id = :'asig_id'), 'el mapa muestra la última posición real (no la simulada)');
select pg_temp.verificar(
  (select ocurrido_en = to_timestamp(:t0 - 1200) from public.eventos where asignacion_id = :'asig_id' and etapa_nueva = 'cruzo_frontera'),
  'el cruce se fecha cuando el camión salió de la frontera (no al confirmarse)');

-- ---------- Emergencia ----------
select set_config('request.jwt.claims', json_build_object('sub', :'chofer_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
select pg_temp.verificar(
  not (public.reportar_emergencia(:'asig_id', 'mecanica', -16.4, -69.2) ->> 'repetida')::boolean,
  'el chofer reporta una emergencia');
select pg_temp.verificar(
  (public.reportar_emergencia(:'asig_id', 'mecanica', -16.4, -69.2) ->> 'repetida')::boolean,
  'pulsar dos veces no duplica la emergencia');
select set_config('prueba.asig', :'asig_id', false) \g /dev/null
do $$ begin
  perform public.reportar_emergencia(current_setting('prueba.asig')::uuid, 'inventado');
  raise exception 'FALLÓ: aceptó un motivo inválido';
exception when raise_exception then
  if sqlerrm like 'FALLÓ%' then raise; end if;
  raise notice 'ok - motivo de emergencia validado';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'extrano_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
do $$ begin
  perform public.reportar_emergencia(current_setting('prueba.asig')::uuid, 'robo');
  raise exception 'FALLÓ: otro teléfono reportó una emergencia';
exception when insufficient_privilege then raise notice 'ok - otro teléfono no puede reportar emergencias';
end $$;
reset role;
select pg_temp.verificar(
  (select emergencia_motivo = 'mecanica' and emergencia_en is not null from public.asignaciones where id = :'asig_id'),
  'la emergencia queda visible en el tablero');
select pg_temp.verificar(
  (select count(*) = 1 from public.eventos where asignacion_id = :'asig_id' and tipo = 'emergencia' and detalle ? 'lat'),
  'una sola emergencia registrada, con ubicación');

select set_config('request.jwt.claims', json_build_object('sub', :'gerencia_id')::text, false) \g /dev/null
set role authenticated;
do $$ begin
  perform public.atender_emergencia(current_setting('prueba.asig')::uuid, 'llamé al chofer');
  raise exception 'FALLÓ: gerencia atendió una emergencia';
exception when insufficient_privilege then raise notice 'ok - gerencia no atiende emergencias';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id')::text, false) \g /dev/null
set role authenticated;
do $$ begin
  perform public.atender_emergencia(current_setting('prueba.asig')::uuid, '  ');
  raise exception 'FALLÓ: atendió sin nota';
exception when raise_exception then
  if sqlerrm like 'FALLÓ%' then raise; end if;
  raise notice 'ok - atender exige una nota';
end $$;
select public.atender_emergencia(:'asig_id', 'Se envió mecánico') \g /dev/null
reset role;
select pg_temp.verificar(
  (select emergencia_en is null from public.asignaciones where id = :'asig_id'), 'despacho marca la emergencia como atendida');

-- ---------- Despacho ve el recorrido ----------
select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id')::text, false) \g /dev/null
set role authenticated;
select pg_temp.verificar((select count(*) = 7 from public.recorrido_asignacion(:'asig_id')), 'despacho obtiene el recorrido');
select pg_temp.verificar(
  (select count(*) between 2 and 5 from public.recorrido_simplificado(:'asig_id')),
  'recorrido simplificado: solo puntos reales, sin duplicar');
select pg_temp.verificar(
  (select round(lat::numeric, 3) = -19.805 from public.recorrido_simplificado(:'asig_id') limit 1),
  'el recorrido simplificado empieza en la fábrica');
reset role;

-- ---------- Entrega y cierre del acceso ----------
select set_config('request.jwt.claims', json_build_object('sub', :'chofer_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
select public.marcar_etapa_chofer(:'asig_id', 'entregado') \g /dev/null
select pg_temp.verificar(public.mi_viaje() is null, 'tras entregar, el chofer ya no tiene viaje activo');
-- Último tramo que quedó sin enviar (sin señal en el destino) y un punto posterior a la entrega.
select public.registrar_posiciones(:'asig_id', jsonb_build_array(
  jsonb_build_array((:t0 - 100), -1584000, -7002000, 0, 5, 0),
  jsonb_build_array(extract(epoch from now())::bigint + 120, -1584000, -7002000, 0, 5, 0))) as r \gset
select pg_temp.verificar(not (:'r'::jsonb ->> 'rastrear')::boolean, 'tras entregar, el servidor pide apagar el GPS');
select pg_temp.verificar((:'r'::jsonb ->> 'nuevas')::int = 1, 'tras entregar se acepta el último tramo anterior a la entrega, no lo posterior');
reset role;
select pg_temp.verificar((select etapa = 'entregado' from public.misiones where id = :'mision_id'), 'misión entregada');
select pg_temp.verificar((select count(*) = 8 from public.posiciones where asignacion_id = :'asig_id'), 'no se guardan posiciones posteriores a la entrega');

-- Un lote atrasado o una geocerca ya no puede reabrir un viaje entregado.
select pg_temp.verificar(
  public.aplicar_etapa(:'asig_id', 'en_frontera', 'geocerca') = 'entregado',
  'la geocerca no hace retroceder la etapa');
select pg_temp.verificar(
  public.aplicar_etapa(:'asig_id', 'en_ruta', 'chofer') = 'entregado',
  'el chofer no hace retroceder la etapa');

-- Otro teléfono anónimo no puede subir el último tramo.
select set_config('request.jwt.claims', json_build_object('sub', :'extrano_id', 'is_anonymous', true)::text, false) \g /dev/null
set role authenticated;
do $$ begin
  perform public.registrar_posiciones((select id from public.asignaciones limit 1), '[]'::jsonb);
  raise exception 'FALLÓ: otro teléfono subió posiciones';
exception when insufficient_privilege then raise notice 'ok - otro teléfono no puede subir posiciones';
end $$;
reset role;

-- ---------- Cruce a Perú sin detenerse en la frontera (con histéresis) ----------
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id)
select :'mision_id', transportista_id, conductor_id, vehiculo_id from public.asignaciones where id = :'asig_id'
returning id as asig2 \gset
select public.aplicar_etapa(:'asig2', 'cargado', 'despacho', to_timestamp(:t0 - 3000)) \g /dev/null
select public.aplicar_etapa(:'asig2', 'en_ruta', 'despacho', to_timestamp(:t0 - 2900)) \g /dev/null
create function pg_temp.punto(lat double precision, lon double precision) returns extensions.geography
language sql as $$ select extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography $$;

select pg_temp.verificar(public.evaluar_geocercas(:'asig2', pg_temp.punto(-16.40, -69.20), to_timestamp(:t0 - 2000), 10) = 'en_ruta',
  'un solo punto del lado peruano no basta para marcar el cruce');
select pg_temp.verificar(public.evaluar_geocercas(:'asig2', pg_temp.punto(-16.70, -68.90), to_timestamp(:t0 - 1950), 10) = 'en_ruta',
  'un salto del GPS de vuelta a Bolivia anula el candidato');
select pg_temp.verificar((select cruce_candidato_desde is null from public.asignaciones where id = :'asig2'), 'candidato a cruce anulado');
select pg_temp.verificar(public.evaluar_geocercas(:'asig2', pg_temp.punto(-16.40, -69.20), to_timestamp(:t0 - 1900), 10) = 'en_ruta',
  'nuevo candidato a cruce');
select pg_temp.verificar(public.evaluar_geocercas(:'asig2', pg_temp.punto(-16.30, -69.35), to_timestamp(:t0 - 1500), 10) = 'en_ruta',
  'a los 6 min todavía no se confirma');
select pg_temp.verificar(public.evaluar_geocercas(:'asig2', pg_temp.punto(-16.20, -69.50), to_timestamp(:t0 - 1250), 10) = 'cruzo_frontera',
  'tras 10 min en Perú se marca «Cruzó a Perú» aunque no se detuvo en la frontera');
select pg_temp.verificar(
  (select detalle ->> 'motivo' = 'cruce_sin_parada' and ocurrido_en = to_timestamp(:t0 - 1900)
     from public.eventos where asignacion_id = :'asig2' and etapa_nueva = 'cruzo_frontera'),
  'el evento explica que cruzó sin parar y lleva la hora real del cruce');

-- ---------- Mantenimiento mensual ----------
select public.guardar_resumen_recorrido(:'asig_id') \g /dev/null
select pg_temp.verificar(
  (select puntos = 6 and km > 600 and inicio = to_timestamp(:t0 - 30000) from public.resumenes_recorrido where asignacion_id = :'asig_id'),
  'el resumen del viaje guarda puntos reales y kilómetros (sin el salto imposible)');
select public.mantenimiento_mensual() as m \gset
select pg_temp.verificar((:'m'::jsonb ->> 'meses_borrados')::int = 0, 'no se borran meses recientes');
select pg_temp.verificar(to_regclass('public.posiciones_' || to_char(now() + interval '23 months', 'YYYY_MM')) is not null,
  'se crean particiones para los próximos 24 meses');
-- Un mes de hace 2 años se borra, con el resumen guardado antes.
select public.crear_particiones_posiciones((date_trunc('month', now()) - interval '24 months')::date, 1) \g /dev/null
insert into public.posiciones (asignacion_id, capturado_en, punto)
values (:'asig2', date_trunc('month', now()) - interval '24 months' + interval '1 day',
        extensions.st_setsrid(extensions.st_makepoint(-69.2, -16.4), 4326)::extensions.geography);
select pg_temp.verificar((public.mantenimiento_mensual() ->> 'meses_borrados')::int = 1, 'se borra el mes con más de 12 meses');
select pg_temp.verificar(exists (select 1 from public.resumenes_recorrido where asignacion_id = :'asig2'), 'antes de borrar se guarda el resumen del viaje');

-- ---------- Chofer o camión ocupado ----------
select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id')::text, false) \g /dev/null
set role authenticated;
select pg_temp.verificar(
  (select count(*) >= 1 from public.viajes_activos_de(
     (select conductor_id from public.asignaciones where id = :'asig2'),
     (select vehiculo_id from public.asignaciones where id = :'asig2'))),
  'despacho ve si el chofer o el camión ya están en otro viaje activo');
reset role;

-- =====================================================================
-- Fase 1 (revisión externa)
-- =====================================================================

-- ---------- 1.1 Teléfonos en formato internacional ----------
select pg_temp.verificar(public.normalizar_telefono('67601782') = '+59167601782', 'celular boliviano de 8 dígitos pasa a +591');
select pg_temp.verificar(public.normalizar_telefono('987 654 321') = '+51987654321', 'celular peruano de 9 dígitos pasa a +51');
select pg_temp.verificar(public.normalizar_telefono('00591-7123-4567') = '+59171234567', 'prefijo 00 y guiones se limpian');
select pg_temp.verificar(public.normalizar_telefono('+591 7123 4567') = '+59171234567', 'número con +591 y espacios');
select pg_temp.verificar(public.normalizar_telefono('55454545') is null, 'un número ambiguo no se adivina');
select pg_temp.verificar(public.normalizar_telefono('5454545') is null, 'un número de 7 dígitos no se adivina');
select pg_temp.verificar(public.normalizar_telefono('+5916760178') is null, '+591 con dígitos de menos no es válido');

select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id')::text, false) \g /dev/null
set role authenticated;
insert into public.conductores (transportista_id, nombre, telefono)
select id, 'Chofer nuevo', '7654 3210' from public.transportistas limit 1;
select pg_temp.verificar((select telefono = '+59176543210' from public.conductores where nombre = 'Chofer nuevo'),
  'al guardar, el teléfono se guarda con código de país');
do $$ begin
  insert into public.clientes (razon_social, pais, whatsapp) values ('Cliente con número dudoso', 'PE', '55454545');
  raise exception 'FALLÓ: se guardó un WhatsApp sin código de país';
exception when check_violation then raise notice 'ok - un número sin código de país que no se puede deducir se rechaza';
end $$;
reset role;
-- Un número antiguo que no se pudo corregir no bloquea otras ediciones del registro.
alter table public.clientes disable trigger clientes_telefono;
update public.clientes set whatsapp = '55454545' where razon_social = 'Cliente de prueba S.A.C.';
alter table public.clientes enable trigger clientes_telefono;
set role authenticated;
update public.clientes set contacto = 'Otro contacto' where razon_social = 'Cliente de prueba S.A.C.';
select pg_temp.verificar(
  (select count(*) = 1 from public.telefonos_por_corregir() where valor = '55454545'),
  'el número antiguo dudoso aparece en la lista para corregir y no impide editar otros datos');
reset role;

-- ---------- 1.2 Orden de los eventos (caso MSN-RWRE4TTQ) ----------
select now() - interval '1 second' as ahora \gset
-- El chofer pulsa «Iniciar viaje» (hora del servidor) y el primer punto GPS es de 3 min antes.
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id)
select :'mision_id', transportista_id, conductor_id, vehiculo_id from public.asignaciones where id = :'asig_id'
returning id as asig3 \gset
select public.aplicar_etapa(:'asig3', 'cargado', 'chofer', :'ahora'::timestamptz,
  jsonb_build_object('hora_dispositivo', :'ahora'::timestamptz - interval '2 seconds')) \g /dev/null
select pg_temp.verificar(
  (select hora_dispositivo = :'ahora'::timestamptz - interval '2 seconds' and creado_en >= :'ahora'::timestamptz from public.eventos
    where asignacion_id = :'asig3' and etapa_nueva = 'cargado'),
  'el evento guarda la hora del teléfono y la del servidor');
-- Primer punto a 235 km de la fábrica (cerca de Yacuiba): alerta, no «En ruta».
select public.evaluar_geocercas(:'asig3', pg_temp.punto(-21.9215, -63.6452), :'ahora'::timestamptz - interval '3 minutes', 20) as e \gset
select pg_temp.verificar(:'e' = 'cargado', 'si el viaje empieza a más de 20 km de la fábrica no se marca «En ruta»');
select pg_temp.verificar(
  (select (detalle ->> 'km')::int between 230 and 245 from public.eventos
    where asignacion_id = :'asig3' and detalle ->> 'motivo' = 'inicio_lejos_de_origen'),
  'queda una alerta «inició lejos de la fábrica» con la distancia');
insert into public.posiciones (asignacion_id, capturado_en, punto)
values (:'asig3', :'ahora'::timestamptz - interval '3 minutes', pg_temp.punto(-21.9215, -63.6452));
-- Dos puntos seguidos fuera de la fábrica, con hora del GPS anterior a «Iniciar viaje».
select public.evaluar_geocercas(:'asig3', pg_temp.punto(-19.83, -63.99), :'ahora'::timestamptz - interval '2 minutes', 15) as e \gset
select pg_temp.verificar(:'e' = 'cargado', 'un solo punto fuera de la fábrica todavía no marca «En ruta»');
select public.evaluar_geocercas(:'asig3', pg_temp.punto(-19.84, -64.00), :'ahora'::timestamptz - interval '1 minute', 15) as e \gset
select pg_temp.verificar(:'e' = 'en_ruta', 'el segundo punto seguido fuera de la fábrica marca «En ruta»');
select pg_temp.verificar(
  (select r.ocurrido_en >= c.ocurrido_en and r.hora_dispositivo = :'ahora'::timestamptz - interval '2 minutes'
          and (r.detalle ->> 'hora_ajustada')::boolean
     from public.eventos r, public.eventos c
    where r.asignacion_id = :'asig3' and r.etapa_nueva = 'en_ruta'
      and c.asignacion_id = :'asig3' and c.etapa_nueva = 'cargado'),
  '«En ruta» ya no queda antes de «Cargado»; la hora del GPS se conserva aparte');
-- Un punto que vuelve a la fábrica anula el candidato de salida.
select public.aplicar_etapa(:'asig3', 'cargado', 'despacho') \g /dev/null
select public.evaluar_geocercas(:'asig3', pg_temp.punto(-19.85, -64.01), :'ahora'::timestamptz, 15) \g /dev/null
select public.evaluar_geocercas(:'asig3', pg_temp.punto(-19.805, -63.956), :'ahora'::timestamptz, 15) \g /dev/null
select pg_temp.verificar((select salida_candidata_desde is null and etapa = 'cargado' from public.asignaciones where id = :'asig3'),
  'si el siguiente punto vuelve a la fábrica, no se marca la salida');

-- ---------- 1.3 Camión detenido ----------
update public.asignaciones set ultima_lat = -19.8088, ultima_lon = -63.9829, ultima_senal = :'ahora'::timestamptz - interval '4 hours'
 where id = :'asig3';
update public.asignaciones set ultima_lat = -19.8091, ultima_lon = -63.9828, ultima_senal = :'ahora'::timestamptz - interval '10 minutes'
 where id = :'asig3';
select pg_temp.verificar(
  (select detenido_desde = :'ahora'::timestamptz - interval '4 hours' from public.asignaciones where id = :'asig3'),
  'moverse menos de 300 m no reinicia el «detenido desde»');
update public.asignaciones set ultima_lat = -19.8200, ultima_lon = -63.9829, ultima_senal = :'ahora'::timestamptz
 where id = :'asig3';
select pg_temp.verificar(
  (select detenido_desde = :'ahora'::timestamptz from public.asignaciones where id = :'asig3'),
  'al moverse más de 300 m el contador de detenido se reinicia');
select pg_temp.verificar((select (valor)::int = 30 from public.configuracion where clave = 'detenido_minutos'),
  'el aviso de detenido es a los 30 minutos por defecto');
select set_config('request.jwt.claims', json_build_object('sub', :'gerencia_id')::text, false) \g /dev/null
set role authenticated;
do $$ begin
  perform public.fijar_minutos_detenido(45);
  raise exception 'FALLÓ: gerencia cambió los minutos de detenido';
exception when insufficient_privilege then raise notice 'ok - gerencia no cambia la configuración';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'despacho_id')::text, false) \g /dev/null
set role authenticated;
select public.fijar_minutos_detenido(45) \g /dev/null
select pg_temp.verificar((select (valor)::int = 45 from public.configuracion where clave = 'detenido_minutos'),
  'despacho puede cambiar los minutos de detenido');
reset role;
