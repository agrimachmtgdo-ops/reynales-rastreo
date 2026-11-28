-- =============================================================================
-- REVERTIR la migración 20261202000100_fase1_criticos.sql
-- Ejecutar completo en el SQL Editor de Supabase SOLO si hay que deshacer la Fase 1.
-- Devuelve los teléfonos a su valor original (los que no se editaron después),
-- y las funciones de etapas y geocercas a su versión anterior.
-- Se pierden: la hora del dispositivo de los eventos nuevos y el «detenido desde».
-- La tabla telefonos_respaldo se conserva (puede borrarse a mano después).
-- =============================================================================
begin;

-- Teléfonos
drop trigger if exists clientes_telefono on public.clientes;
drop trigger if exists conductores_telefono on public.conductores;
drop trigger if exists transportistas_telefono on public.transportistas;
drop trigger if exists misiones_telefono on public.misiones;
update public.clientes c set whatsapp = r.valor_original from public.telefonos_respaldo r
 where r.tabla = 'clientes' and r.fila_id = c.id and c.whatsapp = r.valor_nuevo;
update public.conductores c set telefono = r.valor_original from public.telefonos_respaldo r
 where r.tabla = 'conductores' and r.fila_id = c.id and c.telefono = r.valor_nuevo;
update public.transportistas t set telefono = r.valor_original from public.telefonos_respaldo r
 where r.tabla = 'transportistas' and r.fila_id = t.id and t.telefono = r.valor_nuevo;
update public.misiones m set telefono_coordinador = r.valor_original from public.telefonos_respaldo r
 where r.tabla = 'misiones' and r.fila_id = m.id and m.telefono_coordinador = r.valor_nuevo;
drop function if exists public.trg_normalizar_telefonos();
drop function if exists public.telefonos_por_corregir();
drop function if exists public.normalizar_telefono(text);
drop function if exists public.es_telefono_e164(text);

-- Detenido y configuración
drop trigger if exists asignaciones_detenido on public.asignaciones;
drop function if exists public.trg_detenido();
drop function if exists public.fijar_minutos_detenido(integer);
drop table if exists public.configuracion;

-- Etapas: versión anterior
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

drop function if exists public.marcar_etapa_chofer(uuid, public.etapa_envio, timestamptz);
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

revoke execute on function public.marcar_etapa_chofer(uuid, public.etapa_envio) from public, anon;
grant execute on function public.marcar_etapa_chofer(uuid, public.etapa_envio) to authenticated;

-- Geocercas: versión anterior
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

alter table public.asignaciones
  drop column if exists detenido_desde,
  drop column if exists detenido_lat,
  drop column if exists detenido_lon,
  drop column if exists salida_candidata_desde;
alter table public.eventos drop column if exists hora_dispositivo;

commit;
