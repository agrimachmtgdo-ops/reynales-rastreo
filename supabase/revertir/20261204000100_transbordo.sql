-- =============================================================================
-- REVERTIR la migración 20261204000100_transbordo.sql
-- Vuelve a las funciones anteriores y quita la tabla de tramos y las columnas
-- nuevas. Los camiones de tramos 2 y 3 quedan como camiones comunes de la misión
-- (se pierde a qué tramo pertenecían, el lugar de transbordo y las toneladas
-- declaradas). No toca ningún otro dato.
-- =============================================================================
begin;
set search_path = public, extensions;

drop trigger if exists asignaciones_transbordo on public.asignaciones;
drop trigger if exists asignaciones_validar_tramo on public.asignaciones;
drop trigger if exists tramos_validar on public.tramos;
drop trigger if exists tramos_etapa_mision on public.tramos;
drop function if exists public.trg_transbordo();
drop function if exists public.trg_validar_tramo_camion();
drop function if exists public.trg_validar_tramo_nuevo();
drop function if exists public.trg_tramo_etapa();

-- Funciones como estaban antes.
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
         m.origen_id, m.destino_id
    into a
    from public.asignaciones asg join public.misiones m on m.id = asg.mision_id
   where asg.id = p_asignacion;

  select punto, radio_m, pais into destino from public.ubicaciones where id = a.destino_id;

  if a.etapa = 'cargado' then
    select nombre, punto, radio_m into origen from public.ubicaciones where id = a.origen_id;
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
  if m.etapa = 'entregado' then
    select max(e.ocurrido_en) into fin
      from public.eventos e join public.asignaciones a on a.id = e.asignacion_id
     where a.mision_id = m.id and e.etapa_nueva = 'entregado';
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
  with base as (
    select a.id, a.etapa, a.creado_en, a.toneladas_cargadas, a.detenido_desde, v.placa,
           row_number() over (order by a.creado_en) as n,
           p.punto, p.capturado_en,
           (select min(e.ocurrido_en) from public.eventos e
             where e.asignacion_id = a.id and e.etapa_nueva = 'entregado') as entregado_en
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
     where a.mision_id = m.id and a.etapa <> 'cancelado'
  ), calc as (
    select b.*,
           case when b.punto is not null then round((st_distance(b.punto, m.destino_punto) / 1000)::numeric) end as km,
           (b.punto is not null and b.detenido_desde is not null
              and b.detenido_desde <= b.capturado_en - interval '15 minutes') as parado
      from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nombre', case when c.etapa = 'entregado' or (c.km is not null and c.km <= 50)
                          then c.placa else 'Camión ' || c.n end,
           'etapa', c.etapa,
           'toneladas', c.toneladas_cargadas,
           'parado', c.parado,
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
    'telefono_contacto', m.telefono_coordinador,
    'retraso_min', 15,
    'camiones', camiones,
    'hitos', hitos,
    'consultado_en', now()
  );
end $$;


drop function if exists public.ultimo_tramo(uuid);
drop index if exists public.asignaciones_mision_tramo_idx;
alter table public.asignaciones
  drop column if exists tramo,
  drop column if exists toneladas_declaradas;
drop table if exists public.tramos;

-- Etapa de cada misión con la regla anterior.
select public.recalcular_etapa_mision(id) from public.misiones;
commit;
