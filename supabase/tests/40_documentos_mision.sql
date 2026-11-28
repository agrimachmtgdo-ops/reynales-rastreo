-- Documentos al crear la misión: lista de empaque, factura oculta al operador,
-- registro de accesos, un solo ingreso de números y alerta al salir de fábrica.
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

-- ---------- Cuentas y datos ----------
insert into auth.users (email) values ('admin4@reynales.test') returning id as admin_id \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'admin_id';
insert into auth.users (email) values ('despacho4@reynales.test') returning id as desp_id \gset
update public.usuarios set activo = true, rol = 'despacho' where id = :'desp_id';
insert into auth.users (email) values ('operador4@elalto.test') returning id as op_id \gset
insert into public.transportistas (razon_social) values ('Transbordos Docs') returning id as t_op \gset
select pg_temp.como(:'admin_id');
set role authenticated;
select public.registrar_operador('operador4@elalto.test', 'Rosa Quispe', :'t_op') \g /dev/null
reset role;

-- Misión a Perú (sin factura ni DEX escritos) con transbordo, y otra a Bolivia.
insert into public.misiones (cliente_id, origen_id, destino_id)
select (select id from public.clientes limit 1), (select id from public.ubicaciones where tipo = 'fabrica'),
       (select id from public.ubicaciones where nombre = 'Puno')
returning id as peru \gset
insert into public.misiones (cliente_id, origen_id, destino_id, factura)
select (select id from public.clientes limit 1), (select id from public.ubicaciones where tipo = 'fabrica'),
       (select id from public.ubicaciones where nombre = 'La Paz'), 'F-ESCRITA'
returning id as bolivia \gset
insert into public.tramos (mision_id, numero, transportista_id) values (:'peru', 2, :'t_op');
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
select :'peru', t.id, c.id, v.id, 28
  from public.transportistas t join public.conductores c on c.transportista_id = t.id
  join public.vehiculos v on v.transportista_id = t.id
 where t.razon_social = 'Transportes de prueba' limit 1
returning id as camion_pe \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
select :'bolivia', transportista_id, conductor_id, vehiculo_id, 20 from public.asignaciones where id = :'camion_pe'
returning id as camion_bo \gset

-- ---------- Despacho sube los documentos al crear la misión ----------
select pg_temp.como(:'desp_id');
set role authenticated;
insert into storage.objects (bucket_id, name) values
  ('documentos', :'peru' || '/factura.pdf'), ('documentos', :'peru' || '/empaque.pdf'),
  ('documentos', :'peru' || '/origen.pdf'), ('documentos', :'peru' || '/huerfano.pdf');
insert into public.documentos (mision_id, tipo, numero, ruta_archivo, nombre_original)
values (:'peru', 'factura', ' 001-2345 ', :'peru' || '/factura.pdf', 'factura.pdf')
returning id as doc_factura \gset
insert into public.documentos (mision_id, tipo, etiqueta, ruta_archivo, nombre_original)
values (:'peru', 'otro', 'lista_empaque', :'peru' || '/empaque.pdf', 'empaque.pdf')
returning id as doc_empaque \gset
insert into public.documentos (mision_id, tipo, ruta_archivo, nombre_original)
values (:'peru', 'certificado_origen', :'peru' || '/origen.pdf', 'origen.pdf');
select pg_temp.verificar(
  pg_temp.error_de(format('insert into public.documentos (mision_id, tipo, etiqueta, ruta_archivo) values (%L, %L, %L, %L)',
    :'peru', 'factura', 'lista_empaque', :'peru' || '/empaque.pdf')) like '%documentos_etiqueta_valida%',
  'la etiqueta «Lista de empaque» solo va con el tipo «otro»');
select pg_temp.verificar(
  pg_temp.error_de(format('insert into public.documentos (mision_id, tipo, etiqueta, ruta_archivo) values (%L, %L, %L, %L)',
    :'peru', 'otro', 'cualquiera', :'peru' || '/empaque.pdf')) like '%documentos_etiqueta_valida%',
  'no se aceptan etiquetas desconocidas');
reset role;

-- ---------- Un solo ingreso ----------
select pg_temp.verificar((select factura from public.misiones where id = :'peru') = '001-2345',
  'el número de la factura completa el campo vacío de la misión');
insert into storage.objects (bucket_id, name) values ('documentos', :'bolivia' || '/f.pdf');
insert into public.documentos (mision_id, tipo, numero, ruta_archivo) values (:'bolivia', 'factura', 'F-OTRA', :'bolivia' || '/f.pdf');
select pg_temp.verificar((select factura from public.misiones where id = :'bolivia') = 'F-ESCRITA',
  'si el campo ya tenía número, no se pisa');

-- ---------- El operador no ve la factura ni el certificado de origen ----------
select pg_temp.como(:'op_id');
set role authenticated;
select pg_temp.verificar(
  (select array_agg(x ->> 'tipo' order by x ->> 'tipo') from jsonb_array_elements(public.operador_carga(:'peru') -> 'documentos') x)
    = array['otro'],
  'en su pantalla el operador ve la lista de empaque, pero no la factura ni el certificado de origen');
select pg_temp.verificar(
  (select x ->> 'etiqueta' from jsonb_array_elements(public.operador_carga(:'peru') -> 'documentos') x) = 'lista_empaque',
  'la lista de empaque llega con su etiqueta');
select pg_temp.verificar(
  (select count(*) from storage.objects where name = :'peru' || '/factura.pdf') = 0,
  'el operador no puede descargar el archivo de la factura');
select pg_temp.verificar(
  (select count(*) from storage.objects where name = :'peru' || '/huerfano.pdf') = 0,
  'tampoco ve archivos sin registrar que subió despacho');
select pg_temp.verificar(
  (select count(*) from storage.objects where name = :'peru' || '/empaque.pdf') = 1,
  'sí puede descargar la lista de empaque');
insert into storage.objects (bucket_id, name) values ('documentos', :'peru' || '/foto-op.jpg');
select pg_temp.verificar(
  (select count(*) from storage.objects where name = :'peru' || '/foto-op.jpg') = 1,
  've el archivo que acaba de subir él mismo (antes de registrarlo)');
select pg_temp.verificar(
  pg_temp.error_de(format('select public.abrir_documento(%L)', :'doc_factura')) like 'No tiene permiso%',
  'abrir la factura desde el operador se rechaza');
select pg_temp.verificar(
  (public.abrir_documento(:'doc_empaque') ->> 'ruta') = :'peru' || '/empaque.pdf',
  'el operador abre la lista de empaque');
select pg_temp.verificar(
  pg_temp.error_de(format('select public.abrir_documento(%L)', gen_random_uuid())) like 'El documento no existe%',
  'un documento inexistente da un mensaje claro');
reset role;

-- ---------- Registro de accesos ----------
select pg_temp.como(:'desp_id');
set role authenticated;
select pg_temp.verificar(
  (public.abrir_documento(:'doc_factura') ->> 'ruta') = :'peru' || '/factura.pdf',
  'despacho abre la factura');
select pg_temp.verificar(
  (select count(*) from public.descargas_documentos where documento_id = :'doc_factura' and usuario_id = :'desp_id' and operador_id is null) = 1,
  'queda registrado que despacho abrió la factura');
select pg_temp.verificar(
  (select count(*) from public.descargas_documentos d join public.operadores_transbordo o on o.id = d.operador_id
     where d.documento_id = :'doc_empaque' and o.nombre = 'Rosa Quispe' and d.usuario_id = :'op_id') = 1,
  'queda registrado que el operador abrió la lista de empaque');
select pg_temp.verificar(
  pg_temp.error_de(format('insert into public.descargas_documentos (documento_id) values (%L)', :'doc_factura')) is not null,
  'nadie escribe el registro de accesos a mano');
select pg_temp.verificar(
  (select count(*) from storage.objects where name = :'peru' || '/factura.pdf') = 1,
  'despacho sigue viendo todos los archivos');
reset role;
select pg_temp.verificar(
  pg_temp.error_de(format('select public.abrir_documento(%L)', :'doc_factura')) is not null
    or not has_function_privilege('anon', 'public.abrir_documento(uuid)', 'execute'),
  'un visitante sin sesión no puede abrir documentos');

-- ---------- Alerta al salir de fábrica sin documentos ----------
select public.aplicar_etapa(:'camion_pe', 'cargado', 'despacho') \g /dev/null
select pg_temp.verificar(
  exists (select 1 from public.eventos where asignacion_id = :'camion_pe' and tipo = 'incidencia'
            and detalle ->> 'motivo' = 'sin_documentos_carga' and detalle -> 'faltan' = '["dex"]'::jsonb),
  'alerta si el camión a Perú se carga sin DEX (la factura sí estaba)');
select pg_temp.verificar((select etapa from public.asignaciones where id = :'camion_pe') = 'cargado', 'la alerta no bloquea');
select public.aplicar_etapa(:'camion_pe', 'en_ruta', 'despacho') \g /dev/null
select pg_temp.verificar(
  (select count(*) from public.eventos e join public.asignaciones a on a.id = e.asignacion_id
     where a.mision_id = :'peru' and e.detalle ->> 'motivo' = 'sin_documentos_carga') = 1,
  'una sola alerta por misión');
select public.aplicar_etapa(:'camion_bo', 'cargado', 'despacho') \g /dev/null
select pg_temp.verificar(
  not exists (select 1 from public.eventos where asignacion_id = :'camion_bo' and detalle ->> 'motivo' = 'sin_documentos_carga'),
  'a Bolivia basta la factura: sin alerta');
