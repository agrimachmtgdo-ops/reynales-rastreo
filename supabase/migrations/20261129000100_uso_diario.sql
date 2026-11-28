-- =============================================================================
-- Entrega B: mejoras de uso diario.
--   1) Botón de emergencia del chofer (y "atendida" por despacho).
--   2) Cruce de frontera con histéresis: el GPS que "salta" en el borde de la
--      geocerca ya no marca "Cruzó a Perú" antes de tiempo.
--   3) Cruce a Perú detectado aunque el camión no se haya detenido en la frontera.
--   4) Recorrido completo simplificado para el mapa (antes: solo los últimos 2000 puntos).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.asignaciones
  add column if not exists emergencia_en        timestamptz,
  add column if not exists emergencia_motivo    text,
  -- Desde cuándo los puntos indican que el camión ya cruzó (se confirma tras unos minutos).
  add column if not exists cruce_candidato_desde timestamptz;

-- ---------------------------------------------------------------------------
-- 1a) El chofer reporta una emergencia.
-- No exige el consentimiento de rastreo: una emergencia siempre debe llegar.
-- La ubicación es opcional (el teléfono puede no tenerla en ese momento).
-- ---------------------------------------------------------------------------
create or replace function public.reportar_emergencia(
  p_asignacion uuid,
  p_motivo text,
  p_lat double precision default null,
  p_lon double precision default null
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  inv public.invitaciones_chofer;
  a record;
  con_ubicacion boolean := p_lat is not null and p_lon is not null
                           and p_lat between -90 and 90 and p_lon between -180 and 180;
begin
  inv := public.invitacion_de_sesion(p_asignacion);
  if inv.id is null then
    raise exception 'Sin acceso a este viaje' using errcode = '42501';
  end if;
  if p_motivo is null or p_motivo not in ('accidente', 'robo', 'mecanica', 'salud', 'otro') then
    raise exception 'Motivo de emergencia no válido';
  end if;

  select etapa, emergencia_en, emergencia_motivo into a
    from public.asignaciones where id = p_asignacion for update;
  if a.etapa in ('entregado', 'cancelado') then
    raise exception 'Este viaje ya está cerrado.';
  end if;

  -- Si el chofer pulsa varias veces (o la app reintenta), no se duplica el aviso.
  if a.emergencia_en is not null and a.emergencia_motivo = p_motivo
     and a.emergencia_en > now() - interval '2 minutes' then
    return jsonb_build_object('ok', true, 'repetida', true);
  end if;

  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (p_asignacion, 'emergencia', 'chofer',
          jsonb_build_object('motivo', p_motivo)
            || case when con_ubicacion then jsonb_build_object('lat', p_lat, 'lon', p_lon) else '{}'::jsonb end,
          auth.uid());

  update public.asignaciones
     set emergencia_en = now(),
         emergencia_motivo = p_motivo,
         ultima_lat = case when con_ubicacion then p_lat else ultima_lat end,
         ultima_lon = case when con_ubicacion then p_lon else ultima_lon end,
         ultima_senal = case when con_ubicacion then now() else ultima_senal end
   where id = p_asignacion;

  return jsonb_build_object('ok', true, 'repetida', false);
end $$;

-- ---------------------------------------------------------------------------
-- 1b) Despacho marca la emergencia como atendida (queda registrada en eventos).
-- ---------------------------------------------------------------------------
create or replace function public.atender_emergencia(p_asignacion uuid, p_nota text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.puede_editar() then
    raise exception 'No tiene permiso para atender emergencias' using errcode = '42501';
  end if;
  if coalesce(trim(p_nota), '') = '' then
    raise exception 'Escriba qué se hizo con la emergencia';
  end if;
  update public.asignaciones
     set emergencia_en = null, emergencia_motivo = null
   where id = p_asignacion and emergencia_en is not null;
  if not found then
    raise exception 'Este camión no tiene una emergencia activa';
  end if;
  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (p_asignacion, 'nota', 'despacho',
          jsonb_build_object('nota', 'Emergencia atendida: ' || trim(p_nota)), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 2 y 3) Geocercas con confirmación del cruce.
-- ---------------------------------------------------------------------------
create or replace function public.evaluar_geocercas(
  p_asignacion uuid,
  p_punto extensions.geography,
  p_momento timestamptz,
  p_precision_m integer default 0
) returns public.etapa_envio language plpgsql security definer
set search_path = public, extensions as $$
declare
  a record;
  origen record;
  destino record;
  frontera record;
  margen integer := greatest(coalesce(p_precision_m, 0), 0);
  cruzado boolean := false;
  espera interval;
  detalle jsonb;
begin
  select asg.id, asg.etapa, asg.frontera_actual_id, asg.cruce_candidato_desde,
         m.origen_id, m.destino_id
    into a
    from public.asignaciones asg join public.misiones m on m.id = asg.mision_id
   where asg.id = p_asignacion;

  select punto, radio_m, pais into destino from public.ubicaciones where id = a.destino_id;

  if a.etapa = 'cargado' then
    select punto, radio_m into origen from public.ubicaciones where id = a.origen_id;
    if not st_dwithin(p_punto, origen.punto, origen.radio_m + margen) then
      a.etapa := public.aplicar_etapa(p_asignacion, 'en_ruta', 'geocerca', p_momento,
                                      jsonb_build_object('motivo', 'salio_de_origen'));
    end if;
  end if;

  if a.etapa in ('cargado', 'en_ruta') then
    -- ¿Dentro de una frontera?
    select id, nombre into frontera
      from public.ubicaciones
     where tipo = 'frontera' and activo and st_dwithin(p_punto, punto, radio_m)
     order by st_distance(p_punto, punto)
     limit 1;
    if frontera.id is not null then
      update public.asignaciones
         set frontera_actual_id = frontera.id, cruce_candidato_desde = null
       where id = p_asignacion;
      return public.aplicar_etapa(p_asignacion, 'en_frontera', 'geocerca', p_momento,
                                  jsonb_build_object('frontera', frontera.nombre));
    end if;

    -- ¿Pasó la frontera sin detenerse (o sin señal) en un viaje a Perú?
    -- Frontera más cercana al punto, que esté "entre" el origen y el destino.
    if destino.pais = 'PE' and a.etapa = 'en_ruta' then
      select punto into origen from public.ubicaciones where id = a.origen_id;
      select f.id, f.nombre, f.punto, f.radio_m into frontera
        from public.ubicaciones f
       where f.tipo = 'frontera' and f.activo
         and st_distance(f.punto, destino.punto) < st_distance(origen.punto, destino.punto)
       order by st_distance(p_punto, f.punto)
       limit 1;
      if frontera.id is not null then
        cruzado := not st_dwithin(p_punto, frontera.punto, frontera.radio_m + margen)
                   and st_distance(p_punto, frontera.punto) < 150000      -- a menos de 150 km de esa frontera
                   and st_distance(p_punto, destino.punto) < st_distance(frontera.punto, destino.punto) - 5000;
        espera := interval '10 minutes';
        detalle := jsonb_build_object('frontera', frontera.nombre, 'motivo', 'cruce_sin_parada');
      end if;
    end if;
  elsif a.etapa = 'en_frontera' then
    if a.frontera_actual_id is null then
      select id into a.frontera_actual_id from public.ubicaciones
       where tipo = 'frontera' and activo order by st_distance(p_punto, punto) limit 1;
      if a.frontera_actual_id is null then
        return a.etapa;
      end if;
      update public.asignaciones set frontera_actual_id = a.frontera_actual_id where id = p_asignacion;
    end if;

    select id, nombre, punto, radio_m into frontera from public.ubicaciones where id = a.frontera_actual_id;
    cruzado := not st_dwithin(p_punto, frontera.punto, frontera.radio_m + margen)
               and st_distance(p_punto, destino.punto) < st_distance(frontera.punto, destino.punto);
    espera := interval '5 minutes';
    detalle := jsonb_build_object('frontera', frontera.nombre);
  else
    return a.etapa;
  end if;

  -- Histéresis: el cruce se confirma solo si los puntos lo siguen indicando durante "espera".
  if not cruzado then
    if a.cruce_candidato_desde is not null then
      update public.asignaciones set cruce_candidato_desde = null where id = p_asignacion;
    end if;
    return a.etapa;
  end if;

  if a.cruce_candidato_desde is null or p_momento < a.cruce_candidato_desde then
    update public.asignaciones set cruce_candidato_desde = p_momento where id = p_asignacion;
    return a.etapa;
  end if;

  if p_momento - a.cruce_candidato_desde >= espera then
    update public.asignaciones set cruce_candidato_desde = null where id = p_asignacion;
    a.etapa := public.aplicar_etapa(p_asignacion, 'cruzo_frontera', 'geocerca', a.cruce_candidato_desde, detalle);
  end if;
  return a.etapa;
end $$;

revoke execute on function public.evaluar_geocercas(uuid, extensions.geography, timestamptz, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Recorrido completo simplificado (Douglas-Peucker) para dibujar en el mapa.
-- Tolerancia en metros (aprox.): 25 m conserva las curvas y reduce mucho los puntos.
-- Usa los permisos de quien llama (RLS de posiciones: solo personal).
-- ---------------------------------------------------------------------------
create or replace function public.recorrido_simplificado(p_asignacion uuid, p_tolerancia_m double precision default 25)
returns table (lat double precision, lon double precision)
language sql stable security invoker
set search_path = public, extensions as $$
  with linea as (
    select st_makeline(p.punto::geometry order by p.capturado_en) as g, count(*) as n
      from public.posiciones p
     where p.asignacion_id = p_asignacion and not p.simulada
  ), simple as (
    select case when n > 2
                then st_simplifypreservetopology(g, greatest(coalesce(p_tolerancia_m, 25), 1) / 111320.0)
                else g end as g
      from linea where g is not null
  )
  select st_y(d.geom), st_x(d.geom)
    from simple, lateral st_dumppoints(simple.g) d
   order by d.path
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function public.reportar_emergencia(uuid, text, double precision, double precision),
  public.atender_emergencia(uuid, text),
  public.recorrido_simplificado(uuid, double precision)
  from public, anon;
grant execute on function public.reportar_emergencia(uuid, text, double precision, double precision),
  public.atender_emergencia(uuid, text),
  public.recorrido_simplificado(uuid, double precision)
  to authenticated;
