-- Ola 1 · Entrega 2: perfil almacén, inspección del camión, cierre de carga con precinto y bloqueos.
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

insert into auth.users (email) values ('adm99@reynales.test') returning id as adm \gset
insert into auth.users (email) values ('alm99@reynales.test') returning id as alm \gset
insert into auth.users (email) values ('ger99@reynales.test') returning id as ger \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'adm';
update public.usuarios set activo = true, rol = 'gerencia' where id = :'ger';
update public.usuarios set activo = true, nombre = 'Alma' where id = :'alm';

insert into public.clientes (razon_social, pais) values ('Cliente 99', 'PE') returning id as cli \gset
select id as dest from public.ubicaciones where nombre = 'Puno' \gset
select id as fab from public.ubicaciones where tipo = 'fabrica' order by nombre limit 1 \gset
insert into public.productos (nombre, presentacion) values ('Harina 99', 'Sacos de 50 kg') returning id as prod \gset
insert into public.transportistas (razon_social) values ('Trans 99') returning id as t1 \gset
insert into public.conductores (transportista_id, nombre) values (:'t1', 'Chofer 99') returning id as c1 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t1', '9999ABC') returning id as v1 \gset
insert into public.misiones (cliente_id, origen_id, destino_id, producto_id, factura)
  values (:'cli', :'fab', :'dest', :'prod', 'F-99') returning id as m1 \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id)
  values (:'m1', :'t1', :'c1', :'v1') returning id as a1 \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id)
  values (:'m1', :'t1', :'c1', :'v1') returning id as a2 \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id)
  values (:'m1', :'t1', :'c1', :'v1') returning id as a3 \gset
\set fotos '''{' :m1 '/insp-1.jpg,' :m1 '/insp-2.jpg}'''
\set todo_bien '''{"piso_limpio_seco":true,"sin_olores":true,"sin_plagas_restos":true,"carroceria_sana":true,"lona_buena":true,"carga_compatible":true}'''
\set con_falla '''{"piso_limpio_seco":true,"sin_olores":false,"sin_plagas_restos":true,"carroceria_sana":true,"lona_buena":true,"carga_compatible":true}'''

select pg_temp.verificar(not public.inspeccion_obligatoria(), 'arranca en modo «solo alerta» (sin bloqueo)');

-- Perfil almacén: lo asigna el administrador.
select pg_temp.como(:'adm');
set role authenticated;
select public.guardar_personal(:'alm', 'Alma', 'almacen', true) \g /dev/null
reset role;
select pg_temp.verificar((select rol = 'gerencia' and area = 'almacen' from public.usuarios where id = :'alm'), 'almacén queda con rol gerencia (solo lectura) y área almacén');
select pg_temp.como(:'alm');
select pg_temp.verificar(public.perfil_actual() = 'almacen' and public.es_almacen() and public.puede_cargar() and not public.puede_editar(), 'almacén carga pero no edita misiones');

-- Almacén registra lotes y balanza (antes, solo logística).
set role authenticated;
select public.guardar_lote(:'a3', null, jsonb_build_object('producto_id', :'prod', 'lote', 'A99', 'presentacion', 'saco_50', 'unidades', 10)) \g /dev/null
select pg_temp.verificar((select kg_lotes from public.asignaciones where id = :'a3') = 500, 'almacén registra lotes');
select pg_temp.verificar(pg_temp.error_de(format($$update public.misiones set factura = 'X' where id = %L$$, :'m1')) is not null
  or (select factura from public.misiones where id = :'m1') = 'F-99', 'almacén no cambia la misión');

-- Validaciones de la inspección.
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_inspeccion(%L, '{"piso_limpio_seco":true}', null, 'aprobado', null, %L)$$, :'a1', :fotos)) like 'Falta revisar:%', 'deben revisarse los 6 puntos');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_inspeccion(%L, %L, null, 'aprobado', null, %L)$$, :'a1', :con_falla, :fotos)) like 'No se puede aprobar: no cumple «Sin olores extraños»%', 'no se aprueba con un punto en falla');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_inspeccion(%L, %L, null, 'rechazado', 'x', %L)$$, :'a1', :con_falla, :fotos)) like 'Escriba el motivo%', 'el rechazo exige motivo');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_inspeccion(%L, %L, null, 'aprobado', null, %L)$$, :'a1', :todo_bien, '{' || :'m1' || '/insp-1.jpg}')) like 'Agregue al menos 2 fotos%', 'exige 2 fotos');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_inspeccion(%L, %L, null, 'aprobado', null, '{otra/insp-1.jpg,otra/insp-2.jpg}')$$, :'a1', :todo_bien)) like 'Fotos no válidas%', 'las fotos deben ser de la misión');
reset role;
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_inspeccion(%L, %L, null, 'aprobado', null, %L)$$, :'a1', :todo_bien, :fotos)) like 'Solo almacén%', 'gerencia no inspecciona');
select pg_temp.verificar(pg_temp.error_de(format($$select public.quitar_lote(%L)$$, (select id from public.cargas_lote where lote = 'A99'))) like 'Solo almacén, logística o el administrador%', 'gerencia no quita lotes (mensaje con almacén)');
reset role;

-- Rechazo: queda como incidencia y la inspección no está aprobada.
select pg_temp.como(:'alm');
set role authenticated;
select public.registrar_inspeccion(:'a1', :con_falla, 'Urea', 'rechazado', 'Olor a fertilizante', :fotos) \g /dev/null
reset role;
select pg_temp.verificar(not public.inspeccion_aprobada(:'a1'), 'un camión rechazado no queda aprobado');
select pg_temp.verificar((select inspector_nombre from public.inspecciones_camion where asignacion_id = :'a1') = 'Alma', 'queda el nombre de quien inspeccionó');
select pg_temp.verificar(exists (select 1 from public.eventos where asignacion_id = :'a1' and tipo = 'incidencia' and detalle ->> 'accion' = 'inspeccion_rechazado'), 'el rechazo queda en el historial como incidencia');

-- Bloqueo encendido: sin inspección aprobada no hay lotes, balanza, cierre ni salida.
select pg_temp.como(:'alm');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de('select public.fijar_inspeccion_obligatoria(true)') like 'Solo el administrador%', 'solo el administrador cambia el interruptor');
reset role;
select pg_temp.como(:'adm');
set role authenticated;
select public.fijar_inspeccion_obligatoria(true) \g /dev/null
reset role;
select pg_temp.verificar(public.inspeccion_obligatoria(), 'el administrador enciende el bloqueo');
select pg_temp.como(:'alm');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$select public.guardar_lote(%L, null, jsonb_build_object('producto_id', %L, 'lote', 'B1', 'presentacion', 'saco_50', 'unidades', 1))$$, :'a1', :'prod')) like 'El camión no tiene la inspección aprobada%', 'sin inspección aprobada no se registran lotes');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_balanza(%L, 'T9', 45000, 16000, null)$$, :'a1')) like 'El camión no tiene la inspección aprobada%', 'sin inspección aprobada no se registra la balanza');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_balanza(%L, null, null, null, 29)$$, :'a1')) like 'El camión no tiene la inspección aprobada%', 'tampoco con solo el neto');
select pg_temp.verificar(pg_temp.error_de(format($$select public.cerrar_carga(%L, 'P-1')$$, :'a1')) like 'Primero apruebe%', 'sin inspección aprobada no se cierra la carga');
reset role;
select pg_temp.verificar(pg_temp.error_de(format($$select public.aplicar_etapa(%L, 'cargado', 'chofer', now())$$, :'a1')) like 'La carga de este camión aún no está cerrada%', 'el chofer no inicia el viaje sin carga cerrada');

-- Nueva inspección aprobada, lotes, balanza y cierre con precinto.
select pg_temp.como(:'alm');
set role authenticated;
select public.registrar_inspeccion(:'a1', :todo_bien, 'Harina', 'aprobado', null, :fotos) \g /dev/null
select public.guardar_lote(:'a1', null, jsonb_build_object('producto_id', :'prod', 'lote', 'B1', 'presentacion', 'saco_50', 'unidades', 580)) \g /dev/null
select public.registrar_balanza(:'a1', 'T9', 45000, 16000, null) \g /dev/null
select pg_temp.verificar(pg_temp.error_de(format($$select public.cerrar_carga(%L, '  ')$$, :'a1')) like 'Escriba el número de precinto%', 'cerrar la carga exige el precinto');
select public.cerrar_carga(:'a1', ' p-77 ') \g /dev/null
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_inspeccion(%L, %L, null, 'aprobado', null, %L)$$, :'a1', :todo_bien, :fotos)) like 'La carga de este camión ya está cerrada%', 'con la carga cerrada no se inspecciona de nuevo');
reset role;
select pg_temp.verificar((select precinto = 'P-77' and inicio_carga is not null and fin_carga >= inicio_carga and kg_lotes = 29000 and toneladas_cargadas = 29 from public.asignaciones where id = :'a1'), 'queda precinto, inicio y fin de carga, lotes y balanza');
select public.aplicar_etapa(:'a1', 'cargado', 'chofer', now()) \g /dev/null
select pg_temp.verificar((select etapa = 'cargado' from public.asignaciones where id = :'a1'), 'con la carga cerrada el chofer inicia el viaje');
select pg_temp.verificar(not exists (select 1 from public.eventos where asignacion_id = :'a1' and detalle ->> 'motivo' = 'salio_sin_inspeccion'), 'un camión en regla no deja alerta');

-- Excepción: el administrador libera un camión, con motivo.
select pg_temp.como(:'alm');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$select public.liberar_camion(%L, 'Urgente cliente')$$, :'a2')) like 'Solo el administrador%', 'almacén no libera camiones');
reset role;
select pg_temp.como(:'adm');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$select public.liberar_camion(%L, 'x')$$, :'a2')) like 'Escriba el motivo%', 'la liberación exige motivo');
select public.liberar_camion(:'a2', 'Inspector ausente, revisado por jefe de planta') \g /dev/null
reset role;
select public.aplicar_etapa(:'a2', 'cargado', 'chofer', now()) \g /dev/null
select pg_temp.verificar((select etapa = 'cargado' and liberado_por = :'adm' from public.asignaciones where id = :'a2'), 'un camión liberado sale sin inspección');
select pg_temp.verificar(exists (select 1 from public.eventos where asignacion_id = :'a2' and detalle ->> 'motivo' = 'liberado_por_excepcion'), 'la liberación queda en el historial');

-- Modo alerta: el camión sale igual, con alerta de lo que faltó.
select pg_temp.como(:'adm');
set role authenticated;
select public.fijar_inspeccion_obligatoria(false) \g /dev/null
reset role;
select public.aplicar_etapa(:'a3', 'cargado', 'chofer', now()) \g /dev/null
select pg_temp.verificar((select detalle -> 'faltan' = '["inspeccion","precinto"]'::jsonb from public.eventos where asignacion_id = :'a3' and detalle ->> 'motivo' = 'salio_sin_inspeccion'), 'en modo alerta queda «salió sin inspección ni precinto»');

-- Cumplimiento: rechazos por transportista.
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar((select camiones_inspeccionados = 1 and camiones_rechazados = 1 and rechazos = 1 from public.rechazos_inspeccion(null, null) where transportista = 'Trans 99'), 'Trans 99: 1 camión inspeccionado y 1 rechazo');
select pg_temp.verificar((select count(*) from public.inspecciones_camion where asignacion_id = :'a1') = 2, 'gerencia ve las inspecciones');
select pg_temp.verificar(pg_temp.error_de(format($$insert into public.inspecciones_camion (asignacion_id, puntos, resultado) values (%L, '{}', 'aprobado')$$, :'a1')) is not null, 'la tabla no se escribe directo');
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_inspeccion(%L, '{}', null, 'aprobado', null, null)$$, :'a1')) is not null, 'un visitante sin sesión no inspecciona');
reset role;

select 'ok - 99_inspeccion_precinto';
