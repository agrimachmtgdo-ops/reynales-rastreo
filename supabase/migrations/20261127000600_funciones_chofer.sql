-- =============================================================================
-- 6. Funciones de la app del chofer
--
-- El teléfono inicia una sesión ANÓNIMA de Supabase (sin correo ni clave).
-- Luego "activa" el código de invitación: eso enlaza esa sesión con UNA
-- asignación. Desde ahí solo puede:
--   * aceptar la política de rastreo,
--   * marcar etapas (Iniciar viaje, Llegué a frontera, Entregado),
--   * enviar lotes de posiciones de SU camión.
-- Al marcar "Entregado" el acceso se cierra.
-- =============================================================================
set search_path = public, extensions;

-- Invitación vigente que enlaza la sesión actual con la asignación.
create or replace function public.invitacion_de_sesion(p_asignacion uuid)
returns public.invitaciones_chofer language sql stable security definer
set search_path = public as $$
  select i.*
    from public.invitaciones_chofer i
    join public.asignaciones a on a.id = i.asignacion_id
   where i.asignacion_id = p_asignacion
     and i.usado_por = auth.uid()
     and auth.uid() is not null
     and not i.revocada
     and a.etapa not in ('entregado', 'cancelado')
   order by i.usado_en desc
   limit 1
$$;

create or replace function public.politica_vigente()
returns public.politicas_rastreo language sql stable security definer
set search_path = public as $$
  select * from public.politicas_rastreo where vigente limit 1
$$;

create or replace function public.tiene_consentimiento(p_conductor uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.consentimientos c
     where c.conductor_id = p_conductor
       and c.version_politica = (select version from public.politicas_rastreo where vigente limit 1)
  )
$$;

-- Resumen del viaje que ve el chofer (sin datos del cliente que no necesita).
create or replace function public.resumen_viaje(p_asignacion uuid)
returns jsonb language sql stable security definer
set search_path = public as $$
  select jsonb_build_object(
    'asignacion_id', a.id,
    'mision_codigo', m.codigo,
    'etapa', a.etapa,
    'origen', o.nombre,
    'destino', d.nombre || coalesce(' (' || d.ciudad || ')', ''),
    'destino_pais', d.pais,
    'placa', v.placa,
    'conductor', c.nombre,
    'telefono_coordinador', m.telefono_coordinador,
    'requiere_consentimiento', not public.tiene_consentimiento(a.conductor_id),
    'politica', (select jsonb_build_object('version', p.version, 'texto', p.texto) from public.politica_vigente() p)
  )
  from public.asignaciones a
  join public.misiones m on m.id = a.mision_id
  join public.ubicaciones o on o.id = m.origen_id
  join public.ubicaciones d on d.id = m.destino_id
  join public.vehiculos v on v.id = a.vehiculo_id
  join public.conductores c on c.id = a.conductor_id
  where a.id = p_asignacion
$$;

-- ---------------------------------------------------------------------------
-- 1) Activar el código de invitación en este teléfono.
-- ---------------------------------------------------------------------------
create or replace function public.activar_invitacion(p_codigo text, p_dispositivo text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  inv public.invitaciones_chofer;
  etapa_actual public.etapa_envio;
begin
  if auth.uid() is null then
    raise exception 'Sesión no iniciada' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_dispositivo)), 0) < 4 then
    raise exception 'Identificador de teléfono inválido';
  end if;

  select * into inv from public.invitaciones_chofer
   where codigo = upper(replace(trim(p_codigo), ' ', ''))
   for update;

  if inv.id is null or inv.revocada then
    raise exception 'Código no válido o anulado. Pida uno nuevo a despacho.' using errcode = 'P0002';
  end if;

  select etapa into etapa_actual from public.asignaciones where id = inv.asignacion_id;
  if etapa_actual in ('entregado', 'cancelado') then
    raise exception 'Este viaje ya está cerrado.';
  end if;

  if inv.usado_por is null then
    if inv.vence_en < now() then
      raise exception 'El código venció. Pida uno nuevo a despacho.';
    end if;
  elsif inv.dispositivo_id is distinct from p_dispositivo then
    -- Un código sirve para un solo teléfono.
    raise exception 'Este código ya se activó en otro teléfono. Pida uno nuevo a despacho.';
  end if;

  -- Primera activación, o reactivación en el MISMO teléfono (ej. reinstaló la app).
  update public.invitaciones_chofer
     set usado_por = auth.uid(), dispositivo_id = p_dispositivo, usado_en = now()
   where id = inv.id;
  update public.conductores set dispositivo_id = p_dispositivo where id = inv.conductor_id;

  return public.resumen_viaje(inv.asignacion_id);
end $$;

-- ---------------------------------------------------------------------------
-- 2) Viaje vigente de esta sesión (al reabrir la app).
-- ---------------------------------------------------------------------------
create or replace function public.mi_viaje()
returns jsonb language sql stable security definer
set search_path = public as $$
  select public.resumen_viaje(i.asignacion_id)
    from public.invitaciones_chofer i
    join public.asignaciones a on a.id = i.asignacion_id
   where i.usado_por = auth.uid() and auth.uid() is not null
     and not i.revocada and a.etapa not in ('entregado', 'cancelado')
   order by i.usado_en desc
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 3) Aceptar la política de rastreo vigente.
-- ---------------------------------------------------------------------------
create or replace function public.aceptar_politica(p_asignacion uuid, p_version text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  inv public.invitaciones_chofer;
  version_vigente text;
begin
  inv := public.invitacion_de_sesion(p_asignacion);
  if inv.id is null then
    raise exception 'Sin acceso a este viaje' using errcode = '42501';
  end if;
  select p.version into version_vigente from public.politicas_rastreo p where p.vigente;
  if version_vigente is null or version_vigente <> p_version then
    raise exception 'La política cambió. Vuelva a leerla.';
  end if;
  if not public.tiene_consentimiento(inv.conductor_id) then
    insert into public.consentimientos (conductor_id, auth_user_id, version_politica)
    values (inv.conductor_id, auth.uid(), p_version);
  end if;
  return public.resumen_viaje(p_asignacion);
end $$;

-- ---------------------------------------------------------------------------
-- 4) Botones del chofer.
--   "Iniciar viaje"      programado            -> cargado
--   "Llegué a frontera"  cargado / en_ruta     -> en_frontera
--   "Entregado"          cualquier etapa activa -> entregado
-- ---------------------------------------------------------------------------
create or replace function public.marcar_etapa_chofer(p_asignacion uuid, p_etapa public.etapa_envio)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  inv public.invitaciones_chofer;
  actual public.etapa_envio;
begin
  inv := public.invitacion_de_sesion(p_asignacion);
  if inv.id is null then
    raise exception 'Sin acceso a este viaje' using errcode = '42501';
  end if;
  if not public.tiene_consentimiento(inv.conductor_id) then
    raise exception 'Debe aceptar la política de rastreo primero';
  end if;

  select etapa into actual from public.asignaciones where id = p_asignacion;

  if not (
       (p_etapa = 'cargado'     and actual = 'programado')
    or (p_etapa = 'en_frontera' and actual in ('cargado', 'en_ruta'))
    or (p_etapa = 'entregado'   and actual in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera'))
  ) then
    raise exception 'No se puede pasar de "%" a "%"', actual, p_etapa;
  end if;

  perform public.aplicar_etapa(p_asignacion, p_etapa, 'chofer');
  return jsonb_build_object('etapa', p_etapa);
end $$;

-- ---------------------------------------------------------------------------
-- 5) Recibir un lote de posiciones en formato compacto:
--    [[segundos_unix, lat*1e5, lon*1e5, km_h, precision_m, simulada], ...]
--
-- Devuelve: {"recibidas", "nuevas", "etapa", "modo_peru", "rastrear"}
--   rastrear = false indica a la app que apague el GPS (viaje cerrado).
-- ---------------------------------------------------------------------------
create or replace function public.registrar_posiciones(p_asignacion uuid, p_lote jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  inv public.invitaciones_chofer;
  etapa_actual public.etapa_envio;
  recibidas int;
  nuevas int := 0;
  simuladas int := 0;
  fila record;
  u_momento timestamptz;
  u_lat double precision;
  u_lon double precision;
  u_vel smallint;
begin
  -- Sesión cerrada (entregado/cancelado/revocado): se pide a la app que pare.
  inv := public.invitacion_de_sesion(p_asignacion);
  if inv.id is null then
    select etapa into etapa_actual from public.asignaciones a
     where a.id = p_asignacion
       and exists (select 1 from public.invitaciones_chofer i
                    where i.asignacion_id = a.id and i.usado_por = auth.uid());
    if etapa_actual is null then
      raise exception 'Sin acceso a este viaje' using errcode = '42501';
    end if;
    return jsonb_build_object('recibidas', 0, 'nuevas', 0, 'etapa', etapa_actual,
                              'modo_peru', false, 'rastrear', false);
  end if;
  if not public.tiene_consentimiento(inv.conductor_id) then
    raise exception 'Debe aceptar la política de rastreo primero';
  end if;
  if jsonb_typeof(p_lote) <> 'array' then
    raise exception 'El lote debe ser un arreglo';
  end if;
  recibidas := jsonb_array_length(p_lote);
  if recibidas > 500 then
    raise exception 'Máximo 500 posiciones por lote';
  end if;

  select etapa into etapa_actual from public.asignaciones where id = p_asignacion;
  if etapa_actual = 'programado' then
    -- Aún no inició el viaje: no se guarda ubicación (privacidad del chofer).
    return jsonb_build_object('recibidas', recibidas, 'nuevas', 0, 'etapa', etapa_actual,
                              'modo_peru', false, 'rastrear', false);
  end if;

  -- Validar y guardar en orden cronológico; luego evaluar geocercas punto por punto.
  for fila in
    with crudo as (
      select e
        from jsonb_array_elements(p_lote) e
       where jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 6
    ), valores as (
      select to_timestamp((e ->> 0)::bigint) as momento,
             (e ->> 1)::double precision / 1e5 as lat,
             (e ->> 2)::double precision / 1e5 as lon,
             least(greatest((e ->> 3)::int, 0), 300)::smallint as vel,
             least(greatest((e ->> 4)::int, 0), 30000)::smallint as prec,
             (e ->> 5)::int = 1 as sim
        from crudo
    )
    select * from valores
     where lat between -90 and 90 and lon between -180 and 180
       and momento between now() - interval '7 days' and now() + interval '10 minutes'
     order by momento
  loop
    insert into public.posiciones (asignacion_id, capturado_en, punto, velocidad_kmh, precision_m, simulada)
    values (p_asignacion, fila.momento,
            st_setsrid(st_makepoint(fila.lon, fila.lat), 4326)::geography,
            fila.vel, fila.prec, fila.sim)
    on conflict do nothing;

    if found then
      nuevas := nuevas + 1;
      if fila.sim then
        simuladas := simuladas + 1;
      end if;
      -- Solo puntos con precisión aceptable cambian la etapa.
      if fila.prec <= 200 and not fila.sim then
        etapa_actual := public.evaluar_geocercas(
          p_asignacion, st_setsrid(st_makepoint(fila.lon, fila.lat), 4326)::geography, fila.momento);
      end if;
      u_momento := fila.momento; u_lat := fila.lat; u_lon := fila.lon; u_vel := fila.vel;
    end if;
  end loop;

  -- Última posición para el mapa en vivo (si es más reciente que la guardada).
  if u_momento is not null then
    update public.asignaciones
       set ultima_lat = u_lat, ultima_lon = u_lon,
           ultima_velocidad_kmh = u_vel, ultima_senal = u_momento
     where id = p_asignacion and (ultima_senal is null or ultima_senal < u_momento);
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
    'etapa', etapa_actual,
    'modo_peru', etapa_actual = 'cruzo_frontera',
    'rastrear', etapa_actual not in ('entregado', 'cancelado')
  );
end $$;

-- Permisos: funciones internas cerradas; las del chofer, solo con sesión.
revoke execute on function public.invitacion_de_sesion(uuid), public.politica_vigente(),
  public.tiene_consentimiento(uuid), public.resumen_viaje(uuid)
  from public, anon, authenticated;

revoke execute on function public.activar_invitacion(text, text), public.mi_viaje(),
  public.aceptar_politica(uuid, text), public.marcar_etapa_chofer(uuid, public.etapa_envio),
  public.registrar_posiciones(uuid, jsonb)
  from public, anon;
grant execute on function public.activar_invitacion(text, text), public.mi_viaje(),
  public.aceptar_politica(uuid, text), public.marcar_etapa_chofer(uuid, public.etapa_envio),
  public.registrar_posiciones(uuid, jsonb)
  to authenticated;
