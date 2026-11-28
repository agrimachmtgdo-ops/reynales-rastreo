-- Ola 1 · Entrega 3: documentos nuevos y requisitos por cliente y destino.
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

insert into auth.users (email) values ('adm100@reynales.test') returning id as adm \gset
insert into auth.users (email) values ('log100@reynales.test') returning id as log \gset
insert into auth.users (email) values ('ger100@reynales.test') returning id as ger \gset
insert into auth.users (email) values ('com100@reynales.test') returning id as com \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'adm';
update public.usuarios set activo = true, rol = 'despacho' where id = :'log';
update public.usuarios set activo = true, rol = 'gerencia' where id = :'ger';
update public.usuarios set activo = true, rol = 'gerencia', area = 'comercial' where id = :'com';

insert into public.clientes (razon_social, pais) values ('Cliente 100', 'PE') returning id as cli \gset
insert into public.clientes (razon_social, pais) values ('Cliente 100 BO', 'BO') returning id as cli_bo \gset
select id as puno from public.ubicaciones where nombre = 'Puno' \gset
select id as lapaz from public.ubicaciones where nombre = 'La Paz' \gset
select id as fab from public.ubicaciones where tipo = 'fabrica' order by nombre limit 1 \gset
insert into public.transportistas (razon_social) values ('Trans 100') returning id as t1 \gset
insert into public.conductores (transportista_id, nombre) values (:'t1', 'Chofer 100') returning id as c1 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t1', '1000AAA') returning id as v1 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t1', '1000BBB') returning id as v2 \gset
-- Misión a Perú con transbordo (camión 1 en fábrica y camión 2 desde El Alto) y otra en Bolivia.
insert into public.misiones (cliente_id, origen_id, destino_id) values (:'cli', :'fab', :'puno') returning id as pe \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id) values (:'pe', :'t1', :'c1', :'v1') returning id as a1 \gset
insert into public.tramos (mision_id, numero, transportista_id) values (:'pe', 2, :'t1');
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, precinto)
  values (:'pe', :'t1', :'c1', :'v2', 2, 'P-100') returning id as a2 \gset
insert into public.misiones (cliente_id, origen_id, destino_id) values (:'cli_bo', :'fab', :'lapaz') returning id as bo \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id) values (:'bo', :'t1', :'c1', :'v1') returning id as b1 \gset

select pg_temp.verificar((select count(*) from public.requisitos_documentos where alcance <> 'cliente') = 5, 'arranca con las 5 reglas de hoy (factura, DEX, CRT, MIC/DTA) más la guía firmada');

-- Expediente según las reglas generales.
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar((select string_agg(documento || coalesce('@' || placa, ''), ',' order by documento, placa) from public.expediente_mision(:'pe'))
  = 'crt@1000BBB,dex,factura,guia_firmada@1000BBB,mic_dta@1000BBB', 'Perú con transbordo: factura y DEX de la misión; CRT, MIC/DTA y guía firmada del camión 2');
select pg_temp.verificar((select string_agg(documento || coalesce('@' || placa, ''), ',' order by documento) from public.expediente_mision(:'bo'))
  = 'factura,guia_firmada@1000AAA', 'Bolivia: factura y guía firmada del camión, sin DEX ni CRT');
select pg_temp.verificar(not exists (select 1 from public.expediente_mision(:'pe') where tiene), 'sin documentos, todo falta');
select pg_temp.verificar(pg_temp.error_de(format($$select public.fijar_requisito_cliente(%L, 'fitosanitario', 'exige')$$, :'cli')) like 'Solo el administrador, logística o comercial%', 'gerencia no cambia requisitos');
reset role;

-- Requisitos del cliente: exige fitosanitario y análisis; no requiere el DEX.
select pg_temp.como(:'com');
set role authenticated;
select public.fijar_requisito_cliente(:'cli', 'fitosanitario', 'exige') \g /dev/null
select public.fijar_requisito_cliente(:'cli', 'certificado_analisis', 'exige') \g /dev/null
select public.fijar_requisito_cliente(:'cli', 'dex', 'no_requerido') \g /dev/null
select pg_temp.verificar(pg_temp.error_de(format($$select public.fijar_requisito_cliente(%L, 'fitosanitario', 'quizas')$$, :'cli')) like 'Elija si%', 'estado de requisito inválido');
reset role;
select pg_temp.verificar((select momento from public.requisitos_documentos where cliente_id = :'cli' and documento = 'fitosanitario') = 'salida_fabrica', 'el fitosanitario se pide al salir de fábrica');
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar((select string_agg(documento, ',' order by documento) from public.expediente_mision(:'pe') where momento = 'salida_fabrica')
  = 'certificado_analisis,factura,fitosanitario', 'el cliente agrega fitosanitario y análisis y quita el DEX');
select pg_temp.verificar((select count(*) from public.expediente_mision(:'bo') where documento = 'fitosanitario') = 0, 'otro cliente no los exige');
reset role;

-- Documentos nuevos con etiqueta (tipo «otro»).
select pg_temp.como(:'log');
set role authenticated;
insert into public.documentos (mision_id, tipo, etiqueta, ruta_archivo, nombre_original) values (:'pe', 'otro', 'fitosanitario', :'pe' || '/f.pdf', 'fito.pdf');
select pg_temp.verificar(pg_temp.error_de(format($$insert into public.documentos (mision_id, tipo, etiqueta, ruta_archivo, nombre_original) values (%L, 'otro', 'cualquiera', %L, 'x')$$, :'pe', :'pe' || '/x1')) like '%documentos_etiqueta_valida%', 'una etiqueta desconocida se rechaza');
select pg_temp.verificar(pg_temp.error_de(format($$insert into public.documentos (mision_id, tipo, etiqueta, ruta_archivo, nombre_original) values (%L, 'factura', 'bl', %L, 'x')$$, :'pe', :'pe' || '/x2')) like '%documentos_etiqueta_valida%', 'la etiqueta va solo en el tipo «otro»');
reset role;
select pg_temp.verificar((select tiene from public.expediente_calcular(:'pe') where documento = 'fitosanitario'), 'el fitosanitario subido cuenta en el expediente');

-- Alerta al salir de fábrica: faltan factura y análisis (el fitosanitario ya está; el DEX no se pide).
select public.aplicar_etapa(:'a1', 'cargado', 'chofer', now()) \g /dev/null
select pg_temp.verificar((select detalle -> 'faltan' from public.eventos where asignacion_id = :'a1' and detalle ->> 'motivo' = 'sin_documentos_carga')
  = '["certificado_analisis", "factura"]'::jsonb, 'la alerta de salida lista los faltantes según el cliente');

-- Salida del transbordo: un CRT de toda la misión vale para el camión; falta el MIC/DTA.
insert into public.documentos (mision_id, tipo, numero, ruta_archivo, nombre_original) values (:'pe', 'crt', 'CRT-1', :'pe' || '/c.pdf', 'crt.pdf');
update public.asignaciones set etapa = 'en_ruta' where id = :'a2';
select pg_temp.verificar((select detalle -> 'faltan' from public.eventos where asignacion_id = :'a2' and detalle ->> 'motivo' = 'sin_documentos_transbordo')
  = '["mic_dta"]'::jsonb, 'al salir del transbordo falta solo el MIC/DTA del camión');

-- Volver a la regla general.
select pg_temp.como(:'log');
set role authenticated;
select public.fijar_requisito_cliente(:'cli', 'dex', null) \g /dev/null
reset role;
select pg_temp.verificar(exists (select 1 from public.expediente_calcular(:'pe') where documento = 'dex'), 'sin la excepción del cliente vuelve a pedirse el DEX');

-- Reglas generales: solo el administrador.
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de($$select public.guardar_requisito_general('certificado_origen', 'pais', 'PE', true)$$) like 'Solo el administrador%', 'logística no cambia reglas generales');
reset role;
select pg_temp.como(:'adm');
set role authenticated;
select public.guardar_requisito_general('certificado_origen', 'pais', 'pe', true) \g /dev/null
select pg_temp.verificar(exists (select 1 from public.expediente_mision(:'pe') where documento = 'certificado_origen'), 'regla por país: Perú exige certificado de origen');
select pg_temp.verificar(not exists (select 1 from public.expediente_mision(:'bo') where documento = 'certificado_origen'), 'Bolivia no');
select public.guardar_requisito_general('certificado_origen', 'pais', 'PE', false) \g /dev/null
select pg_temp.verificar(not exists (select 1 from public.expediente_mision(:'pe') where documento = 'certificado_origen'), 'una regla desactivada deja de pedirse');
select pg_temp.verificar(pg_temp.error_de(format($$insert into public.requisitos_documentos (documento, momento, alcance) values ('bl', 'embarque', 'todos')$$)) is not null, 'la tabla no se escribe directo');
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.verificar(pg_temp.error_de(format($$select * from public.expediente_mision(%L)$$, :'pe')) is not null, 'un visitante sin sesión no ve el expediente');
reset role;

select 'ok - 100_requisitos_documentos';
