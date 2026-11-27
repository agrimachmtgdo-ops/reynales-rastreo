-- =============================================================================
-- 5. Etapas, geocercas y funciones del panel de despacho
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- La etapa de la misión se calcula a partir de sus camiones:
--   * todos entregados                -> entregado
--   * hay camiones pendientes         -> la etapa del camión MENOS avanzado
--   * todos cancelados / sin camiones -> cancelado / programado
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_etapa_mision(p_mision uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  pendiente public.etapa_envio;
  entregados int;
  total int;
  nueva public.etapa_envio;
begin
  select min(etapa) filter (where etapa not in ('entregado', 'cancelado')),
         count(*) filter (where etapa = 'entregado'),
         count(*)
    into pendiente, entregados, total
    from public.asignaciones where mision_id = p_mision;

  nueva := case
    when pendiente is not null then pendiente
    when entregados > 0 then 'entregado'
    when total > 0 then 'cancelado'
    else 'programado'
  end;

  update public.misiones set etapa = nueva where id = p_mision and etapa is distinct from nueva;
end $$;

create or replace function public.trg_asignacion_etapa()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalcular_etapa_mision(old.mision_id);
    return old;
  end if;
  perform public.recalcular_etapa_mision(new.mision_id);
  return new;
end $$;

create trigger asignaciones_etapa_mision
  after insert or delete or update of etapa on public.asignaciones
  for each row execute function public.trg_asignacion_etapa();

-- ---------------------------------------------------------------------------
-- Aplica un cambio de etapa y deja constancia en "eventos". Uso interno.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Geocercas: decide la etapa a partir de una posición.
--   cargado          + fuera de la fábrica de origen      -> en_ruta
--   cargado/en_ruta  + dentro de una geocerca fronteriza  -> en_frontera
--   en_frontera      + fuera de esa geocerca y más cerca
--                      del destino que el paso fronterizo -> cruzo_frontera
-- ---------------------------------------------------------------------------
create or replace function public.evaluar_geocercas(
  p_asignacion uuid,
  p_punto extensions.geography,
  p_momento timestamptz
) returns public.etapa_envio language plpgsql security definer
set search_path = public, extensions as $$
declare
  a record;
  origen record;
  destino record;
  frontera record;
begin
  select asg.id, asg.etapa, asg.frontera_actual_id, m.origen_id, m.destino_id
    into a
    from public.asignaciones asg join public.misiones m on m.id = asg.mision_id
   where asg.id = p_asignacion;

  if a.etapa = 'cargado' then
    select punto, radio_m into origen from public.ubicaciones where id = a.origen_id;
    if not st_dwithin(p_punto, origen.punto, origen.radio_m) then
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
    -- Si el chofer marcó "Llegué a frontera" a mano, se toma el paso fronterizo más cercano.
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

    if not st_dwithin(p_punto, frontera.punto, frontera.radio_m)
       and st_distance(p_punto, destino.punto) < st_distance(frontera.punto, destino.punto) then
      a.etapa := public.aplicar_etapa(p_asignacion, 'cruzo_frontera', 'geocerca', p_momento,
                                      jsonb_build_object('frontera', frontera.nombre));
    end if;
  end if;

  return a.etapa;
end $$;

-- ---------------------------------------------------------------------------
-- DESPACHO: crear invitación para el chofer de una asignación.
-- Devuelve un código de 8 caracteres (para escribir o para el QR).
-- ---------------------------------------------------------------------------
create or replace function public.crear_invitacion(p_asignacion uuid, p_horas int default 72)
returns table (codigo text, vence_en timestamptz)
language plpgsql security definer
set search_path = public as $$
declare
  asg record;
  nuevo text;
begin
  if not public.puede_editar() then
    raise exception 'No tiene permiso para invitar choferes' using errcode = '42501';
  end if;
  if p_horas not between 1 and 336 then
    raise exception 'La vigencia debe estar entre 1 y 336 horas';
  end if;

  select id, conductor_id, etapa into asg from public.asignaciones where id = p_asignacion;
  if asg.id is null then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  if asg.etapa in ('entregado', 'cancelado') then
    raise exception 'La asignación ya está cerrada';
  end if;

  -- Una sola invitación vigente por asignación.
  update public.invitaciones_chofer set revocada = true
   where asignacion_id = p_asignacion and not revocada;

  loop
    nuevo := public.generar_codigo(8);
    exit when not exists (select 1 from public.invitaciones_chofer i where i.codigo = nuevo);
  end loop;

  insert into public.invitaciones_chofer (asignacion_id, conductor_id, codigo, vence_en)
  values (p_asignacion, asg.conductor_id, nuevo, now() + make_interval(hours => p_horas));

  return query select nuevo, now() + make_interval(hours => p_horas);
end $$;

-- ---------------------------------------------------------------------------
-- DESPACHO: modo manual de contingencia (si falla la app del chofer).
-- ---------------------------------------------------------------------------
create or replace function public.cambiar_etapa_manual(
  p_asignacion uuid,
  p_etapa public.etapa_envio,
  p_nota text default null
) returns public.etapa_envio language plpgsql security definer
set search_path = public as $$
begin
  if not public.puede_editar() then
    raise exception 'No tiene permiso para cambiar etapas' using errcode = '42501';
  end if;
  return public.aplicar_etapa(p_asignacion, p_etapa, 'despacho', now(),
                              jsonb_build_object('nota', p_nota));
end $$;

-- ---------------------------------------------------------------------------
-- DESPACHO: recorrido de un camión (para dibujar la línea en el mapa).
-- Usa los permisos de quien llama (RLS de posiciones).
-- ---------------------------------------------------------------------------
create or replace function public.recorrido_asignacion(p_asignacion uuid, p_limite int default 2000)
returns table (capturado_en timestamptz, lat double precision, lon double precision,
               velocidad_kmh smallint, simulada boolean)
language sql stable security invoker
set search_path = public, extensions as $$
  select p.capturado_en, st_y(p.punto::geometry), st_x(p.punto::geometry), p.velocidad_kmh, p.simulada
    from public.posiciones p
   where p.asignacion_id = p_asignacion
   order by p.capturado_en desc
   limit least(p_limite, 10000)
$$;

-- Permisos de ejecución
revoke execute on function public.recalcular_etapa_mision(uuid), public.trg_asignacion_etapa(),
  public.aplicar_etapa(uuid, public.etapa_envio, public.origen_evento, timestamptz, jsonb),
  public.evaluar_geocercas(uuid, extensions.geography, timestamptz)
  from public, anon, authenticated;

-- generar_codigo se usa como valor por defecto del código de misión.
revoke execute on function public.generar_codigo(int) from public, anon;
grant execute on function public.generar_codigo(int) to authenticated;

revoke execute on function public.crear_invitacion(uuid, int),
  public.cambiar_etapa_manual(uuid, public.etapa_envio, text),
  public.recorrido_asignacion(uuid, int)
  from public, anon;
grant execute on function public.crear_invitacion(uuid, int),
  public.cambiar_etapa_manual(uuid, public.etapa_envio, text),
  public.recorrido_asignacion(uuid, int)
  to authenticated;
