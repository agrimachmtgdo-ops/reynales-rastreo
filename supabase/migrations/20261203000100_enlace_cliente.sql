-- =============================================================================
-- Fase 3.1: enlace público de seguimiento para el cliente.
--   - Despacho crea (o reemplaza) un enlace por misión y puede anularlo.
--   - Quien tenga el enlace ve, sin iniciar sesión: etapas con su hora, cada
--     camión con su posición 15 min atrasada y redondeada a ~1 km, km al destino
--     y toneladas cargadas. Si el camión está parado, solo la zona (sin punto).
--     La placa se muestra solo a menos de 50 km del destino (o ya entregado).
--   - Nunca: nombre, CI ni teléfono del chofer, códigos, alertas ni recorrido.
--   - Deja de funcionar 48 h después de la entrega, al cancelar, al anular o a
--     los 60 días.
--   - Registro de visitas (sin IP): cantidad, primera y última.
-- Reversible: supabase/revertir/20261203000100_enlace_cliente.sql
-- =============================================================================

create index if not exists enlaces_seguimiento_mision_idx on public.enlaces_seguimiento (mision_id);

alter table public.enlaces_seguimiento
  add column if not exists visitas         integer not null default 0,  -- aperturas (separadas por 30 min)
  add column if not exists primera_visita  timestamptz,
  add column if not exists ultima_visita   timestamptz;

-- ---------------------------------------------------------------------------
-- Despacho: crear (reemplaza el anterior) y anular.
-- ---------------------------------------------------------------------------
create or replace function public.crear_enlace_seguimiento(p_mision uuid)
returns text language plpgsql security definer
set search_path = public, extensions as $$
declare
  nuevo text;
  etapa_mision public.etapa_envio;
begin
  if not public.puede_editar() then
    raise exception 'No tiene permiso para crear enlaces' using errcode = '42501';
  end if;
  select etapa into etapa_mision from public.misiones where id = p_mision;
  if etapa_mision is null then
    raise exception 'Misión no encontrada' using errcode = 'P0002';
  end if;
  if etapa_mision = 'cancelado' then
    raise exception 'La misión está cancelada';
  end if;

  update public.enlaces_seguimiento set estado = 'revocado'
   where mision_id = p_mision and estado = 'activo';

  insert into public.enlaces_seguimiento (mision_id, vence_en)
  values (p_mision, now() + interval '60 days')
  returning token into nuevo;
  return nuevo;
end $$;

create or replace function public.anular_enlace_seguimiento(p_mision uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.puede_editar() then
    raise exception 'No tiene permiso para anular enlaces' using errcode = '42501';
  end if;
  update public.enlaces_seguimiento set estado = 'revocado'
   where mision_id = p_mision and estado = 'activo';
end $$;

-- ---------------------------------------------------------------------------
-- Consulta pública (sin sesión). Devuelve NULL si el enlace no existe o venció.
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
  -- si estaba parado (15 min o más en el mismo lugar), solo la zona, sin coordenadas.
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
           'lat', case when c.punto is not null and not c.parado then round(st_y(c.punto::geometry)::numeric, 2) end,
           'lon', case when c.punto is not null and not c.parado then round(st_x(c.punto::geometry)::numeric, 2) end,
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

revoke execute on function public.crear_enlace_seguimiento(uuid), public.anular_enlace_seguimiento(uuid)
  from public, anon;
grant execute on function public.crear_enlace_seguimiento(uuid), public.anular_enlace_seguimiento(uuid)
  to authenticated;

-- La consulta pública es la ÚNICA función que puede usar un visitante sin sesión.
revoke execute on function public.seguimiento_publico(text) from public;
grant execute on function public.seguimiento_publico(text) to anon, authenticated;
