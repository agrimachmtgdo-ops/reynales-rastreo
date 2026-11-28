-- Ola 1 · Entrega 4: prueba de entrega (chofer y logística), fotos, historial, mermas y OTIF.
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
create function pg_temp.como_chofer(usuario uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', usuario, 'role', 'authenticated', 'is_anonymous', true)::text, false)
$$;
grant execute on function pg_temp.verificar(boolean, text), pg_temp.error_de(text), pg_temp.como(uuid), pg_temp.como_chofer(uuid) to authenticated, anon;

insert into auth.users (email) values ('adm101@reynales.test') returning id as adm \gset
insert into auth.users (email) values ('log101@reynales.test') returning id as log \gset
insert into auth.users (email) values ('ger101@reynales.test') returning id as ger \gset
insert into auth.users (is_anonymous) values (true) returning id as chofer \gset
update public.usuarios set activo = true, rol = 'administrador' where id = :'adm';
update public.usuarios set activo = true, rol = 'despacho' where id = :'log';
update public.usuarios set activo = true, rol = 'gerencia' where id = :'ger';

insert into public.clientes (razon_social, pais) values ('Cliente 101', 'PE') returning id as cli \gset
select id as dest from public.ubicaciones where nombre = 'Puno' \gset
select id as fab from public.ubicaciones where tipo = 'fabrica' order by nombre limit 1 \gset
insert into public.productos (nombre, presentacion) values ('Harina 101', 'Sacos de 50 kg') returning id as prod \gset
insert into public.transportistas (razon_social) values ('Trans 101') returning id as t1 \gset
insert into public.conductores (transportista_id, nombre) values (:'t1', 'Chofer 101') returning id as c1 \gset
insert into public.vehiculos (transportista_id, placa) values (:'t1', '1010ABC') returning id as v1 \gset
insert into public.misiones (cliente_id, origen_id, destino_id, producto_id, factura)
  values (:'cli', :'fab', :'dest', :'prod', 'F-101') returning id as m1 \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id)
  values (:'m1', :'t1', :'c1', :'v1') returning id as a1 \gset

-- Lotes del camión: 580 sacos de 50 kg = 29.000 kg. Invitación del chofer.
select pg_temp.como(:'adm');
set role authenticated;
select public.guardar_lote(:'a1', null, jsonb_build_object('producto_id', :'prod', 'lote', 'L101', 'presentacion', 'saco_50', 'unidades', 580)) \g /dev/null
select codigo as codigo from public.crear_invitacion(:'a1') \gset
reset role;

select pg_temp.como_chofer(:'chofer');
set role authenticated;
select public.activar_invitacion(lower(:'codigo'), 'android-101') \g /dev/null
select public.aceptar_politica(:'a1', '2026-11-v1') \g /dev/null
select public.marcar_etapa_chofer(:'a1', 'cargado') \g /dev/null
select public.carga_para_entrega(:'a1') as esp \gset
select pg_temp.verificar((:'esp'::jsonb ->> 'presentacion') = 'saco_50' and (:'esp'::jsonb ->> 'unidades')::int = 580
  and (:'esp'::jsonb ->> 'kg')::numeric = 29000 and (:'esp'::jsonb ->> 'ultimo_tramo')::boolean, 'el chofer ve lo que debe entregar (580 sacos, 29.000 kg)');
select pg_temp.verificar(pg_temp.error_de(format('select public.carga_esperada(%L)', :'a1')) is not null, 'carga_esperada es interna');

-- Validaciones.
\set guia :m1 '/entrega-g.jpg'
\set nov :m1 '/entrega-n1.jpg'
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_chofer(%L, '{"recibido_por":"","completo":true,"sin_guia":true}')$$, :'a1')) like 'Escriba quién recibió%', 'exige quién recibió');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_chofer(%L, '{"recibido_por":"Juan","unidades":570,"sin_guia":true}')$$, :'a1')) like '%marque la novedad «Faltante»%', 'menos de lo despachado exige «Faltante»');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_chofer(%L, '{"recibido_por":"Juan","completo":true}')$$, :'a1')) like 'Tome la foto de la guía%', 'exige foto de la guía o «no me dieron guía»');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_chofer(%L, '{"recibido_por":"Juan","completo":true,"foto_guia":"otra/entrega-x.jpg"}')$$, :'a1')) like 'Fotos no válidas%', 'las fotos deben ser de la misión');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_chofer(%L, '{"recibido_por":"Juan","completo":true,"sin_guia":true,"novedad":"otra"}')$$, :'a1')) like 'Describa la novedad%', '«Otra» exige descripción');

-- Entrega con faltante de 10 sacos.
select public.registrar_entrega_chofer(:'a1', jsonb_build_object('recibido_por', 'Juan Pérez (almacén cliente)', 'unidades', 570,
  'novedad', 'faltante', 'nota', 'Faltaron 10 sacos', 'foto_guia', :'guia', 'fotos_novedad', jsonb_build_array(:'nov')), now()) as r1 \gset
select pg_temp.verificar((:'r1'::jsonb ->> 'etapa') = 'entregado', 'registra la prueba y marca «Entregado» en un solo paso');
select pg_temp.verificar((public.registrar_entrega_chofer(:'a1', '{}'::jsonb) ->> 'repetida')::boolean, 'un reintento del mismo teléfono no falla');
reset role;
select pg_temp.verificar((select etapa = 'entregado' from public.asignaciones where id = :'a1'), 'el camión queda entregado');
select pg_temp.verificar((select kg_recibidos = 28500 and kg_despachados = 29000 and unidades_recibidas = 570 and origen = 'chofer'
  and registrado_por = :'chofer' from public.pruebas_entrega where asignacion_id = :'a1'), 'guarda 570 sacos = 28.500 kg de 29.000');
select pg_temp.verificar(exists (select 1 from public.eventos where asignacion_id = :'a1' and tipo = 'incidencia'
  and detalle ->> 'motivo' = 'entrega_con_novedad' and (detalle ->> 'faltante_kg')::numeric = 500), 'queda incidencia con el faltante (500 kg)');
select pg_temp.verificar(exists (select 1 from public.eventos where asignacion_id = :'a1' and tipo = 'nota'
  and detalle ->> 'accion' = 'prueba_entrega' and origen = 'chofer'), 'queda nota de la prueba en el historial');
select pg_temp.verificar(exists (select 1 from public.eventos where asignacion_id = :'a1' and etapa_nueva = 'entregado'
  and (detalle ->> 'prueba_entrega')::boolean and hora_dispositivo is not null), 'el cambio a entregado guarda la hora del teléfono');

-- Fotos después de entregar (la invitación ya se cerró).
select pg_temp.como_chofer(:'chofer');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('documentos', :'guia');
select pg_temp.verificar(pg_temp.error_de(format($$insert into storage.objects (bucket_id, name) values ('documentos', %L)$$, gen_random_uuid() || '/entrega-z.jpg')) is not null, 'no sube fotos a otra misión');
select pg_temp.verificar(pg_temp.error_de(format($$insert into storage.objects (bucket_id, name) values ('documentos', %L)$$, :'m1' || '/factura.pdf')) is not null, 'el chofer solo sube fotos de entrega');
select pg_temp.verificar(pg_temp.error_de(format('select public.foto_entrega_subida(%L, %L)', :'a1', :'nov')) like 'El archivo no se subió%', 'confirma solo fotos que ya están subidas');
select public.foto_entrega_subida(:'a1', :'guia') \g /dev/null
select public.foto_entrega_subida(:'a1', :'guia') \g /dev/null
select pg_temp.verificar(pg_temp.error_de(format('select public.foto_entrega_subida(%L, %L)', :'a1', :'m1' || '/entrega-otra.jpg')) like 'Esa foto no es de esta entrega%', 'no acepta fotos ajenas a la prueba');
reset role;
select pg_temp.verificar((select fotos_subidas = array[:'guia'] from public.pruebas_entrega where asignacion_id = :'a1'), 'la foto queda marcada como subida (una vez)');
select pg_temp.verificar((select count(*) = 1 from public.documentos where asignacion_id = :'a1' and tipo = 'otro' and etiqueta = 'guia_firmada'
  and ruta_archivo = :'guia' and subido_por is null), 'la guía queda como documento «Guía firmada» del camión');
update public.pruebas_entrega set registrada_en = now() - interval '8 days' where asignacion_id = :'a1';
select pg_temp.como_chofer(:'chofer');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$insert into storage.objects (bucket_id, name) values ('documentos', %L)$$, :'nov')) is not null, 'pasados 7 días el teléfono ya no sube fotos');
reset role;
update public.pruebas_entrega set registrada_en = now() where asignacion_id = :'a1';
select pg_temp.como(:'adm') \g /dev/null

-- Transbordo: el camión del tramo 1 no hace prueba de entrega; el del tramo 2 sí.
insert into public.misiones (cliente_id, origen_id, destino_id, producto_id, factura)
  values (:'cli', :'fab', :'dest', :'prod', 'F-102') returning id as m2 \gset
insert into public.tramos (mision_id, numero, transportista_id) values (:'m2', 2, :'t1');
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
  values (:'m2', :'t1', :'c1', :'v1', 29) returning id as a2 \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, toneladas_declaradas)
  values (:'m2', :'t1', :'c1', :'v1', 2, 28.9) returning id as a3 \gset
select pg_temp.verificar(not public.es_ultimo_tramo(:'a2') and public.es_ultimo_tramo(:'a3'), 'distingue el camión del transbordo del último tramo');
select pg_temp.verificar((public.carga_esperada(:'a3') ->> 'kg')::numeric = 28900 and (public.carga_esperada(:'a3') ->> 'estimado')::boolean,
  'en el tramo 2 se espera lo declarado en el transbordo');
select public.aplicar_etapa(:'a2', 'entregado', 'despacho') \g /dev/null

-- Logística: camión entregado con la app 0.1.7 (sin prueba).
insert into public.misiones (cliente_id, origen_id, destino_id, producto_id, factura)
  values (:'cli', :'fab', :'dest', :'prod', 'F-103') returning id as m3 \gset
insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, toneladas_cargadas)
  values (:'m3', :'t1', :'c1', :'v1', 28) returning id as a4 \gset
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_despacho(%L, '{"recibido_por":"Ana","completo":true}')$$, :'a4')) like 'Primero marque el camión como entregado%', 'logística registra solo camiones entregados');
reset role;
select public.aplicar_etapa(:'a4', 'entregado', 'chofer') \g /dev/null
select pg_temp.como(:'log');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_despacho(%L, '{"recibido_por":"Ana","completo":true}')$$, :'a2')) like '%la recepción la confirma el operador%', 'el camión del transbordo no lleva prueba de entrega');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_despacho(%L, '{"recibido_por":"Ana","completo":true}')$$, :'a1')) like 'El chofer ya registró%', 'la prueba del chofer no se cambia');
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_despacho(%L, '{"recibido_por":"Ana","completo":true,"foto_guia":"x"}')$$, :'a4')) like 'Desde el panel, la guía%', 'desde el panel la guía va a Documentos');
select public.registrar_entrega_despacho(:'a4', '{"recibido_por":"Ana","completo":true}') \g /dev/null
select public.registrar_entrega_despacho(:'a4', '{"recibido_por":"Ana Quispe","kg":27990}') \g /dev/null
reset role;
select pg_temp.verificar((select origen = 'logistica' and kg_recibidos = 27990 and recibido_por = 'Ana Quispe' from public.pruebas_entrega where asignacion_id = :'a4'),
  'logística registra y corrige su propia prueba');
select pg_temp.verificar((select count(*) = 2 from public.eventos where asignacion_id = :'a4' and detalle ->> 'accion' = 'prueba_entrega')
  and not exists (select 1 from public.eventos where asignacion_id = :'a4' and detalle ->> 'motivo' = 'entrega_con_novedad'),
  'diferencia dentro de la tolerancia: sin incidencia');
select pg_temp.como(:'ger');
set role authenticated;
select pg_temp.verificar(pg_temp.error_de(format($$select public.registrar_entrega_despacho(%L, '{"recibido_por":"Ana","completo":true}')$$, :'a4')) like 'Solo el administrador o logística%', 'gerencia no registra entregas');
select pg_temp.verificar((select merma_kg = 510 and entregas = 2 and con_novedad = 1 from public.mermas_entrega(null, null) where transportista = 'Trans 101'),
  'mermas por transportista y destino (500 + 10 kg)');
select pg_temp.verificar((select count(*) = 2 from public.pruebas_entrega), 'gerencia lee las pruebas');
reset role;

-- Cumplimiento (datos de 95_cumplimiento): E1 entregó 29 t; el cliente recibió 25 t.
select e.id as e1, public.mision_de_envio(e.id) as me1
  from public.programa_envios e join public.pedidos p on p.id = e.pedido_id
 where p.orden_compra = 'OC-95' and e.numero = 1 \gset
select pg_temp.como(:'log');
set role authenticated;
select public.registrar_entrega_despacho((select id from public.asignaciones where mision_id = :'me1'),
  '{"recibido_por":"Cliente","kg":25000,"novedad":"faltante"}') \g /dev/null
select public.reporte_cumplimiento((now() at time zone 'America/La_Paz')::date - 30, (now() at time zone 'America/La_Paz')::date + 30) as rep \gset
reset role;
select pg_temp.verificar((select (x ->> 'recibido_confirmado')::boolean and (x ->> 'completo')::boolean = false
  and (x ->> 'toneladas_reales')::numeric = 25 from jsonb_array_elements((:'rep'::jsonb) -> 'envios') x where (x ->> 'envio_id')::uuid = :'e1'),
  'OTIF: «Completo» usa lo recibido (25 t de 29) cuando hay prueba de entrega');
select pg_temp.verificar((select count(*) > 0 and bool_and(not (x ->> 'recibido_confirmado')::boolean) from jsonb_array_elements((:'rep'::jsonb) -> 'envios') x
  where (x ->> 'envio_id')::uuid <> :'e1'), 'sin prueba, sigue el peso de fábrica («sin confirmar»)');

select set_config('request.jwt.claims', '', false) \g /dev/null
