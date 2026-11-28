-- =============================================================================
-- Reporte de operaciones entregadas (Parte B del plan aprobado el 2026-11-28)
--
--  * misiones.entrega_comprometida (opcional): fecha y hora prometida al cliente,
--    para medir la puntualidad.
--  * public.reporte_entregas(): SOLO LECTURA. Devuelve una fila por misión
--    entregada en el período (fecha de entrega, hora de Bolivia), con tiempos por
--    tramo, espera en el transbordo y en frontera, toneladas, documentos,
--    incidencias y, por camión, el % del recorrido con señal GPS.
--    Solo la usa el personal (el operador de transbordo no la ve).
--
-- No borra ni modifica datos existentes. Reversión:
-- supabase/revertir/20261207000100_reporte_entregas.sql
-- =============================================================================
set search_path = public, extensions;

alter table public.misiones add column entrega_comprometida timestamptz;

create or replace function public.reporte_entregas(
  p_desde date, p_hasta date,
  p_cliente uuid default null, p_pais text default null, p_transportista uuid default null
) returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  resultado jsonb;
  -- Un hueco de más de 15 minutos entre posiciones cuenta como «sin señal».
  v_hueco constant interval := interval '15 minutes';
begin
  if not public.es_personal() then
    raise exception 'Solo el personal de la fábrica ve los reportes.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Elija un período válido (hasta 13 meses).';
  end if;

  with
  -- Último tramo de cada misión (1 si no hay transbordo).
  ultimo as (
    select m.id as mision_id, greatest(1, coalesce(max(t.numero), 1)) as tramo
      from public.misiones m left join public.tramos t on t.mision_id = m.id
     where m.etapa = 'entregado'
     group by m.id
  ),
  -- Cambios de etapa de cada camión (primera vez que llegó a cada etapa).
  hitos as (
    select a.mision_id, a.id as asignacion_id, a.tramo, e.etapa_nueva as etapa, min(e.ocurrido_en) as hora
      from public.asignaciones a
      join ultimo u on u.mision_id = a.mision_id
      join public.eventos e on e.asignacion_id = a.id and e.tipo = 'cambio_etapa' and e.etapa_nueva is not null
     where a.etapa <> 'cancelado'
     group by a.mision_id, a.id, a.tramo, e.etapa_nueva
  ),
  por_mision as (
    select u.mision_id, u.tramo as ultimo_tramo,
      -- Salida de fábrica: primer avance del tramo 1.
      min(h.hora) filter (where h.tramo = 1 and h.etapa <> 'programado') as salida,
      -- Llegada al transbordo: el último camión del tramo 1 entregado (si hay transbordo).
      max(h.hora) filter (where h.tramo = 1 and h.etapa = 'entregado' and u.tramo > 1) as llegada_transbordo,
      -- Salida del transbordo: primer camión del último tramo en ruta.
      min(h.hora) filter (where h.tramo = u.tramo and u.tramo > 1
                            and h.etapa in ('en_ruta', 'en_frontera', 'cruzo_frontera', 'entregado')) as salida_transbordo,
      -- Entrega: el último camión del último tramo.
      max(h.hora) filter (where h.tramo = u.tramo and h.etapa = 'entregado') as entrega,
      min(h.hora) filter (where h.etapa = 'en_frontera') as llega_frontera,
      min(h.hora) filter (where h.etapa = 'cruzo_frontera') as cruza_frontera
      from ultimo u left join hitos h on h.mision_id = u.mision_id
     group by u.mision_id, u.tramo
  ),
  elegidas as (
    select pm.*, m.codigo, m.cliente_id, c.razon_social as cliente, d.nombre as destino, d.pais,
           m.factura, m.entrega_comprometida
      from por_mision pm
      join public.misiones m on m.id = pm.mision_id
      join public.clientes c on c.id = m.cliente_id
      join public.ubicaciones d on d.id = m.destino_id
     where pm.entrega is not null
       and (pm.entrega at time zone 'America/La_Paz')::date between p_desde and p_hasta
       and (p_cliente is null or m.cliente_id = p_cliente)
       and (p_pais is null or d.pais = p_pais)
       and (p_transportista is null or exists (
             select 1 from public.asignaciones a where a.mision_id = m.id and a.transportista_id = p_transportista
                and a.etapa <> 'cancelado'))
  ),
  -- Por camión: horario del viaje, señal GPS y quién marcó las etapas.
  camiones as (
    select a.id, a.mision_id, a.tramo, a.transportista_id, t.razon_social as transportista, v.placa, co.nombre as chofer,
           coalesce(a.toneladas_cargadas, a.toneladas_declaradas) as toneladas,
           (select min(h.hora) from hitos h where h.asignacion_id = a.id and h.etapa <> 'programado') as inicio,
           (select min(h.hora) from hitos h where h.asignacion_id = a.id and h.etapa = 'entregado') as fin,
           (select count(*) from public.eventos e where e.asignacion_id = a.id and e.tipo = 'cambio_etapa' and e.origen = 'chofer') as etapas_chofer,
           (select count(*) from public.eventos e where e.asignacion_id = a.id and e.tipo = 'cambio_etapa' and e.origen in ('geocerca', 'sistema')) as etapas_sistema,
           (select count(*) from public.eventos e where e.asignacion_id = a.id and e.tipo = 'cambio_etapa' and e.origen = 'despacho') as etapas_despacho
      from public.asignaciones a
      join elegidas el on el.mision_id = a.mision_id
      join public.transportistas t on t.id = a.transportista_id
      join public.vehiculos v on v.id = a.vehiculo_id
      join public.conductores co on co.id = a.conductor_id
     where a.etapa <> 'cancelado'
  ),
  senal as (
    select c.id,
      extract(epoch from (c.fin - c.inicio)) / 60 as minutos_viaje,
      coalesce((
        select sum(extract(epoch from g.hueco) / 60)
          from (
            select lead(t) over (order by t) - t as hueco
              from (select c.inicio as t
                    union all
                    select p.capturado_en from public.posiciones p
                     where p.asignacion_id = c.id and not p.simulada and p.capturado_en > c.inicio and p.capturado_en < c.fin
                    union all
                    select c.fin) puntos
          ) g
         where g.hueco > v_hueco
      ), 0) as minutos_sin_senal
      from camiones c
     where c.inicio is not null and c.fin is not null and c.fin > c.inicio
  ),
  incid as (
    select a.mision_id, count(*) as total,
           jsonb_agg(distinct coalesce(e.detalle ->> 'motivo', e.tipo::text)) as motivos
      from public.eventos e join public.asignaciones a on a.id = e.asignacion_id
      join elegidas el on el.mision_id = a.mision_id
     where e.tipo in ('incidencia', 'emergencia')
     group by a.mision_id
  ),
  docs as (
    select d.mision_id, array_agg(distinct d.tipo::text) as tipos
      from public.documentos d join elegidas el on el.mision_id = d.mision_id
     where d.reemplazado_por is null
     group by d.mision_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', el.mision_id, 'codigo', el.codigo, 'cliente_id', el.cliente_id, 'cliente', el.cliente,
      'destino', el.destino, 'pais', el.pais, 'factura', el.factura,
      'salida', el.salida, 'entrega', el.entrega, 'entrega_comprometida', el.entrega_comprometida,
      'transbordo', el.ultimo_tramo > 1,
      'llegada_transbordo', el.llegada_transbordo, 'salida_transbordo', el.salida_transbordo,
      'llega_frontera', el.llega_frontera, 'cruza_frontera', el.cruza_frontera,
      'toneladas', (select sum(c.toneladas) from camiones c where c.mision_id = el.mision_id and c.tramo = 1),
      'docs_completos', coalesce('factura' = any(dc.tipos), false)
                        and (el.pais <> 'PE' or coalesce('dex' = any(dc.tipos), false)),
      'incidencias', coalesce(i.total, 0), 'motivos', coalesce(i.motivos, '[]'::jsonb),
      'camiones', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'tramo', c.tramo, 'transportista_id', c.transportista_id, 'transportista', c.transportista,
          'placa', c.placa, 'chofer', c.chofer, 'toneladas', c.toneladas, 'inicio', c.inicio, 'fin', c.fin,
          'minutos_viaje', round(s.minutos_viaje::numeric, 1), 'minutos_sin_senal', round(s.minutos_sin_senal::numeric, 1),
          'etapas_chofer', c.etapas_chofer, 'etapas_sistema', c.etapas_sistema, 'etapas_despacho', c.etapas_despacho
        ) order by c.tramo, c.placa), '[]'::jsonb)
        from camiones c left join senal s on s.id = c.id where c.mision_id = el.mision_id)
    ) order by el.entrega), '[]'::jsonb)
    into resultado
    from elegidas el
    left join incid i on i.mision_id = el.mision_id
    left join docs dc on dc.mision_id = el.mision_id;
  return resultado;
end $$;

revoke execute on function public.reporte_entregas(date, date, uuid, text, uuid) from public, anon;
grant execute on function public.reporte_entregas(date, date, uuid, text, uuid) to authenticated;
