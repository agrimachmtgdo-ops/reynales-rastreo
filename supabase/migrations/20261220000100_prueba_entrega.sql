-- =============================================================================
-- Ola 1 · Entrega 4: prueba de entrega
-- (plan «Trazabilidad de la carga», aprobado por Ronald el 2026-11-28)
--
--  * pruebas_entrega: una por camión del último tramo. Quién recibió, cuánto se
--    recibió (sacos, big bags o kg), novedad (sin novedad, faltante, daño, humedad
--    u otra), foto de la guía firmada (o «no me dieron guía») y fotos de la novedad.
--  * App del chofer 0.1.8: registrar_entrega_chofer registra la prueba y marca
--    «Entregado» en un solo paso. Las fotos suben después (aunque no haya señal en
--    el momento): foto_entrega_subida las confirma una a una y la foto de la guía
--    queda además como documento «Guía firmada» del camión.
--  * La app 0.1.7 sigue funcionando igual: si el chofer marca «Entregado» sin prueba,
--    logística la registra desde el panel (registrar_entrega_despacho).
--  * Cada prueba deja una nota en el historial; con novedad, o si se recibió menos que
--    lo despachado (tolerancia entrega_tolerancia_pct, 0,5 %), queda una incidencia.
--  * Cumplimiento: «Completo» (OTIF) usa lo recibido cuando todos los camiones del
--    último tramo tienen prueba; si falta alguna, sigue usando el peso de fábrica y el
--    envío figura «sin confirmar». mermas_entrega(): faltantes por transportista y destino.
--
-- No borra ni modifica datos existentes. No agrega valores a ningún enum.
-- Reversión: supabase/revertir/20261220000100_prueba_entrega.sql
-- =============================================================================
set search_path = public, extensions;

insert into public.configuracion (clave, valor) values ('entrega_tolerancia_pct', '0.5')
  on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------
create table public.pruebas_entrega (
  id                  uuid primary key default gen_random_uuid(),
  asignacion_id       uuid not null unique references public.asignaciones (id) on delete cascade,
  recibido_por        text not null check (length(btrim(recibido_por)) between 2 and 120),
  presentacion        text check (presentacion in ('saco_50', 'saco_40', 'big_bag_1200', 'granel', 'mixta')),
  unidades_recibidas  integer check (unidades_recibidas is null or unidades_recibidas between 0 and 5000),
  kg_recibidos        numeric(10, 1) not null check (kg_recibidos between 0 and 60000),
  kg_despachados      numeric(10, 1),
  novedad             text not null default 'sin_novedad'
                        check (novedad in ('sin_novedad', 'faltante', 'dano', 'humedad', 'otra')),
  nota                text check (nota is null or length(nota) <= 300),
  foto_guia           text,
  sin_guia            boolean not null default false,
  fotos_novedad       text[] not null default '{}' check (cardinality(fotos_novedad) <= 2),
  fotos_subidas       text[] not null default '{}',
  hora_dispositivo    timestamptz,
  registrada_en       timestamptz not null default now(),
  origen              text not null check (origen in ('chofer', 'logistica')),
  registrado_por      uuid,   -- usuario del panel o sesión del chofer
  constraint pruebas_entrega_otra_con_nota check (novedad <> 'otra' or length(btrim(coalesce(nota, ''))) >= 3)
);
comment on table public.pruebas_entrega is 'Prueba de entrega por camión del último tramo. Se escribe solo con registrar_entrega_chofer, registrar_entrega_despacho y foto_entrega_subida.';
comment on column public.pruebas_entrega.kg_despachados is 'Lo que salió (lotes o balanza en el tramo 1; toneladas declaradas en el tramo 2 o 3), al momento de la entrega.';
comment on column public.pruebas_entrega.fotos_subidas is 'Rutas de fotos que ya llegaron al almacenamiento (la app las sube al recuperar señal).';

alter table public.pruebas_entrega enable row level security;
create policy pruebas_entrega_leer on public.pruebas_entrega for select to authenticated using (public.es_personal());
revoke all on public.pruebas_entrega from anon;
revoke insert, update, delete on public.pruebas_entrega from authenticated;

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------
-- ¿Este camión llega al destino final (no hay un tramo siguiente)?
create or replace function public.es_ultimo_tramo(p_asignacion uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select not exists (select 1 from public.asignaciones a join public.tramos t on t.mision_id = a.mision_id
                      where a.id = p_asignacion and t.numero > coalesce(a.tramo, 1))
$$;

-- Lo que debería recibir el cliente de este camión: {presentacion, unidades, kg, estimado}.
-- Tramo 1: sus lotes (o la balanza si no tiene lotes). Tramos 2 y 3: toneladas declaradas
-- en el transbordo; las unidades se estiman si la misión lleva una sola presentación.
create or replace function public.carga_esperada(p_asignacion uuid)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare
  a public.asignaciones;
  v_pres text;
  v_n int;
  v_unid int;
  v_kg numeric;
begin
  select * into a from public.asignaciones where id = p_asignacion;
  if a.id is null then return null; end if;
  if coalesce(a.tramo, 1) = 1 then
    select count(distinct presentacion), min(presentacion), sum(unidades), sum(kg)
      into v_n, v_pres, v_unid, v_kg
      from public.cargas_lote where asignacion_id = a.id;
    if v_n > 0 then
      if v_n > 1 then
        return jsonb_build_object('presentacion', 'mixta', 'unidades', null, 'kg', v_kg, 'estimado', false);
      end if;
      return jsonb_build_object('presentacion', v_pres, 'unidades', v_unid, 'kg', v_kg, 'estimado', false);
    end if;
    return jsonb_build_object('presentacion', null, 'unidades', null,
                              'kg', round(a.toneladas_cargadas * 1000, 1), 'estimado', false);
  end if;
  -- Tramo 2 o 3: lo declarado en el transbordo.
  select count(distinct cl.presentacion), min(cl.presentacion) into v_n, v_pres
    from public.cargas_lote cl join public.asignaciones x on x.id = cl.asignacion_id
   where x.mision_id = a.mision_id and x.etapa <> 'cancelado';
  v_kg := round(a.toneladas_declaradas * 1000, 1);
  if v_n <> 1 then v_pres := case when v_n > 1 then 'mixta' end; end if;
  return jsonb_build_object('presentacion', v_pres,
    'unidades', case when public.kg_por_unidad(v_pres) is not null and v_kg is not null
                     then round(v_kg / public.kg_por_unidad(v_pres))::int end,
    'kg', v_kg, 'estimado', true);
end $$;

-- App del chofer: qué debe entregar (para la pantalla de entrega).
create or replace function public.carga_para_entrega(p_asignacion uuid)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare inv public.invitaciones_chofer := public.invitacion_de_sesion(p_asignacion);
begin
  if inv.id is null then raise exception 'Sin acceso a este viaje' using errcode = '42501'; end if;
  return public.carga_esperada(p_asignacion)
         || jsonb_build_object('mision_id', (select mision_id from public.asignaciones where id = p_asignacion),
                               'ultimo_tramo', public.es_ultimo_tramo(p_asignacion),
                               'tolerancia_pct', coalesce((select (valor #>> '{}')::numeric from public.configuracion
                                                            where clave = 'entrega_tolerancia_pct'), 0.5));
end $$;

-- Valida los datos y calcula lo recibido. p_datos:
-- {recibido_por, completo?, unidades?, kg?, novedad?, nota?, foto_guia?, sin_guia?, fotos_novedad?[]}
create or replace function public.datos_entrega(p_asignacion uuid, p_datos jsonb, p_con_fotos boolean)
returns public.pruebas_entrega language plpgsql stable security definer
set search_path = public as $$
declare
  a public.asignaciones;
  esp jsonb := public.carga_esperada(p_asignacion);
  r public.pruebas_entrega;
  v_kg_unidad numeric;
  v_tol numeric := coalesce((select (valor #>> '{}')::numeric from public.configuracion where clave = 'entrega_tolerancia_pct'), 0.5);
  v_completo boolean;
  f text;
begin
  select * into a from public.asignaciones where id = p_asignacion;
  if coalesce(jsonb_typeof(p_datos), '') <> 'object' then raise exception 'Complete los datos de la entrega.'; end if;
  r.asignacion_id := p_asignacion;
  r.recibido_por := btrim(coalesce(p_datos ->> 'recibido_por', ''));
  if length(r.recibido_por) < 2 then raise exception 'Escriba quién recibió la carga.'; end if;
  if length(r.recibido_por) > 120 then raise exception 'El nombre de quien recibe tiene hasta 120 caracteres.'; end if;

  r.presentacion := esp ->> 'presentacion';
  r.kg_despachados := (esp ->> 'kg')::numeric;
  v_kg_unidad := public.kg_por_unidad(r.presentacion);
  v_completo := coalesce((p_datos ->> 'completo')::boolean, false);
  if v_completo and r.kg_despachados is null then
    raise exception 'No hay peso de salida para este camión: escriba la cantidad recibida.';
  end if;
  if v_completo then
    r.unidades_recibidas := (esp ->> 'unidades')::int;
    r.kg_recibidos := r.kg_despachados;
  elsif v_kg_unidad is not null and coalesce(jsonb_typeof(p_datos -> 'unidades'), '') = 'number' then
    r.unidades_recibidas := (p_datos ->> 'unidades')::numeric;
    if r.unidades_recibidas::numeric <> (p_datos ->> 'unidades')::numeric or r.unidades_recibidas < 0 or r.unidades_recibidas > 5000 then
      raise exception 'Escriba cuántas unidades recibieron (número entero).';
    end if;
    r.kg_recibidos := r.unidades_recibidas * v_kg_unidad;
  elsif coalesce(jsonb_typeof(p_datos -> 'kg'), '') = 'number' then
    r.kg_recibidos := round((p_datos ->> 'kg')::numeric, 1);
    if r.kg_recibidos < 0 or r.kg_recibidos > 60000 then raise exception 'Los kg recibidos deben estar entre 0 y 60.000.'; end if;
  else
    raise exception 'Escriba la cantidad recibida.';
  end if;

  r.novedad := coalesce(nullif(p_datos ->> 'novedad', ''), 'sin_novedad');
  if r.novedad not in ('sin_novedad', 'faltante', 'dano', 'humedad', 'otra') then raise exception 'Novedad no válida.'; end if;
  r.nota := nullif(btrim(coalesce(p_datos ->> 'nota', '')), '');
  if length(r.nota) > 300 then raise exception 'La nota tiene hasta 300 caracteres.'; end if;
  if r.novedad = 'otra' and length(coalesce(r.nota, '')) < 3 then raise exception 'Describa la novedad.'; end if;
  if r.novedad = 'sin_novedad' and r.kg_despachados is not null
     and r.kg_recibidos < r.kg_despachados * (1 - v_tol / 100) then
    raise exception 'Recibieron menos de lo despachado: marque la novedad «Faltante».';
  end if;

  r.foto_guia := nullif(p_datos ->> 'foto_guia', '');
  r.sin_guia := coalesce((p_datos ->> 'sin_guia')::boolean, false);
  r.fotos_novedad := coalesce((select array_agg(x) from jsonb_array_elements_text(
                       case when jsonb_typeof(p_datos -> 'fotos_novedad') = 'array' then p_datos -> 'fotos_novedad' else '[]' end) x), '{}');
  if cardinality(r.fotos_novedad) > 2 then raise exception 'Hasta 2 fotos de la novedad.'; end if;
  if p_con_fotos then
    if r.foto_guia is null and not r.sin_guia then
      raise exception 'Tome la foto de la guía firmada, o indique que no le dieron guía.';
    end if;
    if r.foto_guia is not null and r.sin_guia then r.sin_guia := false; end if;
  elsif r.foto_guia is not null or cardinality(r.fotos_novedad) > 0 then
    raise exception 'Desde el panel, la guía firmada se sube en Documentos.';
  end if;
  foreach f in array array_remove(r.fotos_novedad || r.foto_guia, null) loop
    if f not like a.mision_id::text || '/entrega-%' or f ~ '\.\.' then raise exception 'Fotos no válidas para este camión.'; end if;
  end loop;
  return r;
end $$;
revoke execute on function public.datos_entrega(uuid, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Chofer: prueba de entrega + «Entregado» en un solo paso
-- ---------------------------------------------------------------------------
create or replace function public.registrar_entrega_chofer(p_asignacion uuid, p_datos jsonb, p_hora_dispositivo timestamptz default null)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  inv public.invitaciones_chofer;
  actual public.etapa_envio;
  r public.pruebas_entrega;
  v_id uuid;
begin
  -- Reintento (se perdió la respuesta): la prueba ya está registrada por este teléfono.
  select id into v_id from public.pruebas_entrega
   where asignacion_id = p_asignacion and registrado_por = auth.uid() and auth.uid() is not null;
  if v_id is not null then return jsonb_build_object('id', v_id, 'etapa', 'entregado', 'repetida', true); end if;

  inv := public.invitacion_de_sesion(p_asignacion);
  if inv.id is null then raise exception 'Sin acceso a este viaje' using errcode = '42501'; end if;
  if not public.tiene_consentimiento(inv.conductor_id) then raise exception 'Debe aceptar la política de rastreo primero'; end if;
  if not public.es_ultimo_tramo(p_asignacion) then
    raise exception 'Este camión entrega en el transbordo: la recepción la confirma el operador.';
  end if;
  select etapa into actual from public.asignaciones where id = p_asignacion for update;
  if actual not in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera') then
    raise exception 'No se puede pasar de "%" a "entregado"', actual;
  end if;
  if exists (select 1 from public.pruebas_entrega where asignacion_id = p_asignacion) then
    raise exception 'La entrega de este camión ya está registrada.';
  end if;

  r := public.datos_entrega(p_asignacion, p_datos, true);
  insert into public.pruebas_entrega (asignacion_id, recibido_por, presentacion, unidades_recibidas, kg_recibidos, kg_despachados,
                                      novedad, nota, foto_guia, sin_guia, fotos_novedad, hora_dispositivo, origen, registrado_por)
  values (p_asignacion, r.recibido_por, r.presentacion, r.unidades_recibidas, r.kg_recibidos, r.kg_despachados,
          r.novedad, r.nota, r.foto_guia, r.sin_guia, r.fotos_novedad, p_hora_dispositivo, 'chofer', auth.uid())
  returning id into v_id;

  perform public.aplicar_etapa(p_asignacion, 'entregado', 'chofer', now(),
    case when p_hora_dispositivo is not null then jsonb_build_object('hora_dispositivo', p_hora_dispositivo) else '{}'::jsonb end
    || jsonb_build_object('prueba_entrega', true));
  return jsonb_build_object('id', v_id, 'etapa', 'entregado');
end $$;

-- ¿El teléfono puede subir fotos de entrega a esta misión? Mientras el viaje está abierto,
-- o hasta 7 días después de su propia prueba de entrega (las fotos pueden llegar tarde).
create or replace function public.chofer_puede_subir_entrega(p_mision uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.invitaciones_chofer i join public.asignaciones a on a.id = i.asignacion_id
     where a.mision_id = p_mision and i.usado_por = auth.uid()
       and ((not i.revocada and a.etapa not in ('entregado', 'cancelado'))
            or exists (select 1 from public.pruebas_entrega pe
                        where pe.asignacion_id = a.id and pe.registrado_por = auth.uid()
                          and pe.registrada_en > now() - interval '7 days')))
$$;

create policy documentos_archivo_subir_chofer on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and name like '%/entrega-%'
              and public.chofer_puede_subir_entrega(public.mision_de_ruta(name)));

-- La foto ya está en el almacenamiento: se marca como subida; la guía queda como documento.
create or replace function public.foto_entrega_subida(p_asignacion uuid, p_ruta text)
returns void language plpgsql security definer
set search_path = public, storage as $$
declare
  pe public.pruebas_entrega;
  a public.asignaciones;
  v_personal uuid := (select id from public.usuarios where id = auth.uid());
begin
  select * into pe from public.pruebas_entrega where asignacion_id = p_asignacion for update;
  if pe.id is null then raise exception 'Este camión no tiene prueba de entrega.'; end if;
  if not ((pe.registrado_por = auth.uid() and auth.uid() is not null) or public.puede_editar()) then
    raise exception 'Sin acceso a este viaje' using errcode = '42501';
  end if;
  if p_ruta is distinct from pe.foto_guia and not (p_ruta = any (pe.fotos_novedad)) then
    raise exception 'Esa foto no es de esta entrega.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'documentos' and name = p_ruta) then
    raise exception 'El archivo no se subió. Intente de nuevo.';
  end if;
  if p_ruta = any (pe.fotos_subidas) then return; end if;
  update public.pruebas_entrega set fotos_subidas = fotos_subidas || p_ruta where id = pe.id;
  if p_ruta = pe.foto_guia and not exists (select 1 from public.documentos where ruta_archivo = p_ruta) then
    select * into a from public.asignaciones where id = p_asignacion;
    insert into public.documentos (mision_id, asignacion_id, tipo, etiqueta, ruta_archivo, nombre_original, subido_por, tipo_mime)
    values (a.mision_id, a.id, 'otro', 'guia_firmada', p_ruta, 'Guía firmada (foto del chofer)', v_personal, 'image/jpeg');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Panel: logística registra la prueba de un camión ya entregado (app 0.1.7, o el
-- chofer no pudo). Puede corregir las que registró logística; las del chofer no se tocan.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_entrega_despacho(p_asignacion uuid, p_datos jsonb)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  a public.asignaciones;
  previa public.pruebas_entrega;
  r public.pruebas_entrega;
  v_id uuid;
begin
  if not public.puede_editar() then
    raise exception 'Solo el administrador o logística registran la entrega.' using errcode = '42501';
  end if;
  select * into a from public.asignaciones where id = p_asignacion for update;
  if a.id is null then raise exception 'No existe ese camión.'; end if;
  if a.etapa <> 'entregado' then raise exception 'Primero marque el camión como entregado.'; end if;
  if not public.es_ultimo_tramo(p_asignacion) then
    raise exception 'Este camión entrega en el transbordo: la recepción la confirma el operador.';
  end if;
  select * into previa from public.pruebas_entrega where asignacion_id = p_asignacion;
  if previa.origen = 'chofer' then raise exception 'El chofer ya registró la prueba de entrega de este camión.'; end if;

  r := public.datos_entrega(p_asignacion, p_datos, false);
  if previa.id is null then
    insert into public.pruebas_entrega (asignacion_id, recibido_por, presentacion, unidades_recibidas, kg_recibidos, kg_despachados,
                                        novedad, nota, origen, registrado_por)
    values (p_asignacion, r.recibido_por, r.presentacion, r.unidades_recibidas, r.kg_recibidos, r.kg_despachados,
            r.novedad, r.nota, 'logistica', auth.uid())
    returning id into v_id;
  else
    update public.pruebas_entrega
       set recibido_por = r.recibido_por, presentacion = r.presentacion, unidades_recibidas = r.unidades_recibidas,
           kg_recibidos = r.kg_recibidos, kg_despachados = r.kg_despachados, novedad = r.novedad, nota = r.nota,
           registrado_por = auth.uid()
     where id = previa.id
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Historial: nota por cada prueba; incidencia con novedad o faltante
-- ---------------------------------------------------------------------------
create or replace function public.trg_prueba_entrega_evento()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_tol numeric := coalesce((select (valor #>> '{}')::numeric from public.configuracion where clave = 'entrega_tolerancia_pct'), 0.5);
  v_falta boolean := new.kg_despachados is not null and new.kg_recibidos < new.kg_despachados * (1 - v_tol / 100);
  v_detalle jsonb;
begin
  if tg_op = 'UPDATE' and (new.recibido_por, new.kg_recibidos, new.unidades_recibidas, new.novedad, new.nota)
                          is not distinct from (old.recibido_por, old.kg_recibidos, old.unidades_recibidas, old.novedad, old.nota) then
    return null;
  end if;
  v_detalle := jsonb_build_object('recibido_por', new.recibido_por, 'kg_recibidos', new.kg_recibidos,
                 'kg_despachados', new.kg_despachados, 'unidades', new.unidades_recibidas, 'presentacion', new.presentacion,
                 'novedad', new.novedad, 'nota', new.nota, 'sin_guia', new.sin_guia, 'origen_prueba', new.origen,
                 'corregida', tg_op = 'UPDATE');
  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (new.asignacion_id, 'nota', case when new.origen = 'chofer' then 'chofer' else 'despacho' end::public.origen_evento,
          v_detalle || jsonb_build_object('accion', 'prueba_entrega'), new.registrado_por);
  if new.novedad <> 'sin_novedad' or v_falta then
    insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
    values (new.asignacion_id, 'incidencia', 'sistema',
            v_detalle || jsonb_build_object('motivo', 'entrega_con_novedad',
                                            'faltante_kg', case when v_falta then new.kg_despachados - new.kg_recibidos end),
            new.registrado_por);
  end if;
  return null;
end $$;
create trigger pruebas_entrega_evento after insert or update on public.pruebas_entrega
  for each row execute function public.trg_prueba_entrega_evento();

-- ---------------------------------------------------------------------------
-- Mermas por transportista y destino (solo lectura)
-- ---------------------------------------------------------------------------
create or replace function public.mermas_entrega(p_desde date, p_hasta date)
returns table (transportista_id uuid, transportista text, destino text, entregas bigint, con_novedad bigint,
               kg_despachados numeric, kg_recibidos numeric, merma_kg numeric)
language plpgsql stable security definer
set search_path = public as $$
begin
  if not public.es_personal() then raise exception 'Sin permiso.' using errcode = '42501'; end if;
  return query
    select t.id, t.razon_social, coalesce(d.nombre, '—'),
           count(*), count(*) filter (where pe.novedad <> 'sin_novedad'),
           sum(pe.kg_despachados), sum(pe.kg_recibidos),
           sum(greatest(0, pe.kg_despachados - pe.kg_recibidos)) filter (where pe.kg_despachados is not null)
      from public.pruebas_entrega pe
      join public.asignaciones a on a.id = pe.asignacion_id
      join public.transportistas t on t.id = a.transportista_id
      join public.misiones m on m.id = a.mision_id
      left join public.ubicaciones d on d.id = m.destino_id
     where (pe.registrada_en at time zone 'America/La_Paz')::date between coalesce(p_desde, '2000-01-01') and coalesce(p_hasta, '2100-01-01')
     group by t.id, t.razon_social, d.nombre
     order by 8 desc nulls last, 2, 3;
end $$;

-- ---------------------------------------------------------------------------
-- Cumplimiento: «Completo» con lo recibido cuando todo el último tramo tiene prueba.
-- Se cambian 4 fragmentos exactos; si alguno no aparece una sola vez, se detiene.
-- ---------------------------------------------------------------------------
do $$
declare
  def text := pg_get_functiondef('public.reporte_cumplimiento(date, date, uuid, text)'::regprocedure);
  cambios text[][] := array[
    array['select a.mision_id, a.id, a.tramo, a.toneladas_cargadas,',
          'select a.mision_id, a.id, a.tramo, a.toneladas_cargadas, (select pe.kg_recibidos from public.pruebas_entrega pe where pe.asignacion_id = a.id) as kg_recibidos,'],
    array['sum(ca.toneladas_cargadas) filter (where ca.tramo = 1) as toneladas_real,',
          'sum(ca.toneladas_cargadas) filter (where ca.tramo = 1) as toneladas_real, case when count(*) filter (where ca.tramo = mi.ultimo_tramo) > 0 and count(*) filter (where ca.tramo = mi.ultimo_tramo and ca.kg_recibidos is null) = 0 then round(sum(ca.kg_recibidos) filter (where ca.tramo = mi.ultimo_tramo) / 1000.0, 2) end as toneladas_recibidas,'],
    array['r.toneladas_real, coalesce(r.camiones, 0) as camiones,',
          'case when en.hito = ''entrega'' and r.toneladas_recibidas is not null then r.toneladas_recibidas else r.toneladas_real end as toneladas_real, (en.hito = ''entrega'' and r.toneladas_recibidas is not null) as recibido_confirmado, coalesce(r.camiones, 0) as camiones,'],
    array['''toneladas_reales'', r.toneladas_real,',
          '''toneladas_reales'', r.toneladas_real, ''recibido_confirmado'', r.recibido_confirmado,']
  ];
  i int;
begin
  for i in 1 .. array_length(cambios, 1) loop
    if (length(def) - length(replace(def, cambios[i][1], ''))) / length(cambios[i][1]) <> 1 then
      raise exception 'No se encontró el fragmento % de reporte_cumplimiento', i;
    end if;
    def := replace(def, cambios[i][1], cambios[i][2]);
  end loop;
  execute def;
end $$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.trg_prueba_entrega_evento(), public.carga_esperada(uuid)
  from public, anon, authenticated;
revoke execute on function public.es_ultimo_tramo(uuid), public.carga_para_entrega(uuid),
  public.registrar_entrega_chofer(uuid, jsonb, timestamptz), public.chofer_puede_subir_entrega(uuid),
  public.foto_entrega_subida(uuid, text), public.registrar_entrega_despacho(uuid, jsonb), public.mermas_entrega(date, date)
  from public, anon;
grant execute on function public.es_ultimo_tramo(uuid), public.carga_para_entrega(uuid),
  public.registrar_entrega_chofer(uuid, jsonb, timestamptz), public.chofer_puede_subir_entrega(uuid),
  public.foto_entrega_subida(uuid, text), public.registrar_entrega_despacho(uuid, jsonb), public.mermas_entrega(date, date)
  to authenticated;
