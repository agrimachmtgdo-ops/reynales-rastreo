-- =============================================================================
-- Entrega C: seguridad de los códigos, datos falsos y mantenimiento automático.
--   1) Códigos de invitación: límite de intentos, un solo mensaje de error,
--      aviso a despacho al activar, gerencia ya no lee los códigos.
--   2) Posiciones: se marcan los saltos imposibles (> 150 km/h).
--   3) Mantenimiento mensual: particiones futuras y borrado de posiciones
--      de más de 12 meses, guardando antes un resumen de cada viaje.
--   4) Avisos de chofer o camión ocupado en otro viaje activo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a) Registro de intentos de activación fallidos.
-- ---------------------------------------------------------------------------
create table public.intentos_activacion (
  id            bigint generated always as identity primary key,
  usuario       uuid,
  dispositivo   text,
  ocurrido_en   timestamptz not null default now()
);
create index intentos_activacion_usuario_idx on public.intentos_activacion (usuario, ocurrido_en desc);
create index intentos_activacion_dispositivo_idx on public.intentos_activacion (dispositivo, ocurrido_en desc);
alter table public.intentos_activacion enable row level security;
revoke all on public.intentos_activacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b) Activación del código.
-- Ante un código inexistente, anulado o vencido devuelve NULL (sin error) para que
-- el intento quede registrado: un error desharía el registro. La app muestra un
-- único mensaje, que no revela si el código existe.
-- Máximo 5 intentos fallidos por hora por teléfono y por sesión.
-- ---------------------------------------------------------------------------
create or replace function public.activar_invitacion(p_codigo text, p_dispositivo text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  inv public.invitaciones_chofer;
  etapa_actual public.etapa_envio;
  disp text := trim(coalesce(p_dispositivo, ''));
  fallidos int;
begin
  if auth.uid() is null then
    raise exception 'Sesión no iniciada' using errcode = '42501';
  end if;
  if length(disp) < 4 or lower(disp) in ('desconocido', 'unknown', 'null', 'undefined') then
    raise exception 'Identificador de teléfono inválido';
  end if;

  select count(*) into fallidos from public.intentos_activacion
   where ocurrido_en > now() - interval '1 hour'
     and (usuario = auth.uid() or dispositivo = disp);
  if fallidos >= 5 then
    raise exception 'Demasiados intentos. Espere una hora o pida ayuda a despacho.';
  end if;

  select * into inv from public.invitaciones_chofer
   where codigo = upper(replace(trim(p_codigo), ' ', ''))
   for update;

  if inv.id is null or inv.revocada
     or (inv.usado_por is null and inv.vence_en < now())
     or (inv.usado_por is not null and inv.dispositivo_id is distinct from disp) then
    insert into public.intentos_activacion (usuario, dispositivo) values (auth.uid(), disp);
    return null;
  end if;

  select etapa into etapa_actual from public.asignaciones where id = inv.asignacion_id;
  if etapa_actual in ('entregado', 'cancelado') then
    raise exception 'Este viaje ya está cerrado.';
  end if;

  -- Primera activación, o reactivación en el MISMO teléfono (ej. reinstaló la app).
  update public.invitaciones_chofer
     set usado_por = auth.uid(), dispositivo_id = disp, usado_en = now()
   where id = inv.id;
  update public.conductores set dispositivo_id = disp where id = inv.conductor_id;

  -- Despacho ve en los eventos cuándo y en qué teléfono se activó.
  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (inv.asignacion_id, 'nota', 'sistema',
          jsonb_build_object('motivo', case when inv.usado_por is null then 'activacion' else 'reactivacion' end,
                             'dispositivo', right(disp, 4)),
          auth.uid());

  return public.resumen_viaje(inv.asignacion_id);
end $$;

-- Para que la app explique por qué no puede activar.
create or replace function public.estado_activacion(p_dispositivo text)
returns jsonb language sql stable security definer
set search_path = public as $$
  select jsonb_build_object(
    'bloqueado', count(*) >= 5,
    'intentos_restantes', greatest(5 - count(*), 0))
    from public.intentos_activacion
   where ocurrido_en > now() - interval '1 hour'
     and (usuario = auth.uid() or dispositivo = trim(coalesce(p_dispositivo, '')))
$$;

revoke execute on function public.activar_invitacion(text, text), public.estado_activacion(text) from public, anon;
grant execute on function public.activar_invitacion(text, text), public.estado_activacion(text) to authenticated;

-- 1c) Los códigos vigentes solo los ven administrador y despacho (no gerencia).
drop policy if exists invitaciones_leer on public.invitaciones_chofer;
create policy invitaciones_leer on public.invitaciones_chofer
  for select to authenticated using (public.puede_editar());

-- ---------------------------------------------------------------------------
-- 2) Recepción de posiciones, con detección de saltos imposibles.
-- ---------------------------------------------------------------------------
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
  -- Detección de saltos imposibles (posible GPS falso o error grave del teléfono).
  p_lat double precision;
  p_lon double precision;
  p_t timestamptz;
  dist_m double precision;
  saltos int := 0;
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

  -- Punto de referencia para detectar saltos: la última posición real conocida.
  select ultima_lat, ultima_lon, ultima_senal into p_lat, p_lon, p_t
    from public.asignaciones where id = p_asignacion;

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
      if not fila.sim and p_t is not null and fila.momento > p_t then
        dist_m := st_distance(st_setsrid(st_makepoint(fila.lon, fila.lat), 4326)::geography,
                              st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography);
        -- Más de 2 km a más de 150 km/h: el camión no pudo hacer ese recorrido.
        if dist_m > 2000 and dist_m / greatest(extract(epoch from fila.momento - p_t), 1) > 150 / 3.6 then
          saltos := saltos + 1;
          -- Se guarda como evidencia, marcado como no confiable: no cambia la etapa,
          -- ni el mapa, ni el recorrido.
          update public.posiciones set simulada = true
           where asignacion_id = p_asignacion and capturado_en = fila.momento;
          continue;
        end if;
      end if;

      if fila.sim then
        simuladas := simuladas + 1;
      else
        p_lat := fila.lat; p_lon := fila.lon; p_t := fila.momento;
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

  if saltos > 0 then
    insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
    values (p_asignacion, 'incidencia', 'sistema',
            jsonb_build_object('motivo', 'salto_ubicacion', 'cantidad', saltos), auth.uid());
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

-- ---------------------------------------------------------------------------
-- 3) Resumen de cada viaje y mantenimiento mensual.
-- ---------------------------------------------------------------------------
create table public.resumenes_recorrido (
  asignacion_id  uuid primary key references public.asignaciones (id) on delete cascade,
  puntos         integer not null,
  km             numeric(9, 1) not null,
  inicio         timestamptz,
  fin            timestamptz,
  linea          extensions.geography(LineString, 4326),   -- recorrido simplificado (~200 m)
  creado_en      timestamptz not null default now()
);
alter table public.resumenes_recorrido enable row level security;
create policy resumenes_leer on public.resumenes_recorrido
  for select to authenticated using (public.es_personal());

create or replace function public.guardar_resumen_recorrido(p_asignacion uuid)
returns void language sql security definer
set search_path = public, extensions as $$
  insert into public.resumenes_recorrido (asignacion_id, puntos, km, inicio, fin, linea)
  select p_asignacion, count(*),
         round((coalesce(st_length(st_makeline(p.punto::geometry order by p.capturado_en)::geography), 0) / 1000)::numeric, 1),
         min(p.capturado_en), max(p.capturado_en),
         case when count(*) > 1
              then st_simplifypreservetopology(st_makeline(p.punto::geometry order by p.capturado_en), 0.002)::geography
         end
    from public.posiciones p
   where p.asignacion_id = p_asignacion and not p.simulada
  having count(*) > 0
  on conflict (asignacion_id) do nothing
$$;

-- Crea particiones para los próximos 24 meses y borra los meses con más de
-- 12 meses de antigüedad (antes guarda el resumen de los viajes afectados).
create or replace function public.mantenimiento_mensual(p_meses_retencion int default 12)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  limite date := (date_trunc('month', now()) - make_interval(months => greatest(p_meses_retencion, 6)))::date;
  creadas int;
  borradas int := 0;
  part record;
  fin_particion date;
begin
  creadas := public.crear_particiones_posiciones(date_trunc('month', now())::date, 24);

  for part in
    select c.relname
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      join pg_class padre on padre.oid = i.inhparent
     where padre.relname = 'posiciones' and c.relname ~ '^posiciones_[0-9]{4}_[0-9]{2}$'
     order by c.relname
  loop
    fin_particion := (to_date(substr(part.relname, 12), 'YYYY_MM') + interval '1 month')::date;
    continue when fin_particion > limite;
    perform public.guardar_resumen_recorrido(x.asignacion_id)
       from (select distinct asignacion_id from public.posiciones
              where capturado_en >= fin_particion - interval '1 month' and capturado_en < fin_particion) x;
    execute format('drop table public.%I', part.relname);
    borradas := borradas + 1;
  end loop;

  return jsonb_build_object('particiones_creadas', creadas, 'meses_borrados', borradas, 'limite', limite);
end $$;

revoke execute on function public.guardar_resumen_recorrido(uuid), public.mantenimiento_mensual(int)
  from public, anon, authenticated;

-- Programación mensual con pg_cron (día 1 a las 03:00 de Bolivia = 07:00 UTC).
-- Si pg_cron no está disponible (por ejemplo en pruebas locales) se omite sin error.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('reynales-mantenimiento-mensual', '0 7 1 * *', 'select public.mantenimiento_mensual()');
  end if;
exception when others then
  raise notice 'pg_cron no disponible: programe mantenimiento_mensual() a mano (%).', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 4) ¿El chofer o el camión ya están en otro viaje activo?
-- ---------------------------------------------------------------------------
create or replace function public.viajes_activos_de(p_conductor uuid, p_vehiculo uuid, p_excluir_mision uuid default null)
returns table (mision_codigo text, placa text, chofer text, por_chofer boolean, por_vehiculo boolean)
language sql stable security invoker
set search_path = public as $$
  select m.codigo, v.placa, c.nombre, a.conductor_id = p_conductor, a.vehiculo_id = p_vehiculo
    from public.asignaciones a
    join public.misiones m on m.id = a.mision_id
    join public.vehiculos v on v.id = a.vehiculo_id
    join public.conductores c on c.id = a.conductor_id
   where a.etapa not in ('entregado', 'cancelado')
     and (a.conductor_id = p_conductor or a.vehiculo_id = p_vehiculo)
     and (p_excluir_mision is null or a.mision_id <> p_excluir_mision)
$$;
revoke execute on function public.viajes_activos_de(uuid, uuid, uuid) from public, anon;
grant execute on function public.viajes_activos_de(uuid, uuid, uuid) to authenticated;
