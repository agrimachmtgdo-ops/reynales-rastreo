-- Operador de transbordo: solo ve y modifica lo de su empresa.
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

-- ---------- Cuentas ----------
insert into auth.users (email) values ('admin3@reynales.test') returning id as admin_id \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'admin_id';
insert into auth.users (email) values ('despacho3@reynales.test') returning id as desp_id \gset
update public.usuarios set activo = true, rol = 'despacho' where id = :'desp_id';
insert into auth.users (email) values ('operador@elalto.test') returning id as op_id \gset
insert into auth.users (email) values ('otro@elalto.test') returning id as op2_id \gset

insert into public.transportistas (razon_social) values ('Transbordos Senkata') returning id as t_op \gset
insert into public.transportistas (razon_social) values ('Otra empresa El Alto') returning id as t_otra \gset
insert into public.vehiculos (transportista_id, placa) values (:'t_otra', '9999ZZZ');

-- Misión a Perú con transbordo por Transbordos Senkata, y otra que no es suya.
insert into public.misiones (cliente_id, origen_id, destino_id, factura)
select (select id from public.clientes limit 1), (select id from public.ubicaciones where tipo = 'fabrica'),
       (select id from public.ubicaciones where nombre = 'Puno'), 'F-OPE'
returning id as mision \gset
insert into public.misiones (cliente_id, origen_id, destino_id, factura)
select (select id from public.clientes limit 1), (select id from public.ubicaciones where tipo = 'fabrica'),
       (select id from public.ubicaciones where nombre = 'Puno'), 'F-AJENA'
returning id as ajena \gset
insert into public.tramos (mision_id, numero, transportista_id, lugar_inicio) values (:'mision', 2, :'t_op', 'Senkata');
insert into public.tramos (mision_id, numero, transportista_id) values (:'ajena', 2, :'t_otra');
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
select :'mision', t.id, c.id, v.id, 28
  from public.transportistas t join public.conductores c on c.transportista_id = t.id
  join public.vehiculos v on v.transportista_id = t.id
 where t.razon_social = 'Transportes de prueba' limit 1
returning id as camion1 \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
select :'ajena', transportista_id, conductor_id, vehiculo_id, 10 from public.asignaciones where id = :'camion1'
returning id as camion_ajeno \gset

-- ---------- Alta del operador (solo administrador) ----------
select pg_temp.como(:'desp_id');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.registrar_operador(%L, %L, %L)', 'operador@elalto.test', 'Juan', :'t_op')) like 'Solo un administrador%',
  'despacho no puede crear operadores');
reset role;
select pg_temp.como(:'admin_id');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.registrar_operador(%L, %L, %L)', 'nadie@elalto.test', 'X', :'t_op')) like 'No existe una cuenta%',
  'un correo sin cuenta se rechaza con instrucciones');
select pg_temp.verificar(
  pg_temp.error_de(format('select public.registrar_operador(%L, %L, %L)', 'despacho3@reynales.test', 'X', :'t_op')) like 'Ese correo es de personal activo%',
  'una cuenta de personal activo no puede ser operador');
select public.registrar_operador('Operador@ElAlto.test', 'Juan Mamani', :'t_op', '+59170000009') \g /dev/null
select public.registrar_operador('otro@elalto.test', 'Pedro', :'t_otra') \g /dev/null
select pg_temp.verificar(
  pg_temp.error_de(format('select public.registrar_operador(%L, %L, %L)', 'otro@elalto.test', 'Pedro', :'t_otra')) like 'Esa cuenta ya es operador%',
  'no se duplica un operador');
select pg_temp.verificar(
  pg_temp.error_de(format('update public.usuarios set activo = true where id = %L', :'op_id')) like 'Esta cuenta es de un operador%',
  'una cuenta de operador no se puede activar como personal');
reset role;

-- ---------- Lo que ve el operador ----------
select pg_temp.como(:'op_id');
set role authenticated;
select pg_temp.verificar(public.mi_operador() ->> 'empresa' = 'Transbordos Senkata', 'el operador ve su nombre y empresa');
select pg_temp.verificar((select count(*) from public.misiones) = 0, 'el operador no lee las tablas (misiones)');
select pg_temp.verificar((select count(*) from public.asignaciones) = 0, 'el operador no lee las tablas (camiones)');
select pg_temp.verificar(
  jsonb_array_length(public.operador_mis_cargas()) = 1
    and public.operador_mis_cargas() -> 0 ->> 'factura' is null
    and public.operador_mis_cargas() -> 0 ->> 'id' = :'mision',
  'en «Mis cargas» aparece solo la misión de su empresa');
select pg_temp.verificar(
  pg_temp.error_de(format('select public.operador_carga(%L)', :'ajena')) like 'Esta carga no está asignada%',
  'no puede abrir la carga de otra empresa');
select pg_temp.verificar(
  (public.operador_carga(:'mision') ->> 'factura') = 'F-OPE'
    and jsonb_array_length(public.operador_carga(:'mision') -> 'llegan') = 1
    and (public.operador_carga(:'mision') ->> 'toneladas_fabrica')::numeric = 28,
  'el detalle muestra factura, camiones que llegan y toneladas de fábrica');
select pg_temp.verificar(
  pg_temp.error_de(format('insert into public.conductores (transportista_id, nombre) values (%L, %L)', :'t_op', 'X')) is not null,
  'no puede escribir directo en las tablas');

-- Choferes y camiones propios.
select public.operador_guardar_conductor('Chofer Senkata', '+59171111111', '555111') as cond \gset
select pg_temp.verificar(public.operador_guardar_conductor('Otro nombre', '+59171111111', '555111') = :'cond',
  'un chofer con el mismo CI no se duplica');
select public.operador_guardar_vehiculo('4444 eee', 'Volvo', 30) as veh \gset
select public.operador_guardar_vehiculo('5555FFF') as veh2 \gset
select pg_temp.verificar(public.operador_guardar_vehiculo('4444EEE') = :'veh', 'una placa propia no se duplica');
select pg_temp.verificar(
  pg_temp.error_de('select public.operador_guardar_vehiculo(''9999ZZZ'')') like '%registrada a otra empresa%',
  'no puede usar la placa de otra empresa');
select pg_temp.verificar(jsonb_array_length(public.operador_catalogo() -> 'vehiculos') = 2, 'su catálogo tiene solo sus camiones');

-- Camiones del tramo 2.
select pg_temp.verificar(
  pg_temp.error_de(format('select * from public.operador_agregar_camion(%L, %L, %L, 14, %L)', :'mision', :'cond', :'veh', ' ')) like '%precinto%',
  'el precinto es obligatorio');
select asignacion_id as camion2, codigo from public.operador_agregar_camion(:'mision', :'cond', :'veh', 14, 'PR-001') \gset
select pg_temp.verificar(length(:'codigo') = 8, 'al agregar el camión se genera el código del chofer');
select pg_temp.verificar(
  pg_temp.error_de(format('select * from public.operador_agregar_camion(%L, %L, %L, 1, %L)', :'mision', :'cond', :'veh', 'X')) like 'Ese camión ya está registrado%',
  'no se registra dos veces el mismo camión');
select asignacion_id as camion3 from public.operador_agregar_camion(:'mision', :'cond', :'veh2', 14, 'PR-002') \gset
select pg_temp.verificar(
  pg_temp.error_de(format('select * from public.operador_agregar_camion(%L, %L, %L, 1, %L)', :'ajena', :'cond', :'veh2', 'X')) like 'Esta carga no está asignada%',
  'no puede agregar camiones a la carga de otra empresa');
select public.operador_corregir_camion(:'camion3', 13.9, 'PR-002B') \g /dev/null
select pg_temp.verificar(
  pg_temp.error_de(format('select public.operador_recibi_carga(%L)', :'camion1')) like 'Este camión todavía no inició%',
  'no puede recibir un camión que no salió de fábrica');
reset role;

select pg_temp.verificar(
  (select tramo = 2 and precinto = 'PR-001' and toneladas_declaradas = 14 and transportista_id = :'t_op'
     from public.asignaciones where id = :'camion2'),
  'el camión queda en el tramo 2 con precinto, toneladas y su empresa');
select pg_temp.verificar(
  exists (select 1 from public.eventos where asignacion_id = :'camion2' and detalle ->> 'motivo' = 'camion_registrado_por_operador'
            and detalle ->> 'operador' = 'Juan Mamani'),
  'despacho ve el aviso con el nombre del operador');
select pg_temp.verificar(
  (select precinto = 'PR-002B' and toneladas_declaradas = 13.9 from public.asignaciones where id = :'camion3'),
  'el operador corrige toneladas y precinto antes de salir');

-- Otra empresa no toca los camiones de esta.
select pg_temp.como(:'op2_id');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.operador_corregir_camion(%L, 1, %L)', :'camion2', 'X')) like 'Este camión no es de su empresa%',
  'otro operador no puede corregir camiones ajenos');
select pg_temp.verificar(
  pg_temp.error_de(format('select public.operador_recibi_carga(%L)', :'camion1')) like 'Este camión no entrega%',
  'otro operador no puede recibir la carga');
reset role;

-- ---------- Recibí la carga ----------
select public.aplicar_etapa(:'camion1', 'en_ruta', 'despacho') \g /dev/null
select pg_temp.como(:'op_id');
set role authenticated;
select pg_temp.verificar(public.operador_recibi_carga(:'camion1', 'llegó bien') = 'entregado',
  'el operador confirma «Recibí la carga» y el camión 1 queda entregado en transbordo');
reset role;
select pg_temp.verificar(
  exists (select 1 from public.eventos where asignacion_id = :'camion1' and etapa_nueva = 'entregado'
            and origen = 'sistema' and detalle ->> 'motivo' = 'recibido_en_transbordo'),
  'el evento dice que lo confirmó el operador');
select pg_temp.verificar((select etapa from public.misiones where id = :'mision') = 'en_ruta',
  'la misión sigue «En ruta» (la carga espera en el transbordo)');

-- ---------- Documentos ----------
select pg_temp.como(:'op_id');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('documentos', :'mision' || '/crt1.pdf');
insert into storage.objects (bucket_id, name) values ('documentos', :'mision' || '/mic1.jpg');
insert into storage.objects (bucket_id, name) values ('documentos', :'mision' || '/crt2.pdf');
select pg_temp.verificar(
  pg_temp.error_de(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'documentos', :'ajena' || '/x.pdf')) is not null,
  'no puede subir archivos a la carpeta de otra misión');
select pg_temp.verificar(
  pg_temp.error_de(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'documentos', 'sin-carpeta.pdf')) is not null,
  'no puede subir archivos fuera de una carpeta de misión');
select pg_temp.verificar(
  pg_temp.error_de(format('select public.operador_registrar_documento(%L, %L, %L, %L, %L)', :'mision', 'crt', :'mision' || '/crt1.pdf', 'crt.pdf', :'camion2')) like '%número del documento%',
  'el CRT necesita su número');
select pg_temp.verificar(
  pg_temp.error_de(format('select public.operador_registrar_documento(%L, %L, %L, %L, %L, %L)', :'mision', 'crt', :'mision' || '/noexiste.pdf', 'x.pdf', :'camion2', '1')) like 'El archivo no se subió%',
  'no se registra un archivo que no está en el almacenamiento');
select pg_temp.verificar(
  pg_temp.error_de(format('select public.operador_registrar_documento(%L, %L, %L, %L)', :'mision', 'factura', :'mision' || '/crt1.pdf', 'x.pdf')) like 'Desde el transbordo se suben%',
  'el operador no sube facturas');
select public.operador_registrar_documento(:'mision', 'crt', :'mision' || '/crt1.pdf', 'crt.pdf', :'camion2', 'CRT-1', 'application/pdf', 1000) as doc1 \gset
select public.operador_registrar_documento(:'mision', 'mic_dta', :'mision' || '/mic1.jpg', 'mic.jpg', :'camion2', 'MIC-1', 'image/jpeg', 900) \g /dev/null
select public.operador_registrar_documento(:'mision', 'crt', :'mision' || '/crt2.pdf', 'crt-corregido.pdf', :'camion2', 'CRT-1B', 'application/pdf', 1000, :'doc1') as doc2 \gset
select pg_temp.verificar(
  jsonb_array_length(public.operador_carga(:'mision') -> 'documentos') = 2,
  'el reemplazo deja visible solo la versión vigente (CRT nuevo + MIC)');
select pg_temp.verificar((select count(*) from storage.objects where name like :'ajena' || '%') = 0, 'no ve archivos de otras misiones');
select pg_temp.verificar((select count(*) from public.documentos) = 0, 'no lee la tabla de documentos directamente');
reset role;
select pg_temp.verificar((select reemplazado_por = :'doc2' from public.documentos where id = :'doc1'),
  'la versión anterior se conserva marcada como reemplazada');

-- ---------- Alerta de salida sin CRT/MIC ----------
select public.aplicar_etapa(:'camion2', 'cargado', 'despacho') \g /dev/null
select public.aplicar_etapa(:'camion2', 'en_ruta', 'despacho') \g /dev/null
select public.aplicar_etapa(:'camion3', 'cargado', 'despacho') \g /dev/null
select public.aplicar_etapa(:'camion3', 'en_ruta', 'despacho') \g /dev/null
select pg_temp.verificar(
  not exists (select 1 from public.eventos where asignacion_id = :'camion2' and detalle ->> 'motivo' = 'sin_documentos_transbordo'),
  'sin alerta si el camión salió con CRT y MIC');
select pg_temp.verificar(
  exists (select 1 from public.eventos where asignacion_id = :'camion3' and detalle ->> 'motivo' = 'sin_documentos_transbordo'
            and detalle -> 'faltan' = '["crt", "mic_dta"]'::jsonb),
  'alerta a despacho si un camión sale hacia Perú sin CRT ni MIC (sin bloquear)');
select pg_temp.verificar((select etapa from public.asignaciones where id = :'camion3') = 'en_ruta', 'la alerta no bloquea el viaje');

-- ---------- Personal y visitantes ----------
select pg_temp.como(:'desp_id');
set role authenticated;
select pg_temp.verificar((select count(*) from storage.objects where bucket_id = 'documentos') >= 3, 'despacho ve todos los archivos');
select pg_temp.verificar((select count(*) from public.operadores_transbordo) = 2, 'el personal ve la lista de operadores');
select pg_temp.verificar(
  pg_temp.error_de('update public.operadores_transbordo set activo = false') is null
    and (select count(*) from public.operadores_transbordo where not activo) = 0,
  'despacho no puede desactivar operadores (solo el administrador)');
reset role;
select pg_temp.como(:'admin_id');
set role authenticated;
update public.operadores_transbordo set activo = false where user_id = :'op2_id';
reset role;
select pg_temp.como(:'op2_id');
set role authenticated;
select pg_temp.verificar(
  pg_temp.error_de('select public.operador_mis_cargas()') like 'Su cuenta no está habilitada%',
  'un operador desactivado ya no entra');
reset role;
set role anon;
select pg_temp.verificar(
  pg_temp.error_de('select public.operador_mis_cargas()') like 'permission denied%',
  'un visitante sin sesión no puede llamar a las funciones del operador');
reset role;
