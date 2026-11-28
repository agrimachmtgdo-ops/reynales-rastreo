-- ===========================================================================
-- Confiabilidad del rastreo (revisión integral, entrega A)
--   1. La etapa solo avanza cuando la cambia el chofer o una geocerca
--      (un lote atrasado ya no puede reabrir un viaje entregado).
--   2. Geocercas con margen de precisión del GPS (un punto impreciso no cambia la etapa).
--   3. registrar_posiciones:
--      - acepta el último tramo hasta 48 h después de la entrega (sin señal en destino);
--      - descarta puntos anteriores a "Iniciar viaje" (privacidad del chofer);
--      - ignora puntos mal formados en lugar de rechazar el lote entero;
--      - no adelanta la última señal al futuro y no muestra ubicaciones simuladas en el mapa;
--      - informa cuántos puntos descartó.
-- ===========================================================================

-- 1) La etapa solo avanza (salvo despacho, que puede corregir a mano).
create or replace function public.aplicar_etapa(
  p_asignacion uuid,
  p_etapa public.etapa_envio,
  p_origen public.origen_evento,
  p_momento timestamptz default now(),
  p_detalle jsonb default '{}'::jsonb
) returns public.etapa_envio language plpgsql security definer
set search_path = public as $$
declare
  actual public.etapa_envio;
begin
  select etapa into actual from public.asignaciones where id = p_asignacion for update;
  if actual is null then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  if actual = p_etapa then
    return actual;
  end if;
  -- Chofer y geocercas: nunca retroceder ni reabrir un viaje cerrado.
  if p_origen <> 'despacho' and (actual in ('entregado', 'cancelado') or p_etapa < actual) then
    return actual;
  end if;

  update public.asignaciones set etapa = p_etapa where id = p_asignacion;
  insert into public.eventos (asignacion_id, tipo, etapa_nueva, ocurrido_en, origen, detalle, registrado_por)
  values (p_asignacion, 'cambio_etapa', p_etapa, p_momento, p_origen,
          p_detalle || jsonb_build_object('etapa_anterior', actual), auth.uid());

  -- Al entregar o cancelar, se cierra el acceso del chofer a esta misión.
  if p_etapa in ('entregado', 'cancelado') then
    update public.invitaciones_chofer set revocada = true
     where asignacion_id = p_asignacion and not revocada;
  end if;
  return p_etapa;
end $$;

-- 2) Geocercas con margen de precisión: para dar por "salido" de una geocerca,
--    el punto debe estar fuera del radio más su margen de error.
drop function if exists public.evaluar_geocercas(uuid, extensions.geography, timestamptz);

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
begin
  select asg.id, asg.etapa, asg.frontera_actual_id, m.origen_id, m.destino_id
    into a
    from public.asignaciones asg join public.misiones m on m.id = asg.mision_id
   where asg.id = p_asignacion;

  if a.etapa = 'cargado' then
    select punto, radio_m into origen from public.ubicaciones where id = a.origen_id;
    if not st_dwithin(p_punto, origen.punto, origen.radio_m + margen) then
      a.etapa := public.aplicar_etapa(p_asignacion, 'en_ruta', 'geocerca', p_momento,
                                      jsonb_build_object('motivo', 'salio_de_origen'));
    end if;
  end if;

  if a.etapa in ('cargado', 'en_ruta') then
    select id, nombre into frontera
      from public.ubicaciones
     where tipo = 'frontera' and activo and st_dwithin(p_punto, punto, radio_m)
     order by st_distance(p_punto, punto)
     limit 1;
    if frontera.id is not null then
      update public.asignaciones set frontera_actual_id = frontera.id where id = p_asignacion;
      a.etapa := public.aplicar_etapa(p_asignacion, 'en_frontera', 'geocerca', p_momento,
                                      jsonb_build_object('frontera', frontera.nombre));
    end if;
    return a.etapa;
  end if;

  if a.etapa = 'en_frontera' then
    if a.frontera_actual_id is null then
      select id into a.frontera_actual_id from public.ubicaciones
       where tipo = 'frontera' and activo order by st_distance(p_punto, punto) limit 1;
      if a.frontera_actual_id is null then
        return a.etapa;
      end if;
      update public.asignaciones set frontera_actual_id = a.frontera_actual_id where id = p_asignacion;
    end if;

    select id, nombre, punto, radio_m into frontera from public.ubicaciones where id = a.frontera_actual_id;
    select punto into destino from public.ubicaciones where id = a.destino_id;

    if not st_dwithin(p_punto, frontera.punto, frontera.radio_m + margen)
       and st_distance(p_punto, destino.punto) < st_distance(frontera.punto, destino.punto) then
      a.etapa := public.aplicar_etapa(p_asignacion, 'cruzo_frontera', 'geocerca', p_momento,
                                      jsonb_build_object('frontera', frontera.nombre));
    end if;
  end if;

  return a.etapa;
end $$;

revoke execute on function public.evaluar_geocercas(uuid, extensions.geography, timestamptz, integer)
  from public, anon, authenticated;

-- 3) Recepción de posiciones.
create or replace function public.registrar_posiciones(p_asignacion uuid, p_lote jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  inv public.invitaciones_chofer;
  etapa_actual public.etapa_envio;
  cierre boolean := false;        -- true = último tramo enviado después de la entrega
  t_inicio timestamptz;
  t_fin timestamptz;
  recibidas int;
  validas int := 0;
  nuevas int := 0;
  simuladas int := 0;
  fila record;
  u_momento timestamptz;
  u_lat double precision;
  u_lon double precision;
  u_vel smallint;
begin
  inv := public.invitacion_de_sesion(p_asignacion);
  if inv.id is null then
    -- ¿Es el teléfono que hizo el viaje (última activación) y el viaje se entregó hace menos de 48 h?
    select a.etapa into etapa_actual
      from public.asignaciones a
     where a.id = p_asignacion
       and exists (
         select 1 from public.invitaciones_chofer i
          where i.asignacion_id = a.id and i.usado_por = auth.uid() and auth.uid() is not null
            and i.usado_en = (select max(i2.usado_en) from public.invitaciones_chofer i2
                               where i2.asignacion_id = a.id));
    if etapa_actual is null then
      raise exception 'Sin acceso a este viaje' using errcode = '42501';
    end if;
    select max(ocurrido_en) into t_fin from public.eventos
     where asignacion_id = p_asignacion and etapa_nueva = 'entregado';
    if etapa_actual <> 'entregado' or t_fin is null or t_fin < now() - interval '48 hours' then
      return jsonb_build_object('recibidas', 0, 'nuevas', 0, 'descartadas', 0, 'etapa', etapa_actual,
                                'modo_peru', false, 'rastrear', false);
    end if;
    cierre := true;
  else
    if not public.tiene_consentimiento(inv.conductor_id) then
      raise exception 'Debe aceptar la política de rastreo primero';
    end if;
    select etapa into etapa_actual from public.asignaciones where id = p_asignacion;
    if etapa_actual = 'programado' then
      -- Aún no inició el viaje: no se guarda ubicación (privacidad del chofer).
      return jsonb_build_object('recibidas', 0, 'nuevas', 0, 'descartadas', 0, 'etapa', etapa_actual,
                                'modo_peru', false, 'rastrear', false);
    end if;
    t_fin := now() + interval '2 minutes';
  end if;

  if jsonb_typeof(p_lote) <> 'array' then
    raise exception 'El lote debe ser un arreglo';
  end if;
  recibidas := jsonb_array_length(p_lote);
  if recibidas > 500 then
    raise exception 'Máximo 500 posiciones por lote';
  end if;

  -- Solo desde "Iniciar viaje" (privacidad) y como máximo 7 días atrás.
  select max(ocurrido_en) into t_inicio from public.eventos
   where asignacion_id = p_asignacion and etapa_nueva = 'cargado';
  t_inicio := greatest(coalesce(t_inicio, now() - interval '7 days'), now() - interval '7 days');

  for fila in
    with crudo as (
      -- Se ignoran los puntos mal formados (no rechazan el lote completo).
      select e
        from jsonb_array_elements(p_lote) e
       where jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 6
         and jsonb_typeof(e -> 0) = 'number' and jsonb_typeof(e -> 1) = 'number'
         and jsonb_typeof(e -> 2) = 'number' and jsonb_typeof(e -> 3) = 'number'
         and jsonb_typeof(e -> 4) = 'number' and jsonb_typeof(e -> 5) = 'number'
         and abs((e ->> 0)::numeric) < 1e11
    ), valores as (
      select to_timestamp(floor((e ->> 0)::numeric)::bigint) as momento,
             (e ->> 1)::double precision / 1e5 as lat,
             (e ->> 2)::double precision / 1e5 as lon,
             least(greatest(round((e ->> 3)::numeric), 0), 300)::smallint as vel,
             least(greatest(round((e ->> 4)::numeric), 0), 30000)::smallint as prec,
             (e ->> 5)::numeric = 1 as sim
        from crudo
    )
    select * from valores
     where lat between -90 and 90 and lon between -180 and 180
       and momento between t_inicio and least(t_fin, now() + interval '10 minutes')
     order by momento
  loop
    validas := validas + 1;
    insert into public.posiciones (asignacion_id, capturado_en, punto, velocidad_kmh, precision_m, simulada)
    values (p_asignacion, fila.momento,
            st_setsrid(st_makepoint(fila.lon, fila.lat), 4326)::geography,
            fila.vel, fila.prec, fila.sim)
    on conflict do nothing;

    if found then
      nuevas := nuevas + 1;
      if fila.sim then
        simuladas := simuladas + 1;
      else
        -- Solo puntos reales y con precisión aceptable cambian la etapa (nunca tras la entrega).
        if not cierre and fila.prec <= 200 then
          etapa_actual := public.evaluar_geocercas(
            p_asignacion, st_setsrid(st_makepoint(fila.lon, fila.lat), 4326)::geography,
            fila.momento, fila.prec);
        end if;
        u_momento := fila.momento; u_lat := fila.lat; u_lon := fila.lon; u_vel := fila.vel;
      end if;
    end if;
  end loop;

  -- Última posición real para el mapa en vivo (nunca en el futuro).
  if u_momento is not null then
    update public.asignaciones
       set ultima_lat = u_lat, ultima_lon = u_lon,
           ultima_velocidad_kmh = u_vel, ultima_senal = least(u_momento, now())
     where id = p_asignacion and (ultima_senal is null or ultima_senal < least(u_momento, now()));
  end if;

  if simuladas > 0 then
    insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
    values (p_asignacion, 'incidencia', 'sistema',
            jsonb_build_object('motivo', 'ubicacion_simulada', 'cantidad', simuladas), auth.uid());
  end if;

  select etapa into etapa_actual from public.asignaciones where id = p_asignacion;
  return jsonb_build_object(
    'recibidas', recibidas,
    'nuevas', nuevas,
    'descartadas', recibidas - validas,
    'etapa', etapa_actual,
    'modo_peru', etapa_actual = 'cruzo_frontera',
    'rastrear', not cierre and etapa_actual not in ('entregado', 'cancelado')
  );
end $$;

revoke execute on function public.registrar_posiciones(uuid, jsonb) from public, anon;
grant execute on function public.registrar_posiciones(uuid, jsonb) to authenticated;
