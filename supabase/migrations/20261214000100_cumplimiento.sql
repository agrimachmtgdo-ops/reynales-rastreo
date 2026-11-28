-- =============================================================================
-- Fase C4: cumplimiento de entregas (OTIF) y de transportistas, para gerencia.
--
--  * reporte_cumplimiento: OTIF de cada envío confirmado cuya entrega comprometida cae
--    en el período. «A tiempo» = fecha real del hito ≤ comprometida + tolerancia;
--    «Completo» = toneladas pesadas en fábrica dentro de ±tolerancia % de las
--    comprometidas (las del envío al confirmarse, movidas solo por pedido del cliente).
--    Un envío vencido sin entregar ya cuenta como «no a tiempo»; uno cancelado por
--    causa propia cuenta como falla; uno cancelado por el cliente no se mide.
--  * reporte_transportistas: confirmación, presentación, puntualidad en fábrica y
--    ausencias por transportista (desde los pedidos de camiones de Programa).
--  * Cuatro ajustes en configuracion (tolerancias y meta), los cambia el administrador.
--
-- Solo agrega funciones de lectura y claves de configuración: no crea tablas ni
-- toca datos existentes. Reversión: supabase/revertir/20261214000100_cumplimiento.sql
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Ajustes
-- ---------------------------------------------------------------------------
insert into public.configuracion (clave, valor) values
  ('otif_tolerancia_dias', '0'),
  ('otif_tolerancia_pct', '3'),
  ('otif_meta_pct', '95'),
  ('puntualidad_tolerancia_min', '60')
on conflict (clave) do nothing;

create or replace function public.ajustes_cumplimiento()
returns jsonb language sql stable security definer
set search_path = public as $$
  select jsonb_build_object(
    'tolerancia_dias', coalesce((select (valor #>> '{}')::int from public.configuracion where clave = 'otif_tolerancia_dias'), 0),
    'tolerancia_pct', coalesce((select (valor #>> '{}')::numeric from public.configuracion where clave = 'otif_tolerancia_pct'), 3),
    'meta_pct', coalesce((select (valor #>> '{}')::numeric from public.configuracion where clave = 'otif_meta_pct'), 95),
    'tolerancia_min', coalesce((select (valor #>> '{}')::int from public.configuracion where clave = 'puntualidad_tolerancia_min'), 60))
$$;

create or replace function public.fijar_ajustes_cumplimiento(
  p_tolerancia_dias integer, p_tolerancia_pct numeric, p_meta_pct numeric, p_tolerancia_min integer
) returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.es_administrador() then
    raise exception 'Solo el administrador cambia los ajustes de cumplimiento.' using errcode = '42501';
  end if;
  if p_tolerancia_dias is null or p_tolerancia_dias < 0 or p_tolerancia_dias > 10 then
    raise exception 'La tolerancia de días debe estar entre 0 y 10.';
  end if;
  if p_tolerancia_pct is null or p_tolerancia_pct < 0 or p_tolerancia_pct > 20 then
    raise exception 'La tolerancia de toneladas debe estar entre 0 y 20 %%.';
  end if;
  if p_meta_pct is null or p_meta_pct < 50 or p_meta_pct > 100 then
    raise exception 'La meta de OTIF debe estar entre 50 y 100 %%.';
  end if;
  if p_tolerancia_min is null or p_tolerancia_min < 0 or p_tolerancia_min > 600 then
    raise exception 'La tolerancia de llegada a fábrica debe estar entre 0 y 600 minutos.';
  end if;
  insert into public.configuracion (clave, valor, actualizado_en) values
    ('otif_tolerancia_dias', to_jsonb(p_tolerancia_dias), now()),
    ('otif_tolerancia_pct', to_jsonb(p_tolerancia_pct), now()),
    ('otif_meta_pct', to_jsonb(p_meta_pct), now()),
    ('puntualidad_tolerancia_min', to_jsonb(p_tolerancia_min), now())
  on conflict (clave) do update set valor = excluded.valor, actualizado_en = now();
end $$;

-- El comercial ve solo sus clientes (y los que no tienen comercial asignado).
create or replace function public.solo_clientes_propios()
returns boolean language sql stable security definer
set search_path = public as $$
  select public.es_comercial() and not public.es_administrador()
$$;

-- ---------------------------------------------------------------------------
-- OTIF por envío
-- ---------------------------------------------------------------------------
create or replace function public.reporte_cumplimiento(
  p_desde date, p_hasta date, p_cliente uuid default null, p_incoterm text default null
) returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  aj jsonb := public.ajustes_cumplimiento();
  v_tol_dias int := (aj ->> 'tolerancia_dias')::int;
  v_tol_pct numeric := (aj ->> 'tolerancia_pct')::numeric;
  v_hoy date := (now() at time zone 'America/La_Paz')::date;
  v_propios boolean := public.solo_clientes_propios();
  resultado jsonb;
begin
  if not public.es_personal() then
    raise exception 'Solo el personal de la fábrica ve el cumplimiento.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Elija un período válido (hasta 13 meses).';
  end if;

  with
  env as (
    select e.id, e.pedido_id, e.numero, e.toneladas, e.entrega_comprometida, e.estado, e.embarque_fecha,
           p.codigo as pedido_codigo, p.cliente_id, c.razon_social as cliente, p.incoterm, p.hito,
           d.nombre as destino, public.mision_de_envio(e.id) as mision_id
      from public.programa_envios e
      join public.pedidos p on p.id = e.pedido_id
      join public.clientes c on c.id = p.cliente_id
      left join public.ubicaciones d on d.id = p.destino_id
     where e.estado in ('pendiente', 'en_curso', 'cumplido', 'cancelado')
       and e.entrega_comprometida between p_desde and p_hasta
       and (p_cliente is null or p.cliente_id = p_cliente)
       and (p_incoterm is null or p.incoterm = p_incoterm)
       and (not v_propios or c.comercial_id is null or c.comercial_id = auth.uid())
  ),
  -- Toneladas comprometidas: las del último cambio pedido por el cliente; si no hubo,
  -- las que tenía el envío antes del primer cambio; si no hubo cambios, las actuales.
  comp as (
    select en.id,
      coalesce(
        (select cc.toneladas_nueva from public.cambios_compromiso cc
          where cc.envio_id = en.id and cc.tipo = 'reprogramado' and cc.mueve_compromiso and cc.toneladas_nueva is not null
          order by cc.creado_en desc limit 1),
        (select cc.toneladas_anterior from public.cambios_compromiso cc
          where cc.envio_id = en.id and cc.tipo in ('reprogramado', 'cancelado') and cc.toneladas_anterior is not null
          order by cc.creado_en limit 1),
        en.toneladas) as toneladas_comp,
      (select cc.causa from public.cambios_compromiso cc
        where cc.envio_id = en.id and cc.tipo = 'cancelado' order by cc.creado_en desc limit 1) as causa_cancelacion,
      -- Causa propia más reciente (la que explica una falla).
      (select cc.causa from public.cambios_compromiso cc
        where cc.envio_id = en.id and not cc.mueve_compromiso order by cc.creado_en desc limit 1) as causa_propia
      from env en
  ),
  -- Camiones vivos de la misión, con su salida de fábrica (primera vez en ruta) y su primera entrega.
  cam as (
    select a.mision_id, a.id, a.tramo, a.toneladas_cargadas,
      (select min(ev.ocurrido_en) from public.eventos ev
        where ev.asignacion_id = a.id and ev.tipo = 'cambio_etapa'
          and ev.etapa_nueva in ('en_ruta', 'en_frontera', 'cruzo_frontera', 'entregado')) as salida,
      (select min(ev.ocurrido_en) from public.eventos ev
        where ev.asignacion_id = a.id and ev.tipo = 'cambio_etapa' and ev.etapa_nueva = 'entregado') as entrega,
      a.etapa
      from public.asignaciones a
      join env en on en.mision_id = a.mision_id
     where a.etapa <> 'cancelado'
  ),
  mis as (
    select m.id, m.codigo, m.etapa, m.actualizado_en,
           greatest(1, coalesce((select max(t.numero) from public.tramos t where t.mision_id = m.id), 1)) as ultimo_tramo
      from public.misiones m join env en on en.mision_id = m.id
  ),
  real as (
    select en.id,
      -- Hito «carga»: salida del último camión del primer tramo (cuando ya salieron todos).
      case when count(*) filter (where ca.tramo = 1) > 0
                and count(*) filter (where ca.tramo = 1 and ca.salida is null) = 0
           then (max(ca.salida) filter (where ca.tramo = 1) at time zone 'America/La_Paz')::date end as fecha_carga,
      -- Hito «entrega»: entrega del último camión del último tramo (misión entregada).
      case when mi.etapa = 'entregado'
           then (coalesce(max(ca.entrega) filter (where ca.tramo = mi.ultimo_tramo), mi.actualizado_en)
                 at time zone 'America/La_Paz')::date end as fecha_entrega,
      sum(ca.toneladas_cargadas) filter (where ca.tramo = 1) as toneladas_real,
      count(*) filter (where ca.tramo = 1) as camiones,
      count(*) filter (where ca.tramo = 1 and ca.toneladas_cargadas is null) as sin_peso
      from env en
      join mis mi on mi.id = en.mision_id
      left join cam ca on ca.mision_id = en.mision_id
     group by en.id, mi.etapa, mi.actualizado_en, mi.ultimo_tramo
  ),
  medidos as (
    select en.*, co.toneladas_comp, co.causa_cancelacion, co.causa_propia, mi.codigo as mision_codigo,
           case when en.hito = 'carga' then r.fecha_carga else r.fecha_entrega end as fecha_real,
           r.toneladas_real, coalesce(r.camiones, 0) as camiones, coalesce(r.sin_peso, 0) as sin_peso
      from env en
      join comp co on co.id = en.id
      left join real r on r.id = en.id
      left join mis mi on mi.id = en.mision_id
  ),
  clasificados as (
    select me.*,
      case
        when me.estado = 'cancelado' and me.causa_cancelacion = 'cliente' then null
        when me.estado = 'cancelado' then 'cancelado'
        when me.fecha_real is not null then 'medido'
        when me.entrega_comprometida + v_tol_dias < v_hoy then 'vencido'
        else null
      end as medicion
      from medidos me
  ),
  resultados as (
    select cl.*,
      case cl.medicion
        when 'medido' then cl.fecha_real <= cl.entrega_comprometida + v_tol_dias
        else false end as a_tiempo,
      case
        when cl.medicion = 'cancelado' then false
        when cl.medicion = 'medido' and cl.camiones > 0 and cl.sin_peso = 0 and cl.toneladas_comp > 0
          then abs(cl.toneladas_real - cl.toneladas_comp) <= cl.toneladas_comp * v_tol_pct / 100
        else null end as completo,
      case when cl.medicion = 'cancelado' then null
           else greatest(0, coalesce(cl.fecha_real, v_hoy) - cl.entrega_comprometida) end as dias_atraso
      from clasificados cl
     where cl.medicion is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'envio_id', r.id, 'pedido_id', r.pedido_id, 'pedido_codigo', r.pedido_codigo, 'numero', r.numero,
      'cliente_id', r.cliente_id, 'cliente', r.cliente, 'incoterm', r.incoterm, 'destino', r.destino, 'hito', r.hito,
      'comprometida', r.entrega_comprometida, 'fecha_real', r.fecha_real, 'embarque', r.embarque_fecha,
      'medicion', r.medicion, 'a_tiempo', r.a_tiempo, 'completo', r.completo,
      'otif', case when r.a_tiempo is false or r.completo is false then false
                   when r.a_tiempo and r.completo then true end,
      'dias_atraso', r.dias_atraso,
      'toneladas_comprometidas', r.toneladas_comp, 'toneladas_reales', r.toneladas_real,
      'causa', case when r.medicion = 'cancelado' then r.causa_cancelacion else r.causa_propia end,
      'mision_id', r.mision_id, 'mision_codigo', r.mision_codigo
    ) order by r.entrega_comprometida, r.pedido_codigo, r.numero), '[]'::jsonb)
    into resultado
    from resultados r;

  return jsonb_build_object('ajustes', aj, 'hoy', v_hoy, 'solo_propios', v_propios, 'envios', resultado);
end $$;

-- ---------------------------------------------------------------------------
-- Transportistas
-- ---------------------------------------------------------------------------
create or replace function public.reporte_transportistas(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  v_tol_min int := (public.ajustes_cumplimiento() ->> 'tolerancia_min')::int;
  resultado jsonb;
begin
  if not public.es_personal() or public.solo_clientes_propios() then
    raise exception 'Solo administración, gerencia y logística ven el cumplimiento de transportistas.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Elija un período válido (hasta 13 meses).';
  end if;

  with
  sol as (
    select s.*, e.presentacion as presentacion_envio, e.numero, p.codigo as pedido_codigo,
           coalesce(e.fecha_carga_planificada, e.entrega_vigente) as carga
      from public.solicitudes_camiones s
      join public.programa_envios e on e.id = s.envio_id
      join public.pedidos p on p.id = e.pedido_id
     where s.estado <> 'anulado'
       and coalesce(e.fecha_carga_planificada, e.entrega_vigente) between p_desde and p_hasta
  ),
  -- Camiones cargados por cada pedido de camiones (vivos o marcados «no se presentó»).
  cam as (
    select a.id, s.transportista_id, s.carga, s.pedido_codigo, s.numero, a.llegada_fabrica, a.ausencia_causa,
           coalesce(s.presentacion, s.presentacion_envio) as presentacion, v.placa, co.nombre as chofer
      from public.asignaciones a
      join sol s on s.id = a.solicitud_id
      join public.vehiculos v on v.id = a.vehiculo_id
      join public.conductores co on co.id = a.conductor_id
     where a.etapa <> 'cancelado' or a.ausencia_causa is not null
  ),
  por_sol as (
    select transportista_id,
           sum(camiones_pedidos) as pedidos,
           sum(camiones_pedidos) filter (where estado in ('confirmado', 'rechazado')) as respondidos,
           sum(coalesce(camiones_confirmados, 0)) filter (where estado in ('confirmado', 'rechazado')) as confirmados,
           count(*) filter (where estado = 'pedido') as sin_respuesta
      from sol group by transportista_id
  ),
  por_cam as (
    select transportista_id,
           count(*) as asignados,
           count(*) filter (where llegada_fabrica is not null) as llegaron,
           count(*) filter (where ausencia_causa is not null) as ausencias,
           count(*) filter (where llegada_fabrica is not null and presentacion is not null) as con_hora,
           count(*) filter (where llegada_fabrica is not null and presentacion is not null
                              and llegada_fabrica <= presentacion + make_interval(mins => v_tol_min)) as puntuales,
           jsonb_agg(jsonb_build_object('placa', placa, 'chofer', chofer, 'causa', ausencia_causa, 'carga', carga,
                                        'pedido_codigo', pedido_codigo, 'numero', numero)
                     order by carga) filter (where ausencia_causa is not null) as detalle_ausencias
      from cam group by transportista_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'transportista_id', t.id, 'transportista', t.razon_social,
      'pedidos', ps.pedidos, 'respondidos', coalesce(ps.respondidos, 0), 'confirmados', coalesce(ps.confirmados, 0),
      'sin_respuesta', ps.sin_respuesta,
      'asignados', coalesce(pc.asignados, 0), 'llegaron', coalesce(pc.llegaron, 0), 'ausencias', coalesce(pc.ausencias, 0),
      'con_hora', coalesce(pc.con_hora, 0), 'puntuales', coalesce(pc.puntuales, 0),
      'detalle_ausencias', coalesce(pc.detalle_ausencias, '[]'::jsonb)
    ) order by t.razon_social), '[]'::jsonb)
    into resultado
    from por_sol ps
    join public.transportistas t on t.id = ps.transportista_id
    left join por_cam pc on pc.transportista_id = ps.transportista_id;

  return jsonb_build_object('tolerancia_min', v_tol_min, 'transportistas', resultado);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function public.ajustes_cumplimiento(), public.fijar_ajustes_cumplimiento(integer, numeric, numeric, integer),
  public.solo_clientes_propios(), public.reporte_cumplimiento(date, date, uuid, text), public.reporte_transportistas(date, date)
  from public, anon;
grant execute on function public.ajustes_cumplimiento(), public.fijar_ajustes_cumplimiento(integer, numeric, numeric, integer),
  public.solo_clientes_propios(), public.reporte_cumplimiento(date, date, uuid, text), public.reporte_transportistas(date, date)
  to authenticated;
