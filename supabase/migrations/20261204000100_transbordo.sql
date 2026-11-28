-- =============================================================================
-- Transbordo de carga (tramos).
-- Envíos a Perú: un camión (o varios) lleva la carga de fábrica a El Alto, donde
-- pasa a otro camión (o varios) que sigue hasta Desaguadero o el destino final.
--
--  * Tabla "tramos": un registro por cada tramo DESPUÉS del primero (2 y 3), con la
--    empresa prevista, el lugar de transbordo escrito por despacho y el punto
--    registrado al entregar. Una misión sin registros es una misión de un tramo.
--  * asignaciones.tramo (1 por defecto: lo existente no cambia) y
--    asignaciones.toneladas_declaradas (tramos 2 y 3; el peso de balanza es solo
--    el de fábrica). La suma declarada no puede superar en más de 0,5 % lo pesado;
--    si un tramo sale con faltante mayor al 0,5 % se registra una alerta.
--  * La etapa de la misión sigue al tramo en curso; entre tramos queda «En ruta».
--  * La app del chofer ve como destino el transbordo; el cliente ve un solo envío.
--
-- No borra ni modifica datos existentes. No cambia la lista de etapas.
-- Reversión: supabase/revertir/20261204000100_transbordo.sql
-- =============================================================================
set search_path = public, extensions;

create table public.tramos (
  id                uuid primary key default gen_random_uuid(),
  mision_id         uuid not null references public.misiones (id) on delete cascade,
  numero            smallint not null check (numero between 2 and 3),
  transportista_id  uuid references public.transportistas (id) on delete restrict,
  lugar_inicio      text,                         -- lugar de transbordo (texto de despacho)
  punto_inicio      extensions.geography(Point, 4326),  -- registrado al entregar el tramo anterior
  creado_en         timestamptz not null default now(),
  unique (mision_id, numero)
);
alter table public.tramos enable row level security;
create policy tramos_leer   on public.tramos for select to authenticated using (public.es_personal());
create policy tramos_crear  on public.tramos for insert to authenticated with check (public.puede_editar());
create policy tramos_editar on public.tramos for update to authenticated using (public.puede_editar()) with check (public.puede_editar());
create policy tramos_borrar on public.tramos for delete to authenticated using (public.puede_editar());

alter table public.asignaciones
  add column tramo smallint not null default 1 check (tramo between 1 and 3),
  add column toneladas_declaradas numeric(8, 2) check (toneladas_declaradas >= 0);
create index asignaciones_mision_tramo_idx on public.asignaciones (mision_id, tramo);

-- Último tramo de una misión (1 si no tiene transbordo).
create or replace function public.ultimo_tramo(p_mision uuid)
returns smallint language sql stable security definer
set search_path = public as $$
  select coalesce(max(numero), 1)::smallint from public.tramos where mision_id = p_mision
$$;

-- ---------------------------------------------------------------------------
-- Reglas de los tramos.
-- ---------------------------------------------------------------------------
create or replace function public.trg_validar_tramo_nuevo()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  etapa_mision public.etapa_envio;
begin
  if tg_op = 'DELETE' then
    -- Al borrar la misión completa (cascada) no hay nada que proteger.
    if not exists (select 1 from public.misiones where id = old.mision_id) then
      return old;
    end if;
    if exists (select 1 from public.asignaciones where mision_id = old.mision_id and tramo >= old.numero)
       or exists (select 1 from public.tramos where mision_id = old.mision_id and numero > old.numero) then
      raise exception 'No se puede quitar el tramo %: tiene camiones o hay un tramo posterior.', old.numero;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.numero <> old.numero or new.mision_id <> old.mision_id then
      raise exception 'No se puede cambiar el número ni la misión de un tramo.';
    end if;
    return new;
  end if;
  select etapa into etapa_mision from public.misiones where id = new.mision_id;
  if etapa_mision in ('entregado', 'cancelado') then
    raise exception 'La misión ya está cerrada: no se puede agregar un transbordo.';
  end if;
  if new.numero <> public.ultimo_tramo(new.mision_id) + 1 then
    raise exception 'Los tramos se agregan en orden: el siguiente es el tramo %.', public.ultimo_tramo(new.mision_id) + 1;
  end if;
  if exists (select 1 from public.asignaciones
              where mision_id = new.mision_id and tramo = new.numero - 1 and etapa = 'entregado') then
    raise exception 'Un camión del tramo % ya entregó: el transbordo debe registrarse antes.', new.numero - 1;
  end if;
  return new;
end $$;

create trigger tramos_validar
  before insert or update or delete on public.tramos
  for each row execute function public.trg_validar_tramo_nuevo();

create or replace function public.trg_validar_tramo_camion()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  fabrica numeric;
  declaradas numeric;
begin
  if new.tramo > public.ultimo_tramo(new.mision_id) then
    raise exception 'La misión no tiene tramo %. Agregue primero el transbordo.', new.tramo;
  end if;
  if new.tramo > 1 and new.toneladas_cargadas is not null
     and (tg_op = 'INSERT' or new.toneladas_cargadas is distinct from old.toneladas_cargadas) then
    raise exception 'En el tramo % anote las toneladas declaradas: el peso de balanza se registra solo en fábrica (tramo 1).', new.tramo;
  end if;
  if new.tramo = 1 and new.toneladas_declaradas is not null then
    raise exception 'Las toneladas declaradas son solo para camiones después del transbordo.';
  end if;
  if new.tramo > 1 and new.toneladas_declaradas is not null and new.etapa <> 'cancelado' then
    select sum(toneladas_cargadas) into fabrica
      from public.asignaciones where mision_id = new.mision_id and tramo = 1 and etapa <> 'cancelado';
    select coalesce(sum(toneladas_declaradas), 0) + new.toneladas_declaradas into declaradas
      from public.asignaciones
     where mision_id = new.mision_id and tramo = new.tramo and etapa <> 'cancelado' and id <> new.id;
    if fabrica > 0 and declaradas > fabrica * 1.005 then
      raise exception 'Las toneladas declaradas del tramo % sumarían % TN y superan en más de 0,5 %% las % TN pesadas en fábrica.',
        new.tramo, declaradas, fabrica;
    end if;
  end if;
  return new;
end $$;

create trigger asignaciones_validar_tramo
  before insert or update of tramo, toneladas_cargadas, toneladas_declaradas, mision_id on public.asignaciones
  for each row execute function public.trg_validar_tramo_camion();

-- Al entregar en un transbordo: el punto donde quedó el camión es el inicio del tramo siguiente.
-- Cuando todos los camiones de un tramo 2 o 3 ya cargaron: se comparan las toneladas.
create or replace function public.trg_transbordo()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  fabrica numeric;
  declaradas numeric;
begin
  if new.etapa = 'entregado' and old.etapa <> 'entregado'
     and new.tramo < public.ultimo_tramo(new.mision_id) and new.ultima_lat is not null then
    update public.tramos
       set punto_inicio = st_setsrid(st_makepoint(new.ultima_lon, new.ultima_lat), 4326)::geography
     where mision_id = new.mision_id and numero = new.tramo + 1 and punto_inicio is null;
  end if;

  if new.tramo > 1 and old.etapa = 'programado' and new.etapa not in ('programado', 'cancelado')
     and not exists (select 1 from public.asignaciones
                      where mision_id = new.mision_id and tramo = new.tramo and etapa = 'programado') then
    select sum(toneladas_cargadas) into fabrica
      from public.asignaciones where mision_id = new.mision_id and tramo = 1 and etapa <> 'cancelado';
    select sum(toneladas_declaradas) into declaradas
      from public.asignaciones where mision_id = new.mision_id and tramo = new.tramo and etapa <> 'cancelado';
    if fabrica > 0 and (declaradas is null or abs(declaradas - fabrica) > fabrica * 0.005)
       and not exists (select 1 from public.eventos ev join public.asignaciones x on x.id = ev.asignacion_id
                        where x.mision_id = new.mision_id and ev.tipo = 'incidencia'
                          and ev.detalle ->> 'motivo' = 'diferencia_peso_transbordo'
                          and (ev.detalle ->> 'tramo')::int = new.tramo) then
      insert into public.eventos (asignacion_id, tipo, origen, ocurrido_en, detalle)
      values (new.id, 'incidencia', 'sistema', now(),
              jsonb_build_object('motivo', 'diferencia_peso_transbordo', 'tramo', new.tramo,
                                 'fabrica', fabrica, 'declaradas', declaradas));
    end if;
  end if;
  return new;
end $$;

create trigger asignaciones_transbordo
  after update of etapa on public.asignaciones
  for each row execute function public.trg_transbordo();

-- ---------------------------------------------------------------------------
-- Etapa de la misión: la del tramo en curso (el mayor tramo con algún camión en viaje).
--   * tramo 1 (o misión sin transbordo): igual que antes (la del camión menos avanzado).
--   * un tramo intermedio que ya entregó todo y el siguiente aún no sale: «En ruta».
--   * «Entregado» solo cuando entrega el último tramo.
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_etapa_mision(p_mision uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  ultimo smallint := public.ultimo_tramo(p_mision);
  activo smallint;
  movimiento public.etapa_envio;
  hay_programados boolean;
  entregados int;
  total int;
  nueva public.etapa_envio;
begin
  select coalesce(max(tramo) filter (where etapa not in ('programado', 'cancelado')), 1)
    into activo from public.asignaciones where mision_id = p_mision;

  select min(etapa) filter (where etapa not in ('programado', 'entregado', 'cancelado')),
         coalesce(bool_or(etapa = 'programado'), false),
         count(*) filter (where etapa = 'entregado'),
         count(*)
    into movimiento, hay_programados, entregados, total
    from public.asignaciones where mision_id = p_mision and tramo = activo;

  if activo = 1 then
    nueva := case
      when hay_programados then 'programado'
      when movimiento is not null then movimiento
      when entregados > 0 and activo < ultimo then 'en_ruta'   -- en transbordo
      when entregados > 0 then 'entregado'
      when total > 0 then 'cancelado'
      else 'programado'
    end;
  else
    -- Tramos 2 y 3: la carga ya viene en camino, la misión nunca vuelve atrás de «En ruta».
    nueva := case
      when movimiento is not null then greatest(movimiento, 'en_ruta'::public.etapa_envio)
      when hay_programados then 'en_ruta'
      when entregados > 0 and activo = ultimo then 'entregado'
      else 'en_ruta'
    end;
  end if;

  update public.misiones set etapa = nueva where id = p_mision and etapa is distinct from nueva;
end $$;

-- Al crear o quitar un tramo cambia el último tramo: se recalcula la etapa.
create or replace function public.trg_tramo_etapa()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  perform public.recalcular_etapa_mision(coalesce(new.mision_id, old.mision_id));
  return null;
end $$;
create trigger tramos_etapa_mision
  after insert or delete on public.tramos
  for each row execute function public.trg_tramo_etapa();

-- ---------------------------------------------------------------------------
-- App del chofer: un tramo intermedio tiene como destino el transbordo.
-- ---------------------------------------------------------------------------
create or replace function public.resumen_viaje(p_asignacion uuid)
returns jsonb language sql stable security definer
set search_path = public as $$
  select jsonb_build_object(
    'asignacion_id', a.id,
    'mision_codigo', m.codigo,
    'etapa', a.etapa,
    'tramo', a.tramo,
    'transbordo', sig.id is not null,
    'origen', case when a.tramo > 1 then coalesce(ti.lugar_inicio, 'Punto de transbordo') else o.nombre end,
    'destino', case when sig.id is not null
                    then 'Transbordo: ' || coalesce(sig.lugar_inicio, 'lugar indicado por despacho')
                    else d.nombre || coalesce(' (' || d.ciudad || ')', '') end,
    'destino_pais', case when sig.id is not null then 'BO' else d.pais end,
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
  left join public.tramos ti on ti.mision_id = m.id and ti.numero = a.tramo
  left join public.tramos sig on sig.mision_id = m.id and sig.numero = a.tramo + 1
  where a.id = p_asignacion
$$;

-- ---------------------------------------------------------------------------
-- Geocercas: en los tramos 2 y 3 el origen es el punto de transbordo.
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
  select asg.id, asg.etapa, asg.frontera_actual_id, asg.cruce_candidato_desde, asg.salida_candidata_desde,
         asg.tramo, asg.mision_id, m.origen_id, m.destino_id
    into a
    from public.asignaciones asg join public.misiones m on m.id = asg.mision_id
   where asg.id = p_asignacion;

  select punto, radio_m, pais into destino from public.ubicaciones where id = a.destino_id;

  if a.etapa = 'cargado' then
    if a.tramo > 1 then
      -- Tramo después de un transbordo: el origen es el punto de transbordo (radio 2 km).
      -- Si aún no se conoce, el primer punto de este camión queda como punto de transbordo.
      if not exists (select 1 from public.tramos t
                      where t.mision_id = a.mision_id and t.numero = a.tramo and t.punto_inicio is not null) then
        update public.tramos set punto_inicio = p_punto
         where mision_id = a.mision_id and numero = a.tramo and punto_inicio is null;
        return a.etapa;
      end if;
      select coalesce(t.lugar_inicio, 'el punto de transbordo') as nombre, t.punto_inicio as punto, 2000 as radio_m
        into origen
        from public.tramos t where t.mision_id = a.mision_id and t.numero = a.tramo;
    else
      select nombre, punto, radio_m into origen from public.ubicaciones where id = a.origen_id;
    end if;
    -- Primer punto del viaje a más de 20 km del origen: algo no cuadra (teléfono en otro
    -- lugar, punto de origen mal ubicado). Se avisa a despacho y no se cambia la etapa todavía.
    if not exists (select 1 from public.posiciones po
                    where po.asignacion_id = p_asignacion and not po.simulada and po.capturado_en < p_momento)
       and st_distance(p_punto, origen.punto) > 20000 then
      if not exists (select 1 from public.eventos ev
                      where ev.asignacion_id = p_asignacion and ev.tipo = 'incidencia'
                        and ev.detalle ->> 'motivo' = 'inicio_lejos_de_origen') then
        insert into public.eventos (asignacion_id, tipo, origen, ocurrido_en, hora_dispositivo, detalle)
        values (p_asignacion, 'incidencia', 'sistema', least(p_momento, now()), p_momento,
                jsonb_build_object('motivo', 'inicio_lejos_de_origen', 'origen', origen.nombre,
                                   'km', round((st_distance(p_punto, origen.punto) / 1000)::numeric)));
      end if;
      return a.etapa;
    end if;

    -- Salida de fábrica: se confirma con 2 puntos seguidos fuera de la geocerca
    -- (un solo punto impreciso ya no marca «En ruta»).
    if st_dwithin(p_punto, origen.punto, origen.radio_m + margen) then
      if a.salida_candidata_desde is not null then
        update public.asignaciones set salida_candidata_desde = null where id = p_asignacion;
      end if;
      return a.etapa;
    end if;
    if a.salida_candidata_desde is null or p_momento <= a.salida_candidata_desde then
      update public.asignaciones set salida_candidata_desde = p_momento where id = p_asignacion;
      return a.etapa;
    end if;
    update public.asignaciones set salida_candidata_desde = null where id = p_asignacion;
    a.etapa := public.aplicar_etapa(p_asignacion, 'en_ruta', 'geocerca', a.salida_candidata_desde,
                                    jsonb_build_object('motivo', 'salio_de_origen'));
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
      if a.tramo > 1 then
        select t.punto_inicio as punto into origen
          from public.tramos t where t.mision_id = a.mision_id and t.numero = a.tramo;
      else
        select punto into origen from public.ubicaciones where id = a.origen_id;
      end if;
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
-- Página del cliente: un solo envío (solo el tramo en curso, toneladas de fábrica).
-- ---------------------------------------------------------------------------
create or replace function public.seguimiento_publico(p_token text)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  enl public.enlaces_seguimiento;
  m record;
  fin timestamptz;
  retraso constant interval := interval '15 minutes';
  camiones jsonb;
  hitos jsonb;
  ultimo smallint;
  activo smallint;
  tn_fabrica numeric;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;

  select * into enl from public.enlaces_seguimiento where token = p_token;
  if enl.id is null or enl.estado <> 'activo' or enl.vence_en < now() then
    return null;
  end if;

  select mi.id, mi.codigo, mi.etapa, mi.factura, mi.guia, mi.dex, mi.tipo_carga, mi.tonelaje_objetivo,
         mi.telefono_coordinador,
         c.razon_social as cliente,
         o.nombre as origen, o.ciudad as origen_ciudad,
         d.nombre as destino, d.ciudad as destino_ciudad, d.pais as destino_pais,
         d.lat as destino_lat, d.lon as destino_lon, d.punto as destino_punto
    into m
    from public.misiones mi
    left join public.clientes c on c.id = mi.cliente_id
    join public.ubicaciones o on o.id = mi.origen_id
    join public.ubicaciones d on d.id = mi.destino_id
   where mi.id = enl.mision_id;

  if m.etapa = 'cancelado' then
    return null;
  end if;
  -- Tramos (transbordo): el cliente ve solo los camiones del tramo en curso, como un único envío.
  select coalesce(max(t.numero), 1) into ultimo from public.tramos t where t.mision_id = m.id;
  select coalesce(max(a.tramo) filter (where a.etapa not in ('programado', 'cancelado')), 1),
         sum(a.toneladas_cargadas) filter (where a.tramo = 1 and a.etapa <> 'cancelado')
    into activo, tn_fabrica
    from public.asignaciones a where a.mision_id = m.id;

  if m.etapa = 'entregado' then
    select max(e.ocurrido_en) into fin
      from public.eventos e join public.asignaciones a on a.id = e.asignacion_id
     where a.mision_id = m.id and a.tramo = ultimo and e.etapa_nueva = 'entregado';
    if fin is not null and fin < now() - interval '48 hours' then
      return null;
    end if;
  end if;

  -- Visitas: una nueva si pasaron más de 30 min desde la anterior (la página se refresca sola).
  update public.enlaces_seguimiento
     set visitas = visitas + case when ultima_visita is null or ultima_visita < now() - interval '30 minutes' then 1 else 0 end,
         primera_visita = coalesce(primera_visita, now()),
         ultima_visita = now()
   where id = enl.id;

  -- Cada camión. Posición: la última real con al menos 15 min, redondeada a ~1 km;
  -- si estaba parado (15 min o más en el mismo lugar), solo una zona de ~11 km (1 decimal).
  -- Un camión que ya entregó en un transbordo se muestra «En ruta» y detenido («espera»):
  -- para el cliente la carga sigue en viaje.
  with base as (
    select a.id, a.creado_en, a.detenido_desde, v.placa,
           (a.tramo < ultimo and a.etapa = 'entregado') as espera,
           case when a.tramo < ultimo and a.etapa = 'entregado' then 'en_ruta'::public.etapa_envio else a.etapa end as etapa,
           case when a.tramo = 1 then a.toneladas_cargadas else a.toneladas_declaradas end as toneladas,
           row_number() over (order by a.creado_en) as n,
           p.punto, p.capturado_en,
           case when a.tramo = ultimo then
             (select min(e.ocurrido_en) from public.eventos e
               where e.asignacion_id = a.id and e.etapa_nueva = 'entregado') end as entregado_en
      from public.asignaciones a
      join public.vehiculos v on v.id = a.vehiculo_id
      left join lateral (
        select po.punto, po.capturado_en
          from public.posiciones po
         where po.asignacion_id = a.id and not po.simulada
           and po.capturado_en <= now() - retraso
           and po.capturado_en >= now() - interval '7 days'
         order by po.capturado_en desc
         limit 1
      ) p on a.etapa in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera')
             or (a.tramo < ultimo and a.etapa = 'entregado')
     where a.mision_id = m.id and a.etapa <> 'cancelado' and a.tramo = activo
  ), calc as (
    select b.*,
           case when b.punto is not null then round((st_distance(b.punto, m.destino_punto) / 1000)::numeric) end as km,
           (b.punto is not null and (b.espera or (b.detenido_desde is not null
              and b.detenido_desde <= b.capturado_en - interval '15 minutes'))) as parado
      from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nombre', case when not c.espera and (c.etapa = 'entregado' or (c.km is not null and c.km <= 50))
                          then c.placa else 'Camión ' || c.n end,
           'etapa', c.etapa,
           'toneladas', c.toneladas,
           'parado', c.parado,
           'espera', c.espera,
           'lat', case when c.punto is not null then round(st_y(c.punto::geometry)::numeric, case when c.parado then 1 else 2 end) end,
           'lon', case when c.punto is not null then round(st_x(c.punto::geometry)::numeric, case when c.parado then 1 else 2 end) end,
           'zona', case when c.parado then (
                      select 'a unos ' || round((st_distance(c.punto, u.punto) / 1000)::numeric) || ' km de ' || u.nombre
                        from public.ubicaciones u where u.activo
                       order by st_distance(c.punto, u.punto) limit 1) end,
           'hora_posicion', c.capturado_en,
           'km_al_destino', c.km,
           'entregado_en', c.entregado_en
         ) order by c.creado_en), '[]'::jsonb)
    into camiones
    from calc c;

  -- Hitos: primera vez que algún camión llegó a cada etapa (sin datos de quién la marcó).
  select coalesce(jsonb_agg(jsonb_build_object('etapa', h.etapa, 'hora', h.hora) order by h.hora), '[]'::jsonb)
    into hitos
    from (
      select e.etapa_nueva as etapa, min(e.ocurrido_en) as hora
        from public.eventos e join public.asignaciones a on a.id = e.asignacion_id
       where a.mision_id = m.id and e.tipo = 'cambio_etapa'
         and e.etapa_nueva in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera', 'entregado')
         and not (a.tramo < ultimo and e.etapa_nueva = 'entregado')   -- la entrega en transbordo no es un hito
       group by e.etapa_nueva
    ) h;

  return jsonb_build_object(
    'codigo', m.codigo,
    'etapa', m.etapa,
    'cliente', m.cliente,
    'origen', m.origen || coalesce(' (' || m.origen_ciudad || ')', ''),
    'destino', m.destino || coalesce(' (' || m.destino_ciudad || ')', ''),
    'destino_pais', m.destino_pais,
    'destino_lat', round(m.destino_lat::numeric, 3),
    'destino_lon', round(m.destino_lon::numeric, 3),
    'zona_horaria', case when m.destino_pais = 'PE' then 'America/Lima' else 'America/La_Paz' end,
    'factura', m.factura,
    'guia', m.guia,
    'dex', m.dex,
    'tipo_carga', m.tipo_carga,
    'tonelaje_objetivo', m.tonelaje_objetivo,
    'toneladas_fabrica', tn_fabrica,
    'telefono_contacto', m.telefono_coordinador,
    'retraso_min', 15,
    'camiones', camiones,
    'hitos', hitos,
    'consultado_en', now()
  );
end $$;

revoke execute on function public.ultimo_tramo(uuid) from public, anon;
grant execute on function public.ultimo_tramo(uuid) to authenticated;
revoke execute on function public.trg_validar_tramo_nuevo(), public.trg_validar_tramo_camion(),
  public.trg_transbordo(), public.trg_tramo_etapa() from public, anon, authenticated;
